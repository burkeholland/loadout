// Agent Loop canvas — human-in-the-loop, multi-agent build loop.
//
// ROLE: this extension conducts deterministic workflow state transitions. Agents
// receive exact work orders and submit generated assets back through submit_stage.
//
// State is issue-authoritative: the collapsed AGENT-LOOP-STATE control-block
// comment is the machine-readable read model. The webview polls /state (which
// parses that comment) and also listens for SSE `refresh` nudges.

import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import {
  startServer, broadcastRefresh,
} from "./server.mjs";
import { createAgentLoopActions } from "./actions.mjs";
import { TARGET_SCHEMA_PROPS, validateGithubTarget } from "./target.mjs";

const CANVAS_ID = "agent-loop";

const servers = new Map(); // instanceId -> { server, url, clients:Set }
let session;

function refreshAll(instanceId) {
  if (instanceId && servers.has(instanceId)) broadcastRefresh(servers.get(instanceId));
  else for (const e of servers.values()) broadcastRefresh(e);
}

// ─── Canvas actions (agent/UI → deterministic coordinator) ───────────────────
// NOTE: each action keeps its `handler`. It is passed straight to createCanvas,
// which strips the metadata for the wire and dispatches `canvas.action.invoke`
// in-process. Do NOT strip handlers before handing actions to createCanvas.
const actions = createAgentLoopActions({ servers, refreshAll });

const agentLoopCanvas = createCanvas({
  id: CANVAS_ID,
  displayName: "Flow",
  description: "Human-in-the-loop multi-agent build loop: kickoff → research → prototype → sign-off, backed by a GitHub issue.",
  inputSchema: {
    type: "object",
    properties: TARGET_SCHEMA_PROPS,
    additionalProperties: false,
  },
  actions,
  open: async (ctx) => {
    const input = (ctx && ctx.input) || {};
    const target = validateGithubTarget(input, { optional: true });
    let entry = servers.get(ctx.instanceId);
    if (!entry) {
      entry = await startServer({
        instanceId: ctx.instanceId,
        workingDirectory: ctx.session && ctx.session.workingDirectory,
        ...(target ? { active: target } : {}),
        sendPrompt: async (prompt, kind) => {
          await session.send({ prompt });
          await session.log("Flow work order → agent: " + kind, { ephemeral: true });
        },
      });
      servers.set(ctx.instanceId, entry);
    }
    if (target) await entry.setActive(target.owner, target.repo, target.issue);
    return { title: "Flow", url: entry.url };
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

await session.log("Flow canvas extension ready.", { ephemeral: true });
