import { ACTIVE_FILE, DATA_ROOT, WORK_ROOT } from "./server.mjs";

export function createAgentLoopActions({ servers, refreshAll }) {
  return [
    {
      name: "refresh",
      description: "Nudge the Agent Loop canvas to re-read issue state after a transition.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async (ctx) => {
        refreshAll(ctx && ctx.instanceId);
        return { ok: true };
      },
    },
    {
      name: "get_state",
      description: "Return the current Agent Loop read model for this canvas instance.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async (ctx) => {
        const entry = servers.get(ctx && ctx.instanceId);
        return entry ? entry.buildState() : { active: false };
      },
    },
    {
      name: "get_config",
      description: "Return the fixed on-disk paths used by Agent Loop.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => ({ dataRoot: DATA_ROOT, activeFile: ACTIVE_FILE, workRoot: WORK_ROOT }),
    },
    {
      name: "set_active",
      description: "Bind this canvas instance to an Agent Loop issue and return its fresh read model.",
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
        const entry = servers.get(ctx && ctx.instanceId);
        if (!entry) return { ok: false, error: "Agent Loop instance is not active" };
        await entry.setActive(owner, repo, issue);
        refreshAll(ctx && ctx.instanceId);
        return { ok: true, state: await entry.buildState() };
      },
    },
    {
      name: "submit_stage",
      description: "Submit a generated stage asset for this Agent Loop canvas instance.",
      inputSchema: {
        type: "object",
        properties: {
          opId: { type: "string" },
          submissionToken: { type: "string" },
          owner: { type: "string" },
          repo: { type: "string" },
          issue: { type: "number" },
          artifact: { type: "object" },
        },
        required: ["opId", "submissionToken", "artifact"],
        additionalProperties: false,
      },
      handler: async (ctx) => {
        const entry = servers.get(ctx && ctx.instanceId);
        if (!entry || !entry.coordinator) {
          return { ok: false, error: "Agent Loop instance is not active" };
        }
        const out = await entry.coordinator.submitStage((ctx && ctx.input) || {});
        refreshAll(ctx && ctx.instanceId);
        return out;
      },
    },
  ];
}
