# SQLite canvas

Browse local SQLite databases and run SQL from a Copilot side-panel canvas.

Open a `.db` / `.sqlite` file, inspect tables and schema, page through rows, and
execute read or write SQL. The agent can drive the same surface via canvas
actions (`open`, `query`, `preview`, …).

## Install

From the loadout repo root (junction into your user extensions dir):

```bash
node scripts/install-canvases.mjs --only sqlite
```

Or promote a detached copy:

```bash
node scripts/install-canvases.mjs --only sqlite --copy --force
```

Or point Copilot's `install_extension` at this folder:

```
install_extension url:https://github.com/burkeholland/loadout/tree/main/canvases/sqlite scope:user
```

Reload extensions (or restart the session). The **SQLite** canvas becomes available.

## Requirements

- Copilot host with Node that exposes `node:sqlite` (`DatabaseSync`) — Node 22.5+ / current Copilot app builds.
- Local filesystem access to the database file.

## Use

1. Open the **SQLite** canvas (`open_canvas` with `canvasId: "sqlite"`).
2. Paste an absolute DB path and click **Open**, or pass `{ path }` on open.
3. Select a table to preview rows and schema.
4. Switch to **SQL** to run statements (`Ctrl/Cmd+Enter`).

### Agent actions

| Action | Purpose |
| --- | --- |
| `open` | Open/replace DB path |
| `close` | Close DB |
| `get_state` | Path, tables, selection, errors |
| `list_tables` | Tables/views |
| `describe_table` | Columns, indexes, FKs |
| `preview` | Paginated row preview |
| `query` | Execute SQL |
| `get_schema` | Full schema dump |
| `refresh` | Re-read selection |

## Layout

| File | Role |
| --- | --- |
| `extension.mjs` | Canvas declaration + actions |
| `server.mjs` | Local HTTP + SSE backend |
| `db.mjs` | `node:sqlite` wrapper |
| `webview.mjs` | Postrboard UI |

## Notes

- Writes are allowed. Result sets are capped (1000 rows) so huge selects stay usable.
- Recent paths are stored in `~/.sqlite-canvas/recents.json`.
- The UI server binds to `127.0.0.1` only.
