import { ACTIVE_FILE, DATA_ROOT, WORK_ROOT } from "./server.mjs";
import { TARGET_SCHEMA_PROPS, validateGithubTarget } from "./target.mjs";

export function createAgentLoopActions({ servers, refreshAll }) {
  return [
    {
      name: "refresh",
      description: "Nudge the Flow canvas to re-read issue state after a transition.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async (ctx) => {
        refreshAll(ctx && ctx.instanceId);
        return { ok: true };
      },
    },
    {
      name: "get_state",
      description: "Return the current Flow read model for this canvas instance.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async (ctx) => {
        const entry = servers.get(ctx && ctx.instanceId);
        return entry ? entry.buildState() : { active: false };
      },
    },
    {
      name: "get_config",
      description: "Return the fixed on-disk paths used by Flow.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => ({ dataRoot: DATA_ROOT, activeFile: ACTIVE_FILE, workRoot: WORK_ROOT }),
    },
    {
      name: "set_active",
      description: "Bind this canvas instance to a Flow issue and return its fresh read model.",
      inputSchema: {
        type: "object",
        properties: TARGET_SCHEMA_PROPS,
        required: ["owner", "repo", "issue"],
        additionalProperties: false,
      },
      handler: async (ctx) => {
        let target;
        try { target = validateGithubTarget((ctx && ctx.input) || {}); }
        catch (e) { return { ok: false, error: String(e.message || e) }; }
        const entry = servers.get(ctx && ctx.instanceId);
        if (!entry) return { ok: false, error: "Flow instance is not active" };
        await entry.setActive(target.owner, target.repo, target.issue);
        refreshAll(ctx && ctx.instanceId);
        return { ok: true, state: await entry.buildState() };
      },
    },
    {
      name: "submit_stage",
      description: "Submit a generated stage asset for this Flow canvas instance.",
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
          return { ok: false, error: "Flow instance is not active" };
        }
        const out = await entry.coordinator.submitStage((ctx && ctx.input) || {});
        refreshAll(ctx && ctx.instanceId);
        return out;
      },
    },
  ];
}
