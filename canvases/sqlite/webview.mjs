// SQLite canvas webview — minimal, delightful data browser.

export function renderHtml() {
  return `<!doctype html>
<html lang="en" data-mode="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SQLite</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://burkeholland.github.io/postrboard-design/postrboard.min.css" />
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      position: relative;
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      font-size: 13px;
      line-height: 1.35;
      overflow: hidden;
    }
    * { -webkit-font-smoothing: antialiased; }

    .app {
      height: 100%;
      display: grid;
      grid-template-rows: 46px minmax(0, 1fr);
      min-width: 0;
    }

    header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 14px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      min-width: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 9px;
      flex-shrink: 0;
      min-width: 0;
    }
    .brand-mark {
      width: 24px;
      height: 24px;
      border-radius: 7px;
      background: linear-gradient(135deg, var(--coral) 0%, color-mix(in srgb, var(--coral) 60%, var(--azure)) 100%);
      color: white;
      display: grid;
      place-items: center;
      flex-shrink: 0;
      box-shadow: 0 1px 2px color-mix(in srgb, var(--coral) 40%, transparent);
    }
    .brand-mark svg { width: 13px; height: 13px; }
    .brand strong {
      font-family: var(--mono);
      font-size: 12.5px;
      font-weight: 600;
      letter-spacing: -0.02em;
      white-space: nowrap;
    }
    .brand .file {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--text-meta);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 26ch;
    }
    .brand .file:not(:empty)::before {
      content: "/";
      margin: 0 7px 0 3px;
      color: color-mix(in srgb, var(--border) 90%, var(--text));
    }
    .spacer { flex: 1; }

    .icon-btn {
      width: 30px;
      height: 30px;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      border-radius: 8px;
      display: grid;
      place-items: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: background .12s ease, color .12s ease;
    }
    .icon-btn:hover { background: color-mix(in srgb, var(--text) 7%, transparent); color: var(--text); }
    .icon-btn.on { background: var(--coral-tint); color: var(--coral-text); }
    .icon-btn svg { width: 15px; height: 15px; }

    .err {
      display: none;
      padding: 8px 14px;
      color: var(--danger-text);
      background: var(--danger-tint);
      border-bottom: 1px solid color-mix(in srgb, var(--danger) 25%, var(--border));
      font-family: var(--mono);
      font-size: 12px;
    }
    .err.show { display: block; }

    .body {
      min-height: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }

    .workspace {
      min-height: 0;
      min-width: 0;
      display: grid;
      grid-template-columns: 208px minmax(0, 1fr);
    }
    .workspace.has-schema {
      grid-template-columns: 208px minmax(0, 1fr) 236px;
    }
    .rail, .main, .schema { min-width: 0; min-height: 0; }

    .rail {
      border-right: 1px solid var(--border);
      background: var(--surface);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }
    .rail-label {
      padding: 12px 14px 7px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--text-meta);
    }
    .table-list { overflow: auto; padding: 0 8px 10px; }
    .table-item {
      position: relative;
      width: 100%;
      display: flex;
      align-items: center;
      gap: 9px;
      border: 0;
      background: transparent;
      color: var(--text);
      text-align: left;
      padding: 7px 9px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 12px;
      transition: background .1s ease;
    }
    .table-item:hover { background: color-mix(in srgb, var(--text) 5%, transparent); }
    .table-item.active {
      background: var(--coral-tint);
      color: var(--coral-text);
    }
    .table-item.active::before {
      content: "";
      position: absolute;
      left: 0; top: 6px; bottom: 6px;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background: var(--coral);
    }
    .dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--azure) 70%, transparent);
      flex-shrink: 0;
    }
    .table-item .dot.view { background: color-mix(in srgb, var(--violet, var(--azure)) 70%, transparent); border-radius: 1px; }
    .table-item.active .dot { background: var(--coral); }
    .table-item .name {
      flex: 1;
      min-width: 0;
      font-family: var(--mono);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .table-item .count {
      font-family: var(--mono);
      font-size: 11px;
      color: var(--text-meta);
      font-variant-numeric: tabular-nums;
    }
    .table-item.active .count { color: var(--coral-text); opacity: 0.7; }
    .empty {
      padding: 14px;
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.45;
    }

    .main {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      background: var(--bg);
    }
    .table-bar {
      display: none;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--border);
      background: var(--bg);
      min-width: 0;
    }
    .table-bar.show { display: flex; }
    .tb-name {
      font-family: var(--mono);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: -0.01em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tb-count {
      font-family: var(--mono);
      font-size: 10.5px;
      color: var(--text-meta);
      background: color-mix(in srgb, var(--text) 6%, transparent);
      border-radius: 999px;
      padding: 2px 8px;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }

    .seg {
      display: inline-flex;
      background: color-mix(in srgb, var(--text) 5%, transparent);
      border-radius: 8px;
      padding: 2px;
      flex-shrink: 0;
    }
    .seg button {
      border: 0;
      background: transparent;
      color: var(--text-muted);
      height: 26px;
      padding: 0 13px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: color .12s ease;
    }
    .seg button:hover { color: var(--text); }
    .seg button.active {
      background: var(--bg);
      color: var(--text);
      box-shadow: 0 1px 2px color-mix(in srgb, black 12%, transparent), 0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent);
    }

    .content {
      min-height: 0;
      min-width: 0;
      display: grid;
      grid-template-rows: minmax(0, 1fr);
    }
    .main.sql-mode .content { grid-template-rows: minmax(120px, 34%) minmax(0, 1fr); }

    .sql-editor-wrap {
      display: none;
      grid-template-rows: minmax(0, 1fr) auto;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      min-height: 0;
    }
    .main.sql-mode .sql-editor-wrap { display: grid; }
    #sql-editor {
      width: 100%; height: 100%;
      resize: none; border: 0; outline: none;
      background: transparent;
      color: var(--text);
      font-family: var(--mono);
      font-size: 12.5px;
      line-height: 1.55;
      padding: 12px 14px;
      box-sizing: border-box;
      tab-size: 2;
    }
    .sql-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      border-top: 1px solid var(--border);
    }
    .sql-actions .run {
      border: 0;
      background: var(--coral-surface);
      color: var(--on-accent);
      height: 27px;
      padding: 0 14px;
      border-radius: 7px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background .12s ease, transform .06s ease;
    }
    .sql-actions .run:hover { background: var(--coral-hover); }
    .sql-actions .run:active { transform: translateY(1px); }
    .sql-actions .kbd {
      margin-left: auto;
      font-family: var(--mono);
      font-size: 10.5px;
      color: var(--text-meta);
    }

    .grid-wrap { overflow: auto; min-height: 0; min-width: 0; }

    .result-meta {
      display: flex;
      gap: 12px;
      padding: 6px 14px;
      border-bottom: 1px solid var(--border);
      font-family: var(--mono);
      font-size: 11px;
      color: var(--text-meta);
      background: var(--bg);
      position: sticky;
      top: 0;
      z-index: 3;
    }
    .result-meta .ok { color: var(--sage-text); font-weight: 600; }

    table.data-grid {
      border-collapse: separate;
      border-spacing: 0;
      width: max-content;
      min-width: 100%;
      font-size: 12px;
      animation: fade .14s ease;
    }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    table.data-grid th, table.data-grid td {
      border-bottom: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
      padding: 8px 14px;
      text-align: left;
      vertical-align: middle;
      max-width: 30ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    table.data-grid th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: color-mix(in srgb, var(--surface) 96%, var(--bg));
      border-bottom: 1px solid var(--border);
      vertical-align: bottom;
      padding-top: 9px;
      padding-bottom: 7px;
    }
    .th-name {
      font-family: var(--mono);
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text);
      display: block;
    }
    .th-type {
      font-family: var(--mono);
      font-size: 9.5px;
      font-weight: 500;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--text-meta);
      display: block;
      margin-top: 1px;
    }
    table.data-grid td {
      font-family: var(--mono);
      font-variant-numeric: tabular-nums;
      color: var(--text);
    }
    th.num, td.num { text-align: right; }
    table.data-grid tbody tr { transition: background .08s ease; }
    table.data-grid tbody tr:nth-child(even) td {
      background: color-mix(in srgb, var(--text) 2%, transparent);
    }
    table.data-grid tbody tr:hover td {
      background: color-mix(in srgb, var(--azure) 8%, transparent);
    }
    .null { color: var(--text-meta); font-style: italic; opacity: 0.75; }

    .pager {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      border-top: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-meta);
      font-family: var(--mono);
      font-size: 11px;
    }
    .pager.show { display: flex; }
    .pager button {
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text);
      height: 25px;
      padding: 0 10px;
      border-radius: 7px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background .1s ease;
    }
    .pager button:hover:not(:disabled) { background: color-mix(in srgb, var(--text) 5%, transparent); }
    .pager button:disabled { opacity: 0.35; cursor: not-allowed; }
    .pager .grow { flex: 1; }
    .pager .lbl { font-variant-numeric: tabular-nums; }

    .schema {
      display: none;
      border-left: 1px solid var(--border);
      background: var(--surface);
      overflow: auto;
      padding: 14px;
    }
    .workspace.has-schema .schema { display: block; }
    .schema h2 {
      margin: 0;
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 600;
    }
    .schema .sub {
      margin: 3px 0 14px;
      font-family: var(--mono);
      font-size: 11px;
      color: var(--text-meta);
    }
    .col {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    }
    .col:last-child { border-bottom: 0; }
    .col .n {
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 500;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .col .t {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--azure-text);
      flex-shrink: 0;
    }
    .pk {
      display: inline-block;
      margin-left: 7px;
      font-family: var(--mono);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: var(--coral-text);
      background: var(--coral-tint);
      border-radius: 999px;
      padding: 1px 6px;
      vertical-align: middle;
    }

    .empty-main {
      height: 100%;
      display: grid;
      place-items: center;
      color: var(--text-muted);
      font-size: 13px;
      padding: 24px;
      text-align: center;
    }
    .empty-main .big {
      display: grid;
      justify-items: center;
      gap: 10px;
    }
    .empty-main svg { width: 26px; height: 26px; color: var(--text-meta); opacity: 0.7; }

    .open-overlay {
      display: none;
      position: absolute;
      inset: 46px 0 0;
      background: color-mix(in srgb, var(--bg) 90%, transparent);
      backdrop-filter: blur(8px);
      place-items: center;
      z-index: 20;
      padding: 24px;
    }
    .open-overlay.show { display: grid; }
    .open-card {
      width: min(440px, 100%);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px;
      box-shadow: 0 20px 60px color-mix(in srgb, black 30%, transparent);
      animation: pop .16s ease;
    }
    @keyframes pop { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: none; } }
    .open-card h2 { margin: 0 0 4px; font-size: 15px; font-weight: 650; }
    .open-card p { margin: 0 0 14px; color: var(--text-muted); font-size: 12px; }
    .open-card form { display: flex; gap: 8px; }
    .open-card input {
      flex: 1; min-width: 0; height: 34px;
      border-radius: 9px;
      border: 1px solid var(--input-border);
      background: var(--bg);
      color: var(--text);
      font-family: var(--mono);
      font-size: 12px;
      padding: 0 12px;
    }
    .open-card input:focus { outline: none; box-shadow: var(--focus-ring); }
    .open-card button[type="submit"] {
      border: 0;
      background: var(--coral-surface);
      color: var(--on-accent);
      height: 34px; padding: 0 16px;
      border-radius: 9px;
      font-size: 12px; font-weight: 600;
      cursor: pointer;
    }
    .recents { margin-top: 14px; display: flex; flex-direction: column; gap: 3px; }
    .recents .rlabel {
      font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--text-meta); margin-bottom: 4px;
    }
    .recents button {
      text-align: left; border: 0; background: transparent;
      color: var(--text-muted);
      font-family: var(--mono); font-size: 11px;
      padding: 7px 9px; border-radius: 7px; cursor: pointer;
      transition: background .1s ease;
    }
    .recents button:hover { background: color-mix(in srgb, var(--text) 5%, transparent); color: var(--text); }

    @media (max-width: 760px) {
      .workspace, .workspace.has-schema { grid-template-columns: 168px minmax(0, 1fr); }
      .schema { display: none !important; }
      .brand .file { display: none; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
            <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path>
          </svg>
        </div>
        <strong>SQLite</strong>
        <span class="file" id="file-name"></span>
      </div>
      <div class="spacer"></div>
      <button class="icon-btn" type="button" id="btn-schema" title="Toggle schema">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>
        </svg>
      </button>
      <button class="icon-btn" type="button" id="btn-open" title="Open database">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7h18v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M3 7l2.5-3h13L21 7"/>
        </svg>
      </button>
      <button class="icon-btn" type="button" id="btn-theme" title="Toggle color mode">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>
        </svg>
      </button>
    </header>

    <div class="body">
      <div class="err" id="err"></div>
      <div class="workspace" id="workspace">
        <aside class="rail">
          <div class="rail-label">Tables</div>
          <div class="table-list" id="table-list"><div class="empty">No database</div></div>
        </aside>

        <section class="main" id="main">
          <div class="table-bar" id="table-bar">
            <span class="tb-name" id="tb-name"></span>
            <span class="tb-count" id="tb-count"></span>
            <div class="spacer"></div>
            <div class="seg" id="seg">
              <button type="button" data-tab="data" class="active">Data</button>
              <button type="button" data-tab="sql">SQL</button>
            </div>
          </div>
          <div class="content" id="content">
            <div class="sql-editor-wrap">
              <textarea id="sql-editor" spellcheck="false"></textarea>
              <div class="sql-actions">
                <button type="button" class="run" id="btn-run">Run</button>
                <span class="kbd">Ctrl/Cmd + Enter</span>
              </div>
            </div>
            <div class="grid-wrap" id="grid-wrap">
              <div class="empty-main"><div class="big">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>
                <div>Open a database to begin</div>
              </div></div>
            </div>
          </div>
          <div class="pager" id="pager">
            <button type="button" id="page-prev">Prev</button>
            <button type="button" id="page-next">Next</button>
            <span class="grow"></span>
            <span class="lbl" id="page-label"></span>
          </div>
        </section>

        <aside class="schema" id="schema">
          <h2 id="schema-title">Schema</h2>
          <div class="sub" id="schema-sub"></div>
          <div id="schema-body"></div>
        </aside>
      </div>
    </div>
  </div>

  <div class="open-overlay" id="open-overlay">
    <div class="open-card">
      <h2>Open database</h2>
      <p>Absolute path to a local .db / .sqlite file.</p>
      <form id="open-form">
        <input id="path-input" type="text" spellcheck="false" placeholder="D:\\path\\to\\file.db" autocomplete="off" />
        <button type="submit">Open</button>
      </form>
      <div class="recents" id="recents"></div>
    </div>
  </div>

  <script>
    const NUMERIC = /(INT|REAL|FLOA|DOUB|NUM|DEC|MONEY)/i;
    const state = {
      open: false, path: null, tables: [], recents: [],
      selectedTable: null, tab: "data",
      preview: null, schema: null, queryResult: null,
      lastError: null, sqlDraft: "",
    };
    let showSchema = false;
    try { showSchema = localStorage.getItem("sqlite-canvas-schema") === "1"; } catch {}

    const $ = (id) => document.getElementById(id);
    const els = {
      fileName: $("file-name"), err: $("err"), workspace: $("workspace"),
      tableList: $("table-list"), main: $("main"),
      tableBar: $("table-bar"), tbName: $("tb-name"), tbCount: $("tb-count"),
      seg: $("seg"), content: $("content"), gridWrap: $("grid-wrap"),
      pager: $("pager"), pagePrev: $("page-prev"), pageNext: $("page-next"), pageLabel: $("page-label"),
      sqlEditor: $("sql-editor"),
      schema: $("schema"), schemaTitle: $("schema-title"), schemaSub: $("schema-sub"), schemaBody: $("schema-body"),
      openOverlay: $("open-overlay"), openForm: $("open-form"), pathInput: $("path-input"), recents: $("recents"),
      btnRun: $("btn-run"), btnOpen: $("btn-open"), btnTheme: $("btn-theme"), btnSchema: $("btn-schema"),
    };

    const basename = (p) => p ? String(p).split(/[/\\\\]/).pop() || p : "";
    const esc = (s) => String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
    const cell = (v) => (v === null || v === undefined) ? '<span class="null">null</span>' : esc(v);

    function typeMap() {
      const m = {};
      if (state.schema && state.selectedTable === state.schema.name) {
        for (const c of state.schema.columns || []) m[c.name] = c.type || "";
      }
      return m;
    }

    function renderGrid(columns, rows, types) {
      if (!columns || !columns.length) return '<div class="empty-main">No columns</div>';
      const numeric = columns.map((c) => types && NUMERIC.test(types[c] || ""));
      let html = '<table class="data-grid"><thead><tr>';
      columns.forEach((c, i) => {
        const t = types && types[c] ? '<span class="th-type">' + esc(types[c]) + '</span>' : '';
        html += '<th class="' + (numeric[i] ? 'num' : '') + '"><span class="th-name">' + esc(c) + '</span>' + t + '</th>';
      });
      html += '</tr></thead><tbody>';
      if (!rows.length) {
        html += '<tr><td colspan="' + columns.length + '"><span class="null">No rows</span></td></tr>';
      } else {
        for (const row of rows) {
          html += '<tr>';
          columns.forEach((c, i) => {
            html += '<td class="' + (numeric[i] ? 'num' : '') + '" title="' + esc(row[c]) + '">' + cell(row[c]) + '</td>';
          });
          html += '</tr>';
        }
      }
      return html + '</tbody></table>';
    }

    async function api(path, body = {}) {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (json.state) applyState(json.state);
      else if (!json.ok && json.error) { state.lastError = json.error; renderError(); }
      return json;
    }
    function applyState(next) { Object.assign(state, next || {}); render(); }

    function renderError() {
      if (state.lastError) { els.err.textContent = state.lastError; els.err.classList.add("show"); }
      else { els.err.textContent = ""; els.err.classList.remove("show"); }
    }

    function renderHeader() {
      els.fileName.textContent = state.open && state.path ? basename(state.path) : "";
      els.fileName.title = state.path || "";
      els.btnSchema.classList.toggle("on", showSchema && !!state.selectedTable);
    }

    function renderTables() {
      if (!state.open) { els.tableList.innerHTML = '<div class="empty">No database</div>'; return; }
      const tables = state.tables || [];
      if (!tables.length) { els.tableList.innerHTML = '<div class="empty">No tables</div>'; return; }
      els.tableList.innerHTML = tables.map((t) => {
        const active = t.name === state.selectedTable ? " active" : "";
        const count = t.rowCount == null ? "" : String(t.rowCount);
        const dot = t.type === "view" ? "dot view" : "dot";
        return '<button type="button" class="table-item' + active + '" data-table="' + esc(t.name) + '">'
          + '<span class="' + dot + '"></span>'
          + '<span class="name" title="' + esc(t.name) + '">' + esc(t.name) + '</span>'
          + '<span class="count">' + esc(count) + '</span></button>';
      }).join("");
    }

    function renderMain() {
      const hasTable = state.open && !!state.selectedTable;
      els.tableBar.classList.toggle("show", hasTable);
      els.main.classList.toggle("sql-mode", hasTable && state.tab === "sql");

      els.seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));

      if (hasTable) {
        els.tbName.textContent = state.selectedTable;
        const meta = state.tables.find((t) => t.name === state.selectedTable);
        els.tbCount.textContent = meta && meta.rowCount != null ? meta.rowCount + " rows" : "";
        els.tbCount.style.display = els.tbCount.textContent ? "" : "none";
      }

      if (!state.open) {
        els.gridWrap.innerHTML = '<div class="empty-main"><div class="big">'
          + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>'
          + '<div>Open a database to begin</div></div></div>';
        els.pager.classList.remove("show");
        return;
      }
      if (!state.selectedTable) {
        els.gridWrap.innerHTML = '<div class="empty-main">Pick a table from the left</div>';
        els.pager.classList.remove("show");
        return;
      }

      if (state.tab === "sql") {
        if (document.activeElement !== els.sqlEditor) els.sqlEditor.value = state.sqlDraft || "";
        const r = state.queryResult;
        els.pager.classList.remove("show");
        if (!r) { els.gridWrap.innerHTML = '<div class="empty-main">Run a query to see results</div>'; return; }
        let meta = '<div class="result-meta">';
        if (r.kind === "rows") meta += '<span class="ok">' + r.rowCount + ' rows</span><span>' + r.durationMs + ' ms</span>';
        else if (r.kind === "write") meta += '<span class="ok">OK</span><span>' + (r.changes ?? 0) + ' changes</span><span>' + r.durationMs + ' ms</span>';
        else meta += '<span class="ok">Executed</span><span>' + r.durationMs + ' ms</span>';
        meta += '</div>';
        els.gridWrap.innerHTML = r.kind === "rows" ? meta + renderGrid(r.columns, r.rows, null) : meta + '<div class="empty-main">Statement finished</div>';
        return;
      }

      // Data mode
      const p = state.preview;
      if (!p) { els.gridWrap.innerHTML = '<div class="empty-main">No preview</div>'; els.pager.classList.remove("show"); return; }
      els.gridWrap.innerHTML = renderGrid(p.columns, p.rows, typeMap());
      const start = (p.offset || 0) + 1;
      const end = (p.offset || 0) + (p.rows?.length || 0);
      const total = p.total;
      els.pageLabel.textContent = total == null ? ((p.rows?.length || 0) + " rows")
        : ((end === 0 ? "0" : (start + "–" + end)) + " of " + total);
      els.pager.classList.add("show");
      els.pagePrev.disabled = !p.offset;
      els.pageNext.disabled = total == null ? (p.rows?.length || 0) < (p.limit || 0) : end >= total;
    }

    function renderSchema() {
      const on = showSchema && state.open && !!state.selectedTable && !!state.schema;
      els.workspace.classList.toggle("has-schema", on);
      if (!on) return;
      const s = state.schema;
      els.schemaTitle.textContent = s.name;
      els.schemaSub.textContent = (s.type || "table") + (s.rowCount != null ? " · " + s.rowCount + " rows" : "");
      let html = "";
      for (const c of s.columns || []) {
        html += '<div class="col"><div class="n">' + esc(c.name) + (c.pk ? '<span class="pk">PK</span>' : '')
          + '</div><div class="t">' + esc(c.type || "ANY") + '</div></div>';
      }
      els.schemaBody.innerHTML = html || '<div class="empty">No columns</div>';
    }

    function fillRecents() {
      const recents = state.recents || [];
      els.recents.innerHTML = (recents.length ? '<div class="rlabel">Recent</div>' : '')
        + recents.map((p) => '<button type="button" data-path="' + esc(p) + '" title="' + esc(p) + '">' + esc(basename(p)) + '</button>').join("");
    }

    function renderOpen() {
      if (!state.open) {
        els.openOverlay.classList.add("show");
        els.pathInput.value = state.path || "";
        fillRecents();
      }
    }

    function render() {
      renderError(); renderHeader(); renderTables(); renderMain(); renderSchema(); renderOpen();
    }

    els.openForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const path = els.pathInput.value.trim();
      if (path) api("/api/open", { path });
    });
    els.btnOpen.addEventListener("click", () => {
      els.openOverlay.classList.add("show");
      els.pathInput.value = state.path || "";
      fillRecents();
      els.pathInput.focus(); els.pathInput.select();
    });
    els.openOverlay.addEventListener("click", (e) => {
      if (e.target === els.openOverlay && state.open) els.openOverlay.classList.remove("show");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.open) els.openOverlay.classList.remove("show");
    });

    els.btnRun.addEventListener("click", () => api("/api/query", { sql: els.sqlEditor.value }));
    els.btnTheme.addEventListener("click", () => {
      const h = document.documentElement;
      h.dataset.mode = h.dataset.mode === "dark" ? "light" : "dark";
      try { localStorage.setItem("sqlite-canvas-mode", h.dataset.mode); } catch {}
    });
    els.btnSchema.addEventListener("click", () => {
      showSchema = !showSchema;
      try { localStorage.setItem("sqlite-canvas-schema", showSchema ? "1" : "0"); } catch {}
      renderHeader(); renderSchema();
    });

    els.tableList.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-table]");
      if (btn) api("/api/select-table", { table: btn.dataset.table });
    });
    els.recents.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-path]");
      if (btn) api("/api/open", { path: btn.dataset.path });
    });
    els.seg.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (btn) api("/api/set-tab", { tab: btn.dataset.tab });
    });

    els.pagePrev.addEventListener("click", () => {
      const p = state.preview; if (!p) return;
      api("/api/preview", { table: p.table, limit: p.limit, offset: Math.max(0, (p.offset || 0) - (p.limit || 100)) });
    });
    els.pageNext.addEventListener("click", () => {
      const p = state.preview; if (!p) return;
      api("/api/preview", { table: p.table, limit: p.limit, offset: (p.offset || 0) + (p.limit || 100) });
    });

    els.sqlEditor.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); api("/api/query", { sql: els.sqlEditor.value }); }
    });
    let sqlTimer = null;
    els.sqlEditor.addEventListener("input", () => {
      clearTimeout(sqlTimer);
      sqlTimer = setTimeout(() => {
        state.sqlDraft = els.sqlEditor.value;
        fetch("/api/set-sql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: els.sqlEditor.value }) }).catch(() => {});
      }, 400);
    });

    try {
      const mode = localStorage.getItem("sqlite-canvas-mode");
      if (mode === "light" || mode === "dark") document.documentElement.dataset.mode = mode;
    } catch {}

    fetch("/api/state").then((r) => r.json()).then((j) => { if (j.state) applyState(j.state); else render(); }).catch(render);
    const ev = new EventSource("/events");
    ev.addEventListener("state", (e) => { try { applyState(JSON.parse(e.data)); } catch {} });
  </script>
</body>
</html>`;
}
