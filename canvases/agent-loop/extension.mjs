// Agent Loop canvas — human-in-the-loop, multi-agent build loop.
//
// ROLE: this canvas is the INTERFACE ONLY. It never conducts the loop.
//   • It READS GitHub for free (via `gh api`) to show where the job is.
//   • It sends genuine work to the ORCHESTRATOR session via session.send({prompt}).
//   • The orchestrator owns ALL mutations (issue comments, control block, labels)
//     and pushes a `refresh` nudge here after each transition.
//
// State is issue-authoritative: the collapsed AGENT-LOOP-STATE control-block
// comment is the machine-readable read model. The webview polls /state (which
// parses that comment) and also listens for SSE `refresh` nudges.

import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import {
  startServer, buildState, broadcastRefresh, setActive,
  DATA_ROOT, ACTIVE_FILE, WORK_ROOT,
} from "./server.mjs";
import { PLAYBOOK } from "./playbook.mjs";

const CANVAS_ID = "agent-loop";

const servers = new Map(); // instanceId -> { server, url, clients:Set }
let session;

function refreshAll(instanceId) {
  if (instanceId && servers.has(instanceId)) broadcastRefresh(servers.get(instanceId));
  else for (const e of servers.values()) broadcastRefresh(e);
}

// ─── Canvas actions (orchestrator → canvas) ──────────────────────────────────
// NOTE: each action keeps its `handler`. It is passed straight to createCanvas,
// which strips the metadata for the wire and dispatches `canvas.action.invoke`
// in-process. Do NOT strip handlers before handing actions to createCanvas.
const actions = [
  {
    name: "refresh",
    description: "Nudge the Agent Loop canvas to re-read issue state after a transition. Call after posting a comment, updating the control block, or changing labels.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (ctx) => {
      refreshAll(ctx && ctx.instanceId);
      return { ok: true };
    },
  },
  {
    name: "get_state",
    description: "Return the current Agent Loop read model (parsed control block + labels) for the active issue.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => buildState(),
  },
  {
    name: "get_config",
    description: "Return the fixed on-disk paths the orchestrator must use: the active-job pointer file and the prototype working root.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => ({ dataRoot: DATA_ROOT, activeFile: ACTIVE_FILE, workRoot: WORK_ROOT }),
  },
  {
    name: "get_playbook",
    description: "Return the full Agent Loop conductor playbook (state machine, tick algorithm, guardrails, stage playbooks) that the orchestrator must follow. The playbook is embedded in the canvas — the orchestrator relies on this, never on a file in the target repo.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => ({ playbook: PLAYBOOK }),
  },
  {
    name: "set_active",
    description: "Point the canvas at the issue the orchestrator is working on, so the canvas stays in sync. Writes the active-job pointer, nudges a refresh, and returns the fresh read model.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        issue: { type: "number" },
      },
      required: ["owner", "repo", "issue"],
      additionalProperties: false,
    },
    handler: async (ctx) => {
      const { owner, repo, issue } = (ctx && ctx.input) || {};
      if (!owner || !repo || !issue) {
        return { ok: false, error: "owner, repo and issue are all required" };
      }
      await setActive(owner, repo, issue);
      refreshAll(ctx && ctx.instanceId);
      return { ok: true, state: await buildState() };
    },
  },
];

const agentLoopCanvas = createCanvas({
  id: CANVAS_ID,
  displayName: "Agent Loop",
  description: "Human-in-the-loop multi-agent build loop: kickoff → research → prototype → sign-off, backed by a GitHub issue.",
  inputSchema: {
    type: "object",
    properties: {
      owner: { type: "string" }, repo: { type: "string" }, issue: { type: "number" },
    },
    additionalProperties: false,
  },
  actions,
  open: async (ctx) => {
    const input = (ctx && ctx.input) || {};
    if (input.owner && input.repo && input.issue) {
      await setActive(input.owner, input.repo, input.issue);
    }
    let entry = servers.get(ctx.instanceId);
    if (!entry) {
      entry = await startServer({
        onPrompt: async (prompt, kind) => {
          await session.send({ prompt });
          await session.log("Agent Loop canvas → orchestrator: " + kind, { ephemeral: true });
        },
      });
      servers.set(ctx.instanceId, entry);
    }
    return { title: "Agent Loop", url: entry.url };
  },
  onClose: async (ctx) => {
    const entry = servers.get(ctx.instanceId);
    if (entry) {
      servers.delete(ctx.instanceId);
      for (const c of entry.clients) { try { c.end(); } catch {} }
      await new Promise((resolve) => entry.server.close(() => resolve()));
      if (entry.assetServer) await new Promise((resolve) => entry.assetServer.close(() => resolve()));
    }
  },
});

session = await joinSession({ canvases: [agentLoopCanvas] });

await session.log("Agent Loop canvas extension ready.", { ephemeral: true });
