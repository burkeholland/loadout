// Local HTTP backend for the SQLite canvas webview.

import { createServer } from "node:http";
import { renderHtml } from "./webview.mjs";
import { createStore, DbError, DEFAULT_PAGE_SIZE } from "./db.mjs";

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function toErrorPayload(err) {
  if (err instanceof DbError) {
    return { ok: false, error: err.message, code: err.code };
  }
  return { ok: false, error: err?.message || String(err), code: "error" };
}

export function createInstanceState(initialPath) {
  const store = createStore();
  const instance = {
    store,
    ui: {
      selectedTable: null,
      tab: "data", // data | sql
      preview: null,
      schema: null,
      queryResult: null,
      lastError: null,
      sqlDraft:
        "SELECT name, type FROM sqlite_master\nWHERE name NOT LIKE 'sqlite_%'\nORDER BY type, name;",
    },
  };

  if (initialPath) {
    try {
      store.open(initialPath);
      const tables = store.listTables();
      if (tables.length) selectTable(instance, tables[0].name);
    } catch (err) {
      instance.ui.lastError = err?.message || String(err);
    }
  }

  return instance;
}

export function buildClientState(instance) {
  const base = instance.store.getState();
  return {
    ...base,
    selectedTable: instance.ui.selectedTable,
    tab: instance.ui.tab,
    preview: instance.ui.preview,
    schema: instance.ui.schema,
    queryResult: instance.ui.queryResult,
    lastError: instance.ui.lastError || base.error,
    sqlDraft: instance.ui.sqlDraft,
  };
}

export function broadcast(entry, event, data) {
  if (!entry) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of entry.clients) client.write(msg);
}

export function pushState(entry) {
  if (!entry) return;
  broadcast(entry, "state", buildClientState(entry.instance));
}

function quoteIdent(name) {
  return '"' + String(name).replaceAll('"', '""') + '"';
}

function seedSql(table) {
  return "SELECT *\nFROM " + quoteIdent(table) + "\nLIMIT 100;";
}

function isSelectLike(sql) {
  return /^\s*(select|with|pragma|explain)\b/i.test(String(sql || ""));
}

function selectTable(instance, table) {
  instance.ui.selectedTable = table || null;
  instance.ui.lastError = null;
  if (!table) {
    instance.ui.preview = null;
    instance.ui.schema = null;
    instance.ui.queryResult = null;
    return;
  }
  instance.ui.schema = instance.store.describeTable(table);
  instance.ui.preview = instance.store.preview(table, {
    limit: DEFAULT_PAGE_SIZE,
    offset: 0,
  });
  // Seed a per-table query so the SQL view is scoped to this table.
  instance.ui.sqlDraft = seedSql(table);
  instance.ui.queryResult = null;
  // If the user is currently in SQL mode, run the seeded query immediately.
  if (instance.ui.tab === "sql" && isSelectLike(instance.ui.sqlDraft)) {
    try {
      instance.ui.queryResult = instance.store.query(instance.ui.sqlDraft);
    } catch (err) {
      instance.ui.lastError = err?.message || String(err);
    }
  }
}

export async function handleApi(entry, pathname, body) {
  const { instance } = entry;
  const { store, ui } = instance;

  try {
    if (pathname === "/api/state") {
      return { ok: true, state: buildClientState(instance) };
    }

    if (pathname === "/api/open") {
      store.open(body.path, { create: !!body.create });
      ui.selectedTable = null;
      ui.preview = null;
      ui.schema = null;
      ui.queryResult = null;
      ui.lastError = null;
      const tables = store.listTables();
      if (tables.length) selectTable(instance, tables[0].name);
      return { ok: true, state: buildClientState(instance) };
    }

    if (pathname === "/api/close") {
      store.close();
      ui.selectedTable = null;
      ui.preview = null;
      ui.schema = null;
      ui.queryResult = null;
      ui.lastError = null;
      return { ok: true, state: buildClientState(instance) };
    }

    if (pathname === "/api/select-table") {
      selectTable(instance, body.table);
      return { ok: true, state: buildClientState(instance) };
    }

    if (pathname === "/api/preview") {
      const table = body.table || ui.selectedTable;
      if (!table) throw new DbError("No table selected", "bad_table");
      ui.selectedTable = table;
      ui.preview = store.preview(table, {
        limit: body.limit,
        offset: body.offset,
      });
      ui.schema = store.describeTable(table);
      ui.tab = "data";
      ui.lastError = null;
      return { ok: true, state: buildClientState(instance) };
    }

    if (pathname === "/api/describe") {
      const table = body.table || ui.selectedTable;
      if (!table) throw new DbError("No table selected", "bad_table");
      ui.schema = store.describeTable(table);
      ui.lastError = null;
      return { ok: true, state: buildClientState(instance) };
    }

    if (pathname === "/api/query") {
      if (typeof body.sql === "string") ui.sqlDraft = body.sql;
      const result = store.query(body.sql ?? ui.sqlDraft);
      ui.queryResult = result;
      ui.tab = "sql";
      ui.lastError = null;
      // Refresh table list after writes
      if (result.kind === "write" || result.kind === "exec") {
        const tables = store.listTables();
        if (ui.selectedTable && !tables.some((t) => t.name === ui.selectedTable)) {
          ui.selectedTable = tables[0]?.name || null;
        }
        if (ui.selectedTable) {
          try {
            ui.schema = store.describeTable(ui.selectedTable);
            ui.preview = store.preview(ui.selectedTable, {
              limit: ui.preview?.limit || DEFAULT_PAGE_SIZE,
              offset: 0,
            });
          } catch {
            /* ignore */
          }
        }
      }
      return { ok: true, state: buildClientState(instance) };
    }

    if (pathname === "/api/set-tab") {
      if (body.tab === "data" || body.tab === "sql") {
        ui.tab = body.tab;
        // Toggling into SQL runs the current (seeded or edited) query if it's read-only.
        if (body.tab === "sql" && ui.selectedTable && isSelectLike(ui.sqlDraft)) {
          try {
            ui.queryResult = store.query(ui.sqlDraft);
            ui.lastError = null;
          } catch (err) {
            ui.lastError = err?.message || String(err);
          }
        }
      }
      return { ok: true, state: buildClientState(instance) };
    }

    if (pathname === "/api/set-sql") {
      if (typeof body.sql === "string") ui.sqlDraft = body.sql;
      return { ok: true, state: buildClientState(instance) };
    }

    if (pathname === "/api/refresh") {
      ui.lastError = null;
      if (ui.selectedTable) {
        ui.schema = store.describeTable(ui.selectedTable);
        ui.preview = store.preview(ui.selectedTable, {
          limit: ui.preview?.limit || DEFAULT_PAGE_SIZE,
          offset: ui.preview?.offset || 0,
        });
      }
      return { ok: true, state: buildClientState(instance) };
    }

    return { ok: false, error: "Not found", code: "not_found" };
  } catch (err) {
    const payload = toErrorPayload(err);
    ui.lastError = payload.error;
    return { ...payload, state: buildClientState(instance) };
  }
}

export async function startServer(instanceId, instance) {
  const clients = new Set();
  const entry = { instanceId, instance, clients, server: null, url: null };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(renderHtml());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        sendJson(res, 200, { ok: true, state: buildClientState(instance) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        res.write(`event: state\ndata: ${JSON.stringify(buildClientState(instance))}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }

      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        const body = await readBody(req);
        const result = await handleApi(entry, url.pathname, body);
        pushState(entry);
        sendJson(res, result.ok ? 200 : result.code === "not_found" ? 404 : 400, result);
        return;
      }

      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      sendJson(res, 500, toErrorPayload(err));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  entry.server = server;
  entry.url = `http://127.0.0.1:${port}/`;
  return entry;
}

export async function stopServer(entry) {
  if (!entry) return;
  for (const client of entry.clients) {
    try {
      client.end();
    } catch {
      /* ignore */
    }
  }
  entry.clients.clear();
  try {
    entry.instance.store.close();
  } catch {
    /* ignore */
  }
  if (entry.server) {
    await new Promise((resolve) => entry.server.close(() => resolve()));
  }
}
