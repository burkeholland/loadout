// SQLite canvas — browse tables/schema and run SQL against local databases.

import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import {
  createInstanceState,
  startServer,
  stopServer,
  pushState,
  buildClientState,
  handleApi,
} from "./server.mjs";
import { DEFAULT_PAGE_SIZE } from "./db.mjs";

const CANVAS_ID = "sqlite";
const servers = new Map(); // instanceId -> server entry

function getEntry(instanceId) {
  return servers.get(instanceId) || null;
}

function requireEntry(instanceId) {
  const entry = getEntry(instanceId);
  if (!entry) throw new Error(`No SQLite canvas instance "${instanceId}"`);
  return entry;
}

async function ensureServer(instanceId, initialPath) {
  let entry = servers.get(instanceId);
  if (entry) return entry;
  const instance = createInstanceState(initialPath);
  entry = await startServer(instanceId, instance);
  servers.set(instanceId, entry);
  return entry;
}

const actions = [
  {
    name: "open",
    description: "Open a local SQLite database file in the canvas and refresh the UI.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to a .db / .sqlite file" },
        create: { type: "boolean", description: "Create the file if missing (default false)" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    handler: async (ctx) => {
      const entry = requireEntry(ctx.instanceId);
      const result = await handleApi(entry, "/api/open", {
        path: ctx.input?.path,
        create: !!ctx.input?.create,
      });
      pushState(entry);
      return result;
    },
  },
  {
    name: "close",
    description: "Close the currently open database in the SQLite canvas.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (ctx) => {
      const entry = requireEntry(ctx.instanceId);
      const result = await handleApi(entry, "/api/close", {});
      pushState(entry);
      return result;
    },
  },
  {
    name: "get_state",
    description: "Return the current SQLite canvas state (path, tables, selection, last error).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (ctx) => {
      const entry = requireEntry(ctx.instanceId);
      return buildClientState(entry.instance);
    },
  },
  {
    name: "list_tables",
    description: "List tables and views in the open database.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (ctx) => {
      const entry = requireEntry(ctx.instanceId);
      const tables = entry.instance.store.listTables();
      pushState(entry);
      return { tables };
    },
  },
  {
    name: "describe_table",
    description: "Describe columns, indexes, and foreign keys for a table or view.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table or view name" },
      },
      required: ["table"],
      additionalProperties: false,
    },
    handler: async (ctx) => {
      const entry = requireEntry(ctx.instanceId);
      const schema = entry.instance.store.describeTable(ctx.input.table);
      entry.instance.ui.selectedTable = ctx.input.table;
      entry.instance.ui.schema = schema;
      pushState(entry);
      return schema;
    },
  },
  {
    name: "preview",
    description: "Preview rows from a table with limit/offset pagination.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
      required: ["table"],
      additionalProperties: false,
    },
    handler: async (ctx) => {
      const entry = requireEntry(ctx.instanceId);
      const result = await handleApi(entry, "/api/preview", {
        table: ctx.input.table,
        limit: ctx.input.limit ?? DEFAULT_PAGE_SIZE,
        offset: ctx.input.offset ?? 0,
      });
      pushState(entry);
      return result;
    },
  },
  {
    name: "query",
    description: "Execute SQL against the open database (SELECT or write statements) and show results in the canvas.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL to execute" },
      },
      required: ["sql"],
      additionalProperties: false,
    },
    handler: async (ctx) => {
      const entry = requireEntry(ctx.instanceId);
      const result = await handleApi(entry, "/api/query", { sql: ctx.input.sql });
      pushState(entry);
      return result;
    },
  },
  {
    name: "refresh",
    description: "Re-read schema/preview for the selected table and nudge the UI.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (ctx) => {
      const entry = requireEntry(ctx.instanceId);
      const result = await handleApi(entry, "/api/refresh", {});
      pushState(entry);
      return result;
    },
  },
  {
    name: "get_schema",
    description: "Return full schema (all tables/views with columns) for the open database.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (ctx) => {
      const entry = requireEntry(ctx.instanceId);
      return entry.instance.store.getSchema();
    },
  },
];

const sqliteCanvas = createCanvas({
  id: CANVAS_ID,
  displayName: "SQLite",
  description:
    "View and manipulate local SQLite databases — browse tables/schema, run SQL, inspect results.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Optional absolute path to open immediately",
      },
    },
    additionalProperties: false,
  },
  actions,
  open: async (ctx) => {
    const path = ctx.input?.path;
    const entry = await ensureServer(ctx.instanceId, path);
    const state = buildClientState(entry.instance);
    return {
      title: state.path ? `SQLite · ${state.path.split(/[/\\\\]/).pop()}` : "SQLite",
      url: entry.url,
      status: state.open ? "open" : "idle",
    };
  },
  onClose: async (ctx) => {
    const entry = servers.get(ctx.instanceId);
    if (!entry) return;
    servers.delete(ctx.instanceId);
    await stopServer(entry);
  },
});

const session = await joinSession({
  canvases: [sqliteCanvas],
});

// Compatibility shim for runtimes that route actions as canvas.invokeAction.
session.connection?.onRequest?.("canvas.invokeAction", async (params) => {
  if (!params || typeof params.actionName !== "string" || typeof params.instanceId !== "string") {
    throw new Error("Invalid canvas action payload");
  }
  if (params.canvasId !== CANVAS_ID) {
    throw new Error(`No canvas registered with id "${params.canvasId}"`);
  }
  const handler = sqliteCanvas.actionHandlers?.get?.(params.actionName);
  if (!handler) throw new Error(`No handler for action "${params.actionName}"`);
  return handler({
    sessionId: params.sessionId,
    extensionId: params.extensionId,
    canvasId: params.canvasId,
    instanceId: params.instanceId,
    actionName: params.actionName,
    input: params.input,
  });
});
