// SQLite access for the canvas. Uses Node's built-in node:sqlite (DatabaseSync).

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;
export const MAX_RESULT_ROWS = 1000;

const RECENTS_PATH = resolve(homedir(), ".sqlite-canvas", "recents.json");
const MAX_RECENTS = 12;

export class DbError extends Error {
  constructor(message, code = "db_error") {
    super(message);
    this.name = "DbError";
    this.code = code;
  }
}

function ensureSqlite() {
  if (typeof DatabaseSync !== "function") {
    throw new DbError(
      "node:sqlite is unavailable in this runtime. Use a Node host that exposes DatabaseSync (Node 22.5+).",
      "no_sqlite",
    );
  }
}

function normalizePath(path) {
  if (typeof path !== "string" || !path.trim()) {
    throw new DbError("A database path is required.", "bad_path");
  }
  const trimmed = path.trim().replace(/^["']|["']$/g, "");
  const abs = isAbsolute(trimmed) ? resolve(trimmed) : resolve(process.cwd(), trimmed);
  return abs;
}

function serializeValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) {
    if (value.length > 64) return `<blob ${value.length} bytes>`;
    return `0x${value.toString("hex")}`;
  }
  if (value instanceof Uint8Array) {
    if (value.byteLength > 64) return `<blob ${value.byteLength} bytes>`;
    return `0x${Buffer.from(value).toString("hex")}`;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function rowToObject(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = serializeValue(v);
  return out;
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

export function loadRecents() {
  try {
    const raw = readFileSync(RECENTS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((p) => typeof p === "string").slice(0, MAX_RECENTS);
    }
  } catch {
    /* missing or corrupt */
  }
  return [];
}

export function pushRecent(path) {
  const abs = normalizePath(path);
  const next = [abs, ...loadRecents().filter((p) => p !== abs)].slice(0, MAX_RECENTS);
  mkdirSync(dirname(RECENTS_PATH), { recursive: true });
  writeFileSync(RECENTS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function createStore() {
  ensureSqlite();

  /** @type {{ db: DatabaseSync | null, path: string | null }} */
  const state = { db: null, path: null };

  function requireDb() {
    if (!state.db || !state.path) {
      throw new DbError("No database is open.", "not_open");
    }
    return state.db;
  }

  function open(path, { create = false } = {}) {
    ensureSqlite();
    const abs = normalizePath(path);
    if (!create && !existsSync(abs)) {
      throw new DbError(`File not found: ${abs}`, "not_found");
    }
    if (state.db) {
      try {
        state.db.close();
      } catch {
        /* ignore */
      }
      state.db = null;
      state.path = null;
    }
    try {
      const db = new DatabaseSync(abs);
      db.exec("PRAGMA foreign_keys = ON;");
      state.db = db;
      state.path = abs;
      pushRecent(abs);
      return getState();
    } catch (err) {
      throw new DbError(err?.message || String(err), "open_failed");
    }
  }

  function close() {
    if (state.db) {
      try {
        state.db.close();
      } catch {
        /* ignore */
      }
    }
    state.db = null;
    state.path = null;
    return getState();
  }

  function listTables() {
    const db = requireDb();
    const rows = db
      .prepare(
        `SELECT name, type, sql
         FROM sqlite_master
         WHERE type IN ('table', 'view')
           AND name NOT LIKE 'sqlite_%'
         ORDER BY type ASC, name COLLATE NOCASE ASC`,
      )
      .all();

    return rows.map((row) => {
      let rowCount = null;
      if (row.type === "table") {
        try {
          const countRow = db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(row.name)}`).get();
          rowCount = Number(countRow?.c ?? 0);
        } catch {
          rowCount = null;
        }
      }
      return {
        name: row.name,
        type: row.type,
        sql: row.sql || null,
        rowCount,
      };
    });
  }

  function describeTable(table) {
    if (!table || typeof table !== "string") {
      throw new DbError("table is required", "bad_table");
    }
    const db = requireDb();
    const master = db
      .prepare(
        `SELECT name, type, sql FROM sqlite_master
         WHERE type IN ('table','view') AND name = ?`,
      )
      .get(table);
    if (!master) throw new DbError(`No table or view named "${table}"`, "missing_table");

    const columns = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((c) => ({
      cid: c.cid,
      name: c.name,
      type: c.type || "",
      notnull: !!c.notnull,
      defaultValue: c.dflt_value,
      pk: c.pk || 0,
    }));

    let indexes = [];
    try {
      const indexList = db.prepare(`PRAGMA index_list(${quoteIdent(table)})`).all();
      indexes = indexList.map((idx) => {
        const cols = db
          .prepare(`PRAGMA index_info(${quoteIdent(idx.name)})`)
          .all()
          .map((c) => c.name)
          .filter(Boolean);
        return {
          name: idx.name,
          unique: !!idx.unique,
          origin: idx.origin || null,
          partial: !!idx.partial,
          columns: cols,
        };
      });
    } catch {
      indexes = [];
    }

    let foreignKeys = [];
    try {
      foreignKeys = db.prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`).all().map((fk) => ({
        id: fk.id,
        table: fk.table,
        from: fk.from,
        to: fk.to,
        onUpdate: fk.on_update,
        onDelete: fk.on_delete,
      }));
    } catch {
      foreignKeys = [];
    }

    let rowCount = null;
    if (master.type === "table") {
      try {
        rowCount = Number(db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`).get()?.c ?? 0);
      } catch {
        rowCount = null;
      }
    }

    return {
      name: master.name,
      type: master.type,
      sql: master.sql || null,
      columns,
      indexes,
      foreignKeys,
      rowCount,
    };
  }

  function preview(table, { limit = DEFAULT_PAGE_SIZE, offset = 0 } = {}) {
    if (!table || typeof table !== "string") {
      throw new DbError("table is required", "bad_table");
    }
    const db = requireDb();
    const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const master = db
      .prepare(
        `SELECT name, type FROM sqlite_master
         WHERE type IN ('table','view') AND name = ?`,
      )
      .get(table);
    if (!master) throw new DbError(`No table or view named "${table}"`, "missing_table");

    const started = performance.now();
    const stmt = db.prepare(
      `SELECT * FROM ${quoteIdent(table)} LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    );
    const rawRows = stmt.all();
    const durationMs = Math.round(performance.now() - started);

    const columns =
      rawRows.length > 0
        ? Object.keys(rawRows[0])
        : describeTable(table).columns.map((c) => c.name);

    let total = null;
    try {
      total = Number(db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`).get()?.c ?? 0);
    } catch {
      total = null;
    }

    return {
      table,
      columns,
      rows: rawRows.map(rowToObject),
      limit: safeLimit,
      offset: safeOffset,
      total,
      durationMs,
      truncated: total != null ? safeOffset + rawRows.length < total : false,
    };
  }

  function isSelectLike(sql) {
    const stripped = String(sql)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ")
      .trim()
      .toLowerCase();
    return /^(select|with|pragma|explain)\b/.test(stripped);
  }

  function query(sql) {
    if (typeof sql !== "string" || !sql.trim()) {
      throw new DbError("sql is required", "bad_sql");
    }
    const db = requireDb();
    const text = sql.trim();
    const started = performance.now();

    try {
      if (isSelectLike(text)) {
        const stmt = db.prepare(text);
        const rawRows = stmt.all();
        const durationMs = Math.round(performance.now() - started);
        const truncated = rawRows.length > MAX_RESULT_ROWS;
        const sliced = truncated ? rawRows.slice(0, MAX_RESULT_ROWS) : rawRows;
        const columns = sliced.length > 0 ? Object.keys(sliced[0]) : [];
        return {
          kind: "rows",
          columns,
          rows: sliced.map(rowToObject),
          rowCount: sliced.length,
          totalMatched: rawRows.length,
          truncated,
          changes: 0,
          lastInsertRowid: null,
          durationMs,
          sql: text,
        };
      }

      // Allow multi-statement scripts for writes via exec, but prefer prepare().run for single statements.
      const hasMultiple = /;\s*\S/.test(text.replace(/;+\s*$/, ""));
      if (hasMultiple) {
        db.exec(text);
        const durationMs = Math.round(performance.now() - started);
        return {
          kind: "exec",
          columns: [],
          rows: [],
          rowCount: 0,
          totalMatched: 0,
          truncated: false,
          changes: null,
          lastInsertRowid: null,
          durationMs,
          sql: text,
        };
      }

      const result = db.prepare(text).run();
      const durationMs = Math.round(performance.now() - started);
      return {
        kind: "write",
        columns: [],
        rows: [],
        rowCount: 0,
        totalMatched: 0,
        truncated: false,
        changes: Number(result?.changes ?? 0),
        lastInsertRowid:
          result?.lastInsertRowid == null ? null : String(result.lastInsertRowid),
        durationMs,
        sql: text,
      };
    } catch (err) {
      throw new DbError(err?.message || String(err), "query_failed");
    }
  }

  function getSchema() {
    const tables = listTables();
    return {
      path: state.path,
      tables: tables.map((t) => {
        try {
          return describeTable(t.name);
        } catch {
          return { name: t.name, type: t.type, error: "describe_failed" };
        }
      }),
    };
  }

  function getState() {
    let tables = [];
    let error = null;
    if (state.db) {
      try {
        tables = listTables();
      } catch (err) {
        error = err?.message || String(err);
      }
    }
    return {
      open: !!state.db,
      path: state.path,
      tables,
      recents: loadRecents(),
      error,
    };
  }

  return {
    open,
    close,
    listTables,
    describeTable,
    preview,
    query,
    getSchema,
    getState,
  };
}
