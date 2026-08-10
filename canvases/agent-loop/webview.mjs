// Webview renderer for the Agent Loop canvas.
// Vanilla JS single-page app. Reads durable state from /state (issue-authoritative)
// on a poll + SSE nudge; sends structured human intent via POST /intent.
//
// Styled with the vendored Postrboard design system (inlined for offline/private
// repos). Quiet, code-native surfaces; one accent per state; light + dark modes.

import { POSTRBOARD_CSS } from "./postrboard-css.mjs";

export function renderHtml(token = "", assetBase = "") {
  const cap = String(token).replace(/[^A-Za-z0-9_-]/g, "");
  const assets = String(assetBase).replace(/[^A-Za-z0-9:/._-]/g, "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="al-cap" content="${cap}" />
<meta name="al-assets" content="${assets}" />
<title>Flow</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>${POSTRBOARD_CSS}</style>
<style>
  /* Canvas-specific composition — tokens only, no new color systems. */
  body { font-size: 14px; }

  .appbar { position: sticky; top: 0; z-index: var(--z-sticky);
    background: var(--nav-bg); -webkit-backdrop-filter: var(--nav-blur); backdrop-filter: var(--nav-blur);
    border-bottom: 1px solid var(--border); }
  .appbar-inner { max-width: 940px; margin-inline: auto; padding: 12px 24px;
    display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
  .brand .mark { width: 32px; height: 32px; border-radius: var(--radius-compact); flex-shrink: 0;
    display: grid; place-items: center; background: var(--coral-surface); color: var(--on-accent);
    box-shadow: 0 4px 12px var(--shadow-coral-surface); }
  .brand .mark .icon { width: 18px; height: 18px; }
  .brand .who { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .brand .name { font-weight: 800; letter-spacing: -0.02em; font-size: 15px; line-height: 1.15; }
  .brand .meta { font-family: var(--mono); font-size: 11px; color: var(--text-meta);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .appbar .tools { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .icon-button.sm { width: 34px; height: 34px; }
  .icon-button .icon { width: 17px; height: 17px; }

  .shell { max-width: 940px; margin-inline: auto; padding: 22px 24px 80px; }

  /* Pipeline strip (Postrboard stepper) */
  .strip-wrap { padding: 16px 20px; margin-bottom: 24px; }
  .stepper { justify-content: space-between; }
  .step { cursor: default; gap: 7px; }
  .step .step-circle .icon { width: 15px; height: 15px; }
  .step-line { margin: 0 8px 24px; }
  .step-label { font-size: 11px; font-weight: 700; letter-spacing: 0.01em; color: var(--text-meta); }
  .step.done .step-label, .step.active .step-label { color: var(--text); }
  .step.nav { cursor: pointer; }
  .step.nav:hover .step-circle { border-color: var(--coral-surface); color: var(--text); }
  .step.viewing .step-circle { box-shadow: var(--focus-ring); border-color: var(--coral-surface); }
  .step.gate.active .step-circle { background: var(--warning); border-color: var(--warning); color: #1c1206; }

  /* Panel scaffolding */
  .eyebrow { font-family: var(--mono); font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.14em; color: var(--text-meta); display: inline-flex; align-items: center; gap: 7px; }
  .eyebrow .icon { width: 14px; height: 14px; }
  .panel-title { font-size: 22px; font-weight: 700; letter-spacing: -0.03em; margin: 10px 0 0; }
  .sub { color: var(--text-muted); font-size: 13px; margin: 8px 0 0; }
  .sub .issue-link { margin-left: 2px; }
  .issue-link { color: var(--azure-text); text-decoration: none; font-weight: 600;
    display: inline-flex; align-items: center; gap: 4px; }
  .issue-link:hover { text-decoration: underline; }
  .issue-link .icon { width: 13px; height: 13px; }
  .meta-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; }

  textarea, .textarea { min-height: 100px; resize: vertical; line-height: 1.55; }
  .btn .icon { width: 16px; height: 16px; }
  .btn.has-icon { gap: 8px; }
  .btn:disabled { opacity: 0.5; cursor: default; box-shadow: none; transform: none; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 14px; }
  label.field { display: block; font-size: 12px; font-weight: 600; color: var(--text-muted); margin: 0 0 8px; }

  /* Idle launcher */
  .idle-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin: 18px -24px 0; padding: 0 24px; }
  .idle-tab { border: 0; background: transparent; color: var(--text-muted); padding: 11px 12px;
    border-bottom: 2px solid transparent; font: inherit; font-weight: 700; cursor: pointer; }
  .idle-tab.active { color: var(--text); border-color: var(--coral-surface); }
  .idle-pane { padding-top: 18px; }
  .idle-pane[hidden] { display: none; }
  .build-search { width: 100%; margin-bottom: 10px; }
  .build-list { display: flex; flex-direction: column; }
  .build-item { width: 100%; display: grid; grid-template-columns: 38px minmax(0, 1fr) auto;
    align-items: center; gap: 12px; padding: 13px 2px; border: 0; border-top: 1px solid var(--border);
    background: transparent; color: var(--text); text-align: left; cursor: pointer; }
  .build-item:hover .build-title { color: var(--azure-text); }
  .build-item:disabled { opacity: 0.55; cursor: wait; }
  .build-number { width: 34px; height: 34px; border: 1px solid var(--border); border-radius: var(--radius-compact);
    display: grid; place-items: center; color: var(--text-meta); font: 11px var(--mono); }
  .build-copy { min-width: 0; }
  .build-title { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .build-meta { color: var(--text-meta); font-size: 11.5px; margin-top: 5px; }
  .build-state { display: flex; align-items: center; gap: 8px; }
  .build-empty { color: var(--text-muted); text-align: center; padding: 24px 8px 8px; font-size: 12.5px; }

  /* Working / status */
  .status-line { display: flex; align-items: center; gap: 14px; font-size: 15px; font-weight: 600; margin-top: 16px; }
  .status-line .spinner { width: 22px; height: 22px; border-width: 2px; }

  .brief { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border);
    font-size: 13.5px; color: var(--text); line-height: 1.7; }
  .brief h3 { font-size: 14px; margin: 18px 0 6px; letter-spacing: -0.01em; font-weight: 700; }
  .brief h3:first-child { margin-top: 0; }
  .brief p { margin: 8px 0; }
  .brief ul { margin: 8px 0 8px 20px; }
  .brief li { margin: 3px 0; }
  .brief strong { color: var(--text); font-weight: 700; }
  .brief a { color: var(--azure-text); text-decoration: none; }
  .brief a:hover { text-decoration: underline; }
  .brief code { font-family: var(--mono); font-size: 12px; background: var(--code-bg);
    padding: 1px 6px; border-radius: var(--radius-sharp); }
  .brief ol { margin: 8px 0 8px 20px; }
  .brief pre { margin: 10px 0; padding: 12px 14px; background: var(--code-bg);
    border: 1px solid var(--border); border-radius: var(--radius-sharp);
    overflow-x: auto; max-height: 420px; overflow-y: auto; }
  .brief pre code { display: block; background: none; padding: 0; font-size: 12px;
    line-height: 1.5; white-space: pre; }

  /* Feedback-gate PR review: changed files + inline diff + CI */
  .pr-review { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border); }
  .pr-summary { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .badge.badge-rust { background: var(--rust-tint, #f8e0da); color: var(--rust-text, #8a2f1a); }
  .badge.badge-amber { background: var(--amber-tint, #fbeecb); color: var(--amber-text, #7a5600); }
  .files { display: flex; flex-direction: column; gap: 6px; }
  details.file { border: 1px solid var(--border); border-radius: var(--radius-sharp); overflow: hidden; }
  details.file > summary { cursor: pointer; padding: 8px 12px; font-size: 12px;
    list-style: none; background: var(--code-bg); user-select: none; }
  details.file > summary::-webkit-details-marker { display: none; }
  details.file > summary code { font-family: var(--mono); }
  details.file[open] > summary { border-bottom: 1px solid var(--border); }
  details.file > p { margin: 10px 12px; }
  pre.diff { margin: 0; padding: 10px 0; overflow-x: auto; max-height: 460px; overflow-y: auto;
    font-family: var(--mono); font-size: 12px; line-height: 1.45; background: transparent; }
  pre.diff .dl { display: block; padding: 0 12px; white-space: pre; }
  pre.diff .diff-add { background: var(--sage-tint); }
  pre.diff .diff-del { background: var(--rust-tint, #f8e0da); }
  pre.diff .diff-hunk { color: var(--muted); background: var(--code-bg); }

  /* Prototype options */
  .gate-banner { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700;
    color: var(--warning-text); background: var(--warning-tint); padding: 6px 12px;
    border-radius: var(--radius-pill); margin-bottom: 14px; }
  .gate-banner .icon { width: 15px; height: 15px; }
  .opts { display: flex; flex-direction: column; gap: 18px; margin-top: 20px; }
  .opt { border: var(--border-normal) solid var(--border); border-radius: var(--radius-soft);
    overflow: hidden; background: var(--surface); transition: border-color var(--ease), box-shadow var(--ease); }
  .opt.sel { border-color: var(--coral-surface); box-shadow: 0 0 0 1px var(--coral-surface); }
  .opt .preview { background: var(--code-bg); border-bottom: 1px solid var(--border); }
  .preview-frame { width: 100%; height: 300px; border: 0; display: block; background: #fff; }
  .tryit { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border); }
  .tryit .t { font-weight: 700; font-size: 14px; letter-spacing: -0.01em; margin-bottom: 10px; }
  .tryit .preview { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .tryit .demo-frame { width: 100%; height: 380px; border: 0; display: block; background: #fff; }
  .tryit .run-steps { margin-top: 12px; }
  .tryit .run-steps ol { margin: 6px 0 0; padding-left: 20px; }
  .tryit .run-steps li { margin: 4px 0; }
  .tryit .run-steps code, .tryit .branch code { font-size: 12.5px; background: var(--code-bg);
    border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; }
  .tryit .branch { margin-top: 12px; font-size: 13px; color: var(--muted); }
  .opt .meta { padding: 16px 18px; }
  .opt .t { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; letter-spacing: -0.01em; }
  .opt .t .pick { margin-left: auto; flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
    border: 2px solid var(--border); display: grid; place-items: center; color: transparent; transition: all var(--ease); }
  .opt .t .pick .icon { width: 13px; height: 13px; }
  .opt.sel .t .pick { background: var(--coral-surface); border-color: var(--coral-surface); color: var(--on-accent); }
  .opt .p { color: var(--text-muted); font-size: 13px; margin-top: 7px; line-height: 1.55; }
  .opt .links { margin-top: 12px; font-size: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .opt .links a { color: var(--azure-text); text-decoration: none; display: inline-flex; align-items: center; gap: 5px; }
  .opt .links a:hover { text-decoration: underline; }
  .opt .links a .icon { width: 13px; height: 13px; }
  .opt .links code { font-family: var(--mono); color: var(--text-meta); }
  .opt .select-direction { margin-top: 16px; }

  /* Sticky decision bar */
  .decision { position: sticky; bottom: 0; margin-top: 22px; z-index: var(--z-dropdown);
    border: var(--border-normal) solid var(--border); border-radius: var(--radius-soft);
    background: var(--surface); box-shadow: var(--shadow-medium); padding: 18px; }
  .decision .sel-name { font-size: 13px; color: var(--text-muted); margin-bottom: 14px;
    display: flex; align-items: center; gap: 8px; }
  .decision .sel-name .icon { width: 15px; height: 15px; color: var(--coral-surface); }
  .decision .sel-name strong { color: var(--text); }
  .decision .hint { margin: 12px 0 0; font-size: 11.5px; color: var(--text-meta); }

  /* Review + done */
  .reviewbar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
  .done-icon { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
    background: var(--sage-tint); color: var(--sage-text); margin-bottom: 14px; }
  .done-icon .icon { width: 24px; height: 24px; }

  .muted { color: var(--text-muted); }

  /* Questionnaire — stepper + choices */
  .qprogress { margin: 18px 0 20px; }
  .qprogress-meta { display: flex; align-items: center; justify-content: space-between;
    font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; }
  .qbar { height: 6px; border-radius: var(--radius-pill); background: var(--border); overflow: hidden; }
  .qbar > span { display: block; height: 100%; background: var(--coral-surface);
    border-radius: var(--radius-pill); transition: width var(--ease); }
  .qstep-prompt { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.4;
    display: flex; align-items: baseline; gap: 9px; margin-bottom: 16px; }
  .choices { display: flex; flex-direction: column; gap: 8px; }
  .choice { display: flex; align-items: center; gap: 11px; cursor: pointer; position: relative;
    border: var(--border-normal) solid var(--border); border-radius: var(--radius-soft);
    padding: 12px 14px; background: var(--surface); transition: border-color var(--ease), background var(--ease); }
  .choice:hover { border-color: var(--coral-surface); }
  .choice.on { border-color: var(--coral-surface); background: var(--coral-tint); }
  .choice .choice-input { position: absolute; opacity: 0; width: 0; height: 0; }
  .choice-mark { flex-shrink: 0; width: 20px; height: 20px; border: 2px solid var(--border);
    display: grid; place-items: center; color: transparent; transition: all var(--ease); }
  .choice-mark.dot { border-radius: 50%; }
  .choice-mark.box { border-radius: var(--radius-sharp); }
  .choice-mark.on { background: var(--coral-surface); border-color: var(--coral-surface); color: var(--on-accent); }
  .choice-mark .icon { width: 12px; height: 12px; }
  .choice-text { font-size: 14px; font-weight: 500; color: var(--text); }
  .choice.on .choice-text { font-weight: 600; }
  .qnav { justify-content: space-between; margin-top: 22px; }
  .qnav .btn-secondary.has-icon, .qnav .btn.has-icon { gap: 6px; }
  /* Read-only questionnaire list */
  .qitem { padding: 14px 0; border-top: 1px solid var(--border); }
  .qitem:first-child { border-top: 0; padding-top: 4px; }
  .qprompt { font-size: 14px; font-weight: 600; color: var(--text); display: flex; align-items: baseline; gap: 8px; }
  .qchoices-ro { margin: 8px 0 0 22px; padding: 0; color: var(--text-muted); font-size: 13px; }
  .qchoices-ro li { margin: 3px 0; }

  /* Toast */
  .app-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(10px);
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    border-radius: var(--radius-pill); padding: 10px 18px; font-size: 13px; font-weight: 600;
    box-shadow: var(--shadow-high); opacity: 0; pointer-events: none; z-index: var(--z-toast);
    transition: opacity var(--ease), transform var(--ease); }
  .app-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
</style>
</head>
<body>
<header class="appbar">
  <div class="appbar-inner">
    <div class="brand">
      <span class="mark" id="brandMark"></span>
      <span class="who">
        <span class="name">Flow</span>
        <span class="meta" id="repoMeta">no active job</span>
      </span>
    </div>
    <div class="tools">
      <button class="icon-button sm" id="themeToggle" type="button" aria-label="Toggle color mode"></button>
    </div>
  </div>
</header>

<main class="shell">
  <div class="card strip-wrap"><div class="stepper" id="strip" role="group" aria-label="Pipeline stages"></div></div>
  <div id="connbar" role="status" aria-live="polite" hidden></div>
  <div id="panel"></div>
</main>
<div class="app-toast" id="toast"></div>

<script>
// ---- Inline icon set (Lucide-style, no emoji) --------------------------------
const ICON = {
  loop: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  research: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  prototype: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  plan: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/><path d="M8 12h8"/><path d="M8 16h6"/>',
  implement: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  finalize: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  done: '<path d="M20 6 9 17l-5-5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  gate: '<path d="m21.7 16.5-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 19.5h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
};
function svg(name, cls) {
  return '<svg class="icon ' + (cls || "icon-sm") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || "") + '</svg>';
}

const NODES = [
  { key: "research", label: "Research", icon: "research" },
  { key: "prototype", label: "Prototype", icon: "prototype" },
  { key: "plan", label: "Plan", icon: "plan" },
  { key: "implement", label: "Implement", icon: "implement" },
  { key: "finalize", label: "Finalize", icon: "finalize" },
  { key: "done", label: "Done", icon: "done" },
];
const $ = (id) => document.getElementById(id);
// Capability token: embedded in the top-level document only. A sandboxed
// prototype iframe (allow-scripts, no allow-same-origin => opaque origin) cannot
// read this document cross-origin, so it cannot mint privileged requests. All
// side-effecting/reads on the loopback server carry it; /work assets stay open.
let CAP = "";
try { const _m = document.querySelector && document.querySelector('meta[name="al-cap"]'); if (_m) CAP = _m.getAttribute("content") || _m.content || ""; } catch (e) {}
// Origin that serves prototype assets (/work/*). A SEPARATE, token-less loopback
// origin: prototype pages (embedded sandboxed OR popped out to a real tab) are
// cross-origin from this control document, so they can't read CAP or POST /intent.
let ASSET_BASE = "";
try { const _a = document.querySelector && document.querySelector('meta[name="al-assets"]'); if (_a) ASSET_BASE = _a.getAttribute("content") || _a.content || ""; } catch (e) {}
const CAPH = CAP ? { "x-al-cap": CAP } : {};
function gfetch(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers, CAPH);
  return fetch(path, opts);
}
function capUrl(path) { return CAP ? path + (path.indexOf("?") >= 0 ? "&" : "?") + "t=" + encodeURIComponent(CAP) : path; }
let last = null;
let lastState = null;   // most recent /state object (for strip nav)
let lastGoodState = null; // most recent state WITHOUT a read error (survives outages)
let viewKey = null;     // when set, panel shows a read-only review of that stage
let selectedPrototype = null;
let shipReviewable = false; // did the last /pr snapshot report reviewable? Gates the Ship re-enable.
let lastReviewedHeadSha = null; // exact head SHA from the PR snapshot that enabled Ship.
let prReviewGen = 0;        // generation counter so a stale /pr response can't clobber a newer render.
let idleBuildGen = 0;       // prevents a late issue-list response from repainting an active job.
let idleBuildData = null;

// ---- Color mode --------------------------------------------------------------
function currentMode() {
  return document.documentElement.getAttribute("data-mode") ||
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function applyMode(mode) {
  document.documentElement.setAttribute("data-mode", mode);
  try { localStorage.setItem("agentloop-mode", mode); } catch (e) {}
  const btn = $("themeToggle");
  if (btn) btn.innerHTML = svg(mode === "dark" ? "sun" : "moon", "icon-sm");
}
(function initMode() {
  let saved = null;
  try { saved = localStorage.getItem("agentloop-mode"); } catch (e) {}
  applyMode(saved || currentMode());
})();

// ---- External links (open in system browser; _blank is inert in the webview) -
function openExternal(url) {
  if (!url) return;
  post("/open", { url }).catch(() => {});
  toast("Opening in your browser…");
}
document.addEventListener("click", (e) => {
  const t = $("themeToggle");
  if (t && (e.target === t || t.contains(e.target))) { applyMode(currentMode() === "dark" ? "light" : "dark"); return; }
  const a = e.target.closest("[data-ext]");
  if (a) { e.preventDefault(); openExternal(a.getAttribute("data-ext")); }
});

// Any pipeline node already reached (backwards or current) is navigable for
// read-only review, even while a later stage runs. Forward, unreached steps lock.
function canNavigate(s, idx, curIdx) {
  return !!(s && s.active && idx <= curIdx);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// Very small markdown-ish renderer for issue prose. Block-stateful: headings,
// ordered + unordered lists, and fenced code blocks. Inline emphasis/links/code
// spans are applied per line and NEVER inside a fenced block, so code samples
// render verbatim (already HTML-escaped) instead of being mangled by the inline
// transforms. Raw HTML stays disabled (everything is escaped first).
function mdLite(s) {
  // Strip Agent Loop correlation markers (e.g. <!-- AL-OP ... -->) before
  // rendering — they're machine metadata, not human-facing prose. Scoped to the
  // AL- prefix so legitimate HTML comments in code samples survive.
  s = String(s).replace(/<!--\\s*AL-[\\s\\S]*?-->/g, "");
  const inline = (t) => t
    .replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g, '<a href="#" data-ext="$2">$1</a>')
    .replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>")
    .replace(/\`(.+?)\`/g, "<code>$1</code>");
  const lines = esc(s).split("\\n");
  let out = "", listType = null, inCode = false, code = [];
  const closeList = () => { if (listType) { out += listType === "ol" ? "</ol>" : "</ul>"; listType = null; } };
  const flushCode = () => { out += "<pre><code>" + code.join("\\n") + "</code></pre>"; code = []; inCode = false; };
  for (let line of lines) {
    if (/^\\s*\`\`\`/.test(line)) {
      if (inCode) flushCode();
      else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (/^#{1,6}\\s+/.test(line)) {
      closeList();
      out += "<h3>" + inline(line.replace(/^#{1,6}\\s+/, "")) + "</h3>";
    } else if (/^\\s*[-*]\\s+/.test(line)) {
      if (listType !== "ul") { closeList(); out += "<ul>"; listType = "ul"; }
      out += "<li>" + inline(line.replace(/^\\s*[-*]\\s+/, "")) + "</li>";
    } else if (/^\\s*\\d+\\.\\s+/.test(line)) {
      if (listType !== "ol") { closeList(); out += "<ol>"; listType = "ol"; }
      out += "<li>" + inline(line.replace(/^\\s*\\d+\\.\\s+/, "")) + "</li>";
    } else {
      closeList();
      out += line.trim() ? "<p>" + inline(line) + "</p>" : "";
    }
  }
  if (inCode) flushCode(); // deterministic EOF handling for an unclosed fence
  closeList();
  return out;
}

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._to); t._to = setTimeout(() => t.classList.remove("show"), 2600);
}

async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, CAPH), body: JSON.stringify(body || {}) });
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  if (!r.ok || (data && data.ok === false)) {
    const msg = (data && (data.error || data.message)) || ("HTTP " + r.status);
    throw new Error(msg);
  }
  return data || {};
}

// ---- Structured intents ------------------------------------------------------
// The webview never authors orchestration prose. Buttons post a small intent
// object; the extension validates the live control block and owns all transitions.
let kickoffReqId = null;
function newReqId() {
  const rnd = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return "kf-" + Date.now().toString(36) + "-" + rnd;
}
function ctxFor(s, extra) {
  const base = { owner: s ? s.owner : null, repo: s ? s.repo : null,
    issue: s ? s.issue : null, controlCommentId: s ? s.controlCommentId : null,
    expectedTxn: s && s.txn != null ? s.txn : null };
  return Object.assign(base, extra || {});
}

// Single choke-point for gate submissions: guards against double-fire and reports
// failure so callers can re-enable their buttons.
let submitting = false;
async function sendIntent(kind, data, ctx) {
  if (submitting) return false;
  submitting = true;
  try {
    const payload = kind === "kickoff"
      ? { kind: "kickoff", data: data || {} }
      : Object.assign({ kind, data: data || {} }, ctx || {});
    await post("/intent", payload);
    return true;
  } catch (e) {
    toast(e && e.message ? e.message : "Flow request failed.");
    return false;
  } finally {
    // Re-enable after a beat; the next /state poll will re-render the panel.
    setTimeout(() => { submitting = false; }, 1200);
  }
}

// Map issue state onto a pipeline node. Gates are NOT separate nodes — a
// sign-off gate lives inside Prototype, a questionnaire gate inside Plan, and a
// feedback gate inside Implement.
function currentKey(s) {
  if (!s.active) return "research";
  if (s.gate === "signoff") return "prototype";
  if (s.gate === "questionnaire") return "plan";
  if (s.gate === "plan-review") return "plan";
  if (s.gate === "feedback") return "implement";
  const st = s.stage || "research";
  if (st.indexOf("planning") === 0) return "plan";
  if (st === "implementing") return "implement";
  if (st === "finalizing") return "finalize";
  if (st === "done") return "done";
  return st; // research | prototype
}

function updateAppbar(s) {
  $("brandMark").innerHTML = svg("loop", "icon-sm");
  const meta = $("repoMeta");
  if (s && s.active && s.owner) {
    meta.textContent = s.owner + "/" + s.repo + " #" + s.issue;
  } else {
    meta.textContent = "no active job";
  }
}

function renderStrip(s) {
  const cur = currentKey(s);
  const curIdx = NODES.findIndex((n) => n.key === cur);
  const parts = [];
  NODES.forEach((n, i) => {
    let cls = "step";
    const reached = s.active && i < curIdx;
    const isCurrent = s.active && i === curIdx;
    if (reached) cls += " done";
    if (isCurrent) { cls += " active"; if (s.gate) cls += " gate"; }
    if (s.status === "done" && n.key === "done") cls += " active";
    const canNav = canNavigate(s, i, curIdx);
    if (canNav) cls += " nav";
    if (viewKey === n.key) cls += " viewing";
    const glyph = reached ? svg("check") : svg(n.icon);
    parts.push('<div class="' + cls + '"' + (canNav ? ' data-nav="' + n.key + '"' : '') +
      '><span class="step-circle">' + glyph + '</span><span class="step-label">' + n.label + '</span></div>');
    if (i < NODES.length - 1) parts.push('<span class="step-line"></span>');
  });
  $("strip").innerHTML = parts.join("");
  $("strip").querySelectorAll(".step[data-nav]").forEach((el) => {
    el.onclick = () => {
      const k = el.getAttribute("data-nav");
      viewKey = (k === currentKey(lastState)) ? null : k;
      render(lastState);
    };
  });
}

function panelHead(eyebrowIcon, eyebrowText, title) {
  return '<div class="eyebrow">' + svg(eyebrowIcon, "icon-sm") + esc(eyebrowText) + '</div>' +
    '<h1 class="panel-title">' + esc(title) + '</h1>';
}

function buildStage(issue) {
  const labels = issue && Array.isArray(issue.labels) ? issue.labels : [];
  const gate = labels.find((label) => String(label).startsWith("gate:"));
  const stage = labels.find((label) => String(label).startsWith("stage:"));
  if (gate) return String(gate).slice(5).replace(/-/g, " ");
  if (stage) return String(stage).slice(6).replace(/-/g, " ");
  return "open";
}

function relativeUpdated(value) {
  const stamp = Date.parse(value || "");
  if (!Number.isFinite(stamp)) return "Updated recently";
  const minutes = Math.max(0, Math.floor((Date.now() - stamp) / 60000));
  if (minutes < 1) return "Updated now";
  if (minutes < 60) return "Updated " + minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return "Updated " + hours + "h ago";
  const days = Math.floor(hours / 24);
  return "Updated " + days + "d ago";
}

function renderExistingBuilds(query) {
  const list = $("buildList");
  if (!list || !idleBuildData) return;
  const q = String(query || "").trim().toLowerCase();
  const issues = (idleBuildData.issues || []).filter((issue) =>
    !q || String(issue.title || "").toLowerCase().includes(q) || String(issue.number).includes(q));
  if (!issues.length) {
    list.innerHTML = '<div class="build-empty">' + (q ? "No matching builds." : "No open Flow builds yet.") + '</div>';
    return;
  }
  list.innerHTML = issues.map((issue) => {
    const stage = buildStage(issue);
    return '<button class="build-item" id="buildIssue_' + esc(issue.number) + '" type="button">' +
      '<span class="build-number">#' + esc(issue.number) + '</span>' +
      '<span class="build-copy"><span class="build-title">' + esc(issue.title) + '</span>' +
      '<span class="build-meta">' + esc(relativeUpdated(issue.updatedAt)) + '</span></span>' +
      '<span class="build-state"><span class="badge badge-neutral">' + esc(stage) + '</span>' +
      svg("chevron-right") + '</span></button>';
  }).join("");
  issues.forEach((issue) => {
    const button = $("buildIssue_" + issue.number);
    if (!button) return;
    button.onclick = async () => {
      button.disabled = true;
      const ok = await sendIntent("open-existing", {}, {
        owner: idleBuildData.owner, repo: idleBuildData.repo, issue: issue.number,
      });
      if (!ok) button.disabled = false;
    };
  });
}

async function loadExistingBuilds(gen) {
  const status = $("buildStatus");
  try {
    const response = await fetch("/issues", { cache: "no-store", headers: CAPH });
    let data = null;
    try { data = await response.json(); } catch (e) {}
    if (!response.ok) throw new Error((data && data.error) || ("HTTP " + response.status));
    if (gen !== idleBuildGen || (lastState && lastState.active)) return;
    idleBuildData = data || { issues: [] };
    if (status) status.textContent = "";
    renderExistingBuilds("");
  } catch (e) {
    if (gen !== idleBuildGen || (lastState && lastState.active)) return;
    if (status) status.innerHTML = '<div class="build-empty">Could not load existing builds. Starting a new build is still available.</div>';
  }
}

function renderIdle() {
  const gen = ++idleBuildGen;
  idleBuildData = null;
  $("panel").innerHTML =
    '<div class="card">' +
    panelHead("loop", "Build launcher", "Continue where you left off") +
    '<p class="sub">Open workflow state already stored in this repository, or start something new.</p>' +
    '<div class="idle-tabs" role="tablist">' +
    '<button class="idle-tab active" id="existingTab" type="button" role="tab">Existing builds</button>' +
    '<button class="idle-tab" id="newTab" type="button" role="tab">New build</button></div>' +
    '<div class="idle-pane" id="existingPane" role="tabpanel">' +
    '<label class="field" for="buildSearch">Search open Flow issues</label>' +
    '<input class="input build-search" id="buildSearch" placeholder="Filter by title or issue number" />' +
    '<div id="buildStatus"><div class="build-empty">Loading existing builds…</div></div>' +
    '<div class="build-list" id="buildList"></div></div>' +
    '<div class="idle-pane" id="newPane" role="tabpanel" hidden>' +
    '<p class="sub">Describe an idea. The loop researches prior art, prototypes a few real approaches, ' +
    'and brings the options back here for your sign-off. Nothing touches the code repo until the final PR.</p>' +
    '<div style="margin-top:18px"><label class="field" for="idea">Your idea</label>' +
    '<textarea class="textarea" id="idea" placeholder="e.g. A lightweight date range picker for our dashboard filters"></textarea></div>' +
    '<div class="row"><button class="btn btn-primary has-icon" id="startBtn">' + svg("send") + 'Start the loop</button>' +
    '<span class="muted" id="startHint"></span></div></div>' +
    '</div>';
  const selectTab = (name) => {
    const existing = name === "existing";
    $("existingPane").hidden = !existing;
    $("newPane").hidden = existing;
    $("existingTab").classList[existing ? "add" : "remove"]("active");
    $("newTab").classList[existing ? "remove" : "add"]("active");
  };
  $("existingTab").onclick = () => selectTab("existing");
  $("newTab").onclick = () => selectTab("new");
  $("buildSearch").oninput = () => renderExistingBuilds($("buildSearch").value);
  $("startBtn").onclick = async () => {
    const idea = $("idea").value.trim();
    if (!idea) { $("idea").focus(); return; }
    $("startBtn").disabled = true; $("startHint").textContent = "Starting deterministic workflow…";
    if (!kickoffReqId) kickoffReqId = newReqId();
    const ok = await sendIntent("kickoff", { idea, reqId: kickoffReqId }, {});
    if (ok) toast("Kickoff accepted — Flow is starting research.");
    else { $("startBtn").disabled = false; $("startHint").textContent = ""; }
  };
  loadExistingBuilds(gen);
}

function renderWorking(s) {
  let brief = "";
  if (s.research && s.research.commentId) {
    brief = '<div class="brief" id="brief"><span class="muted">Loading research brief…</span></div>';
  }
  const title = s.title ? s.title : "your idea";
  // A working/error panel has no human gate, so surface a recovery action after
  // a generous timeout. Redispatch keeps earlier bounded capability hashes valid,
  // allowing an agent that was still working to submit without losing its asset.
  const STALE_MS = 15 * 60 * 1000;
  const ageMs = s.updatedAt ? (Date.now() - Date.parse(s.updatedAt)) : 0;
  const isError = s.status === "error";
  const isVerify = !!s.pending && s.pending.kind === "verify-pr";
  const stalled = !!s.pending && !s.error && ageMs > STALE_MS;
  // verify-pr is a legitimate idle wait (CI running) with no subagent — always
  // surface a Recheck immediately rather than waiting out the stale timer.
  const recover = isError || stalled || isVerify;
  const recoverBlock = recover
    ? '<div class="gate-banner recover">' + svg("gate") +
        (isError ? 'This stage hit an error and is waiting.'
          : isVerify ? 'The PR is finalized — waiting on required checks to finish.'
          : 'This stage has been quiet for a while — it may have stalled.') +
      '</div>' +
      '<div class="row" style="margin-top:12px">' +
        '<button class="btn btn-primary has-icon" id="resumeBtn">' + svg("check") +
          (isVerify ? 'Recheck PR checks' : 'Resume this stage') + '</button>' +
      '</div>'
    : "";
  $("panel").innerHTML =
    '<div class="card">' +
    panelHead(currentKey(s) === "research" ? "research" : "prototype", "Working · round " + esc(s.round || 1), title) +
    (s.issueUrl ? '<p class="sub">Issue <a class="issue-link" href="#" data-ext="' + esc(s.issueUrl) + '">#' + esc(s.issue) + svg("external") + '</a></p>' : '') +
    '<div class="status-line" role="status" aria-live="polite"><span class="spinner"></span>' + esc(s.statusText || "Working…") + '</div>' +
    recoverBlock +
    brief +
    '</div>';
  if (s.research && s.research.commentId) {
    gfetch("/comment/" + s.research.commentId).then((r) => r.json()).then((c) => {
      if (c && c.body && $("brief")) $("brief").innerHTML = mdLite(c.body);
    }).catch(() => {});
  }
  if (recover) {
    const btn = $("resumeBtn");
    if (btn) btn.onclick = async () => {
      btn.disabled = true;
      const ok = await sendIntent("resume", {}, ctxFor(s));
      if (ok) toast(isVerify ? "Rechecking PR checks…" : "Resuming — recovering this stage.");
      else btn.disabled = false;
    };
  }
}

function latestRound(s) {
  if (!s.prototypeRounds || !s.prototypeRounds.length) return null;
  return s.prototypeRounds.reduce((a, b) => (b.round > a.round ? b : a));
}

// Unify structured control-block rounds and options parsed from the prototype
// comment into one { round, options } shape for the previews.
function protoData(s) {
const mapOpt = (o) => {
  // Paths are durable; absolute preview URLs contain the extension's
  // ephemeral port and must be rebuilt after a restart.
  const path = o.path || o.repoPath || null;
  const assetOrigin = ASSET_BASE || location.origin;
  return {
    id: o.id, title: o.title, pitch: o.pitch,
    previewUrl: path ? assetOrigin + "/work/" + path : (o.previewUrl || null),
    repoPath: o.repoPath || path,
  };
};
  const r = latestRound(s);
  if (r && r.options && r.options.length) {
    return {
      round: r.round,
      approved: r.approved || null,
      options: r.options.map(mapOpt),
    };
  }
  const pcs = (s.prototypeComments || []).slice().sort((a, b) => b.round - a.round);
  if (pcs.length) return { round: pcs[0].round, approved: null, options: (pcs[0].options || []).map(mapOpt) };
  return { round: s.round, approved: null, options: [] };
}

function protoSections(options, gated) {
  return options.map((o, i) =>
    '<div class="opt" data-id="' + esc(o.id) + '">' +
    '<div class="preview">' +
    (o.previewUrl
      ? '<iframe class="preview-frame" data-preview-frame="' + i + '" src="' +
        esc(o.previewUrl) + '" title="' + esc(o.title) + '" scrolling="no" ' +
        'sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>'
      : '<div style="padding:16px"><span class="muted">Preview unavailable</span></div>') +
    '</div>' +
    '<div class="meta">' +
    '<div class="t"><span class="badge badge-neutral">' + esc(o.id) + '</span>' + esc(o.title) +
    (gated ? '<span class="pick" data-pick>' + svg("check") + '</span>' : '') + '</div>' +
    '<div class="p">' + esc(o.pitch) + '</div>' +
    '<div class="links">' +
    (o.previewUrl ? '<a href="#" data-ext="' + esc(o.previewUrl) + '">' + svg("external") + 'Open full prototype</a>' : '') +
    (o.repoPath ? '<span class="muted"><code>' + esc(o.repoPath) + '</code></span>' : '') +
    '</div>' +
    (gated ? '<button type="button" class="btn btn-sm select-direction ' +
      (selectedPrototype === o.id ? "btn-primary" : "btn-secondary") + '" data-select="' + esc(o.id) + '">' +
      (selectedPrototype === o.id ? "Selected direction" : "Select this direction") + '</button>' : '') +
    '</div></div>'
  ).join("");
}

// The Prototype panel. Sign-off is NOT a separate tab — when the issue is at the
// sign-off gate this same panel grows a sticky decision bar (pick a variant +
// directing comments + approve / request-another-round). When readOnly (the
// stage has moved on and the user navigated back), the controls are omitted.
function renderPrototype(s, readOnly) {
  const { round, options } = protoData(s);
  const gated = s.gate === "signoff" && !readOnly;
  if (!selectedPrototype || !options.some((o) => o.id === selectedPrototype)) {
    selectedPrototype = options[0] ? options[0].id : null;
  }
  const previews = protoSections(options, gated);

  const head = readOnly ? reviewBar("Prototype") : "";
  const locked = !!s.pending;
  const banner = gated
    ? (locked ? lockBanner(s) : '<div class="gate-banner">' + svg("gate") + 'Human gate · choose a prototype to advance</div>')
    : "";
  const selOpt = options.find((o) => o.id === selectedPrototype) || options[0];
  const selLabel = selOpt ? (selOpt.id + " · " + selOpt.title) : "—";
  const controls = gated
    ? '<div class="decision">' +
        '<div class="sel-name">' + svg("check") + 'Selected direction: <strong id="selName">' + esc(selLabel) + '</strong></div>' +
        '<label class="field" for="refine">Directing comments — optional when approving, required when requesting another round.</label>' +
        '<textarea class="textarea" id="refine" placeholder="e.g. Keep this direction, but make the month header sticky and add a Today shortcut"' +
        (locked ? " disabled" : "") + '></textarea>' +
        '<div class="row">' +
          '<button class="btn btn-primary has-icon" id="approveBtn"' + (locked ? " disabled" : "") + '>' + svg("check") + 'Approve selected prototype</button>' +
          '<button class="btn btn-secondary" id="refineBtn"' + (locked ? " disabled" : "") + '>Request another round</button>' +
        '</div>' +
        '<p class="hint">Pick a direction above — it sets what you approve or refine.</p>' +
      '</div>'
    : "";

  $("panel").innerHTML =
    '<div class="card">' + head + banner +
    panelHead("prototype", "Prototype · round " + esc(round), s.title || "Prototypes") +
    '<p class="sub">' + options.length + ' option' + (options.length === 1 ? "" : "s") +
    ' · Issue <a class="issue-link" href="#" data-ext="' + esc(s.issueUrl) + '">#' + esc(s.issue) + svg("external") + '</a></p>' +
    (previews ? '<div class="opts">' + previews + '</div>' : '<p class="muted" style="margin-top:16px">No prototype options yet.</p>') +
    controls + '</div>';

  document.querySelectorAll("[data-preview-frame]").forEach((frame) => {
    frame.addEventListener("load", () => {
      frame.contentWindow.postMessage({ type: "prototype-size-request" }, "*");
    });
  });
  if (!window._prototypeResizeBound) {
    window._prototypeResizeBound = true;
    window.addEventListener("message", (e) => {
      if (!e.data || e.data.type !== "prototype-height") return;
      const frame = Array.from(document.querySelectorAll("[data-preview-frame]"))
        .find((el) => el.contentWindow === e.source);
      if (frame && Number.isFinite(e.data.height)) {
        // Clamp: a sandboxed prototype must not be able to force an
        // arbitrarily tall iframe (layout DoS).
        frame.style.height = Math.min(2400, Math.max(260, Math.ceil(e.data.height))) + "px";
      }
    });
  }

  if (readOnly) wireBack();
  if (!gated) return;

  document.querySelectorAll(".opt").forEach((el) => {
    const id = el.getAttribute("data-id");
    if (id === selectedPrototype) el.classList.add("sel");
    const select = el.querySelector("[data-select]");
    if (!select) return;
    select.onclick = () => {
      selectedPrototype = id;
      document.querySelectorAll(".opt").forEach((option) => {
        const isSelected = option.getAttribute("data-id") === selectedPrototype;
        option.classList.toggle("sel", isSelected);
        const button = option.querySelector("[data-select]");
        if (button) {
          button.classList.toggle("btn-primary", isSelected);
          button.classList.toggle("btn-secondary", !isSelected);
          button.textContent = isSelected ? "Selected direction" : "Select this direction";
        }
      });
      toast("Selected " + id + " as the direction to refine.");
      const selName = $("selName");
      if (selName) {
        const opt = options.find((o) => o.id === selectedPrototype);
        selName.textContent = opt ? (opt.id + " · " + opt.title) : id;
      }
    };
  });

  $("approveBtn").onclick = async () => {
    const id = selectedPrototype || (options[0] && options[0].id);
    if (!id) return;
    const note = ($("refine").value || "").trim();
    $("approveBtn").disabled = true; $("refineBtn").disabled = true;
    const ok = await sendIntent("approve", { optionId: id, notes: note }, ctxFor(s));
    if (ok) toast("Approved " + id + " — advancing to planning.");
    else { $("approveBtn").disabled = false; $("refineBtn").disabled = false; }
  };
  $("refineBtn").onclick = async () => {
    const fb = ($("refine").value || "").trim();
    if (!fb) { $("refine").focus(); toast("Add directing comments to request another round."); return; }
    $("approveBtn").disabled = true; $("refineBtn").disabled = true;
    const ok = await sendIntent("iterate", { feedback: fb }, ctxFor(s));
    if (ok) toast("Feedback sent — starting a new round.");
    else { $("approveBtn").disabled = false; $("refineBtn").disabled = false; }
  };
}

// Fetch an issue comment body and render it (mdLite) into a container by id.
// Load an issue comment's prose into a panel element. Guards against three
// failure modes the old fire-and-forget version ignored: a non-OK HTTP status
// (shown as a retryable error, not an eternal "Loading…"), an empty body, and a
// stale response landing after a newer render reused the same element id (each
// call bumps a per-element generation and a late resolver bails).
function loadComment(commentId, elId, onLoaded) {
  if (commentId == null) return;
  const done = (ok) => { try { if (onLoaded) onLoaded(ok); } catch (e) {} };
  const active = loadComment._active || (loadComment._active = {});
  const gen = (loadComment._gen = (loadComment._gen || 0) + 1);
  active[elId] = gen;
  const fresh = () => active[elId] === gen;
  fetch("/comment/" + commentId, { headers: CAPH })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then((c) => {
      if (!fresh()) return;
      const el = $(elId);
      if (!el) return;
      const hasBody = !!(c && c.body);
      el.innerHTML = hasBody ? mdLite(c.body) : '<span class="muted">This artifact is empty.</span>';
      done(hasBody);
    })
    .catch(() => {
      if (!fresh()) return;
      const el = $(elId);
      if (!el) { done(false); return; }
      el.innerHTML = '<span class="muted">Could not load this from GitHub. </span>' +
        '<button type="button" class="btn btn-sm btn-secondary" id="' + elId + '_retry">Retry</button>';
      const rb = $(elId + "_retry");
      if (rb) rb.onclick = () => {
        const t = $(elId);
        if (t) t.innerHTML = '<span class="muted">Loading…</span>';
        loadComment(commentId, elId, onLoaded);
      };
      done(false);
    });
}

// A subtle lock banner shown if a child op is mid-flight (pending set) while a
// gate panel is visible — belt-and-suspenders against a double submit.
function lockBanner(s) {
  return s && s.pending
    ? '<div class="gate-banner">' + svg("gate") + 'A stage agent is still working — hold on…</div>'
    : "";
}

// ---- Questionnaire gate ------------------------------------------------------
// The client keeps a per-question answer model so selections survive re-renders
// (each step re-renders the panel in place). Choices are single- or multi-select
// and a free-text note is always available, so a human can pick an option AND
// add nuance. Only one question shows at a time; Back/Next walk the list and the
// final step swaps in Submit, which serializes the model into the ANSWERS prose.
let qModel = null; // { qid: { choices: Set<string>, text: string } }
let qModelKey = null; // structural signature of the questionnaire the model belongs to
let qStep = 0;

// A signature over the questions' structure (not just the comment id): if the
// questionnaire comment is edited while the human is mid-answer — a prompt or a
// choice changes — the retained model would otherwise submit stale, now-invisible
// selections. Any structural change resets the model; identical re-renders keep it.
function qSig(questions) {
  return questions.map((q) => q.id + "|" + q.select + "|" + q.prompt + "|" + (q.choices || []).join("~")).join("\\u00a7");
}
function qEnsureModel(questions) {
  const key = qSig(questions);
  if (qModel && qModelKey === key) return;
  qModel = {};
  for (const qq of questions) qModel[qq.id] = { choices: new Set(), text: "" };
  qModelKey = key;
  qStep = 0;
}

function qAnswerText(qq) {
  const m = (qModel && qModel[qq.id]) || { choices: new Set(), text: "" };
  const picks = Array.from(m.choices);
  const note = (m.text || "").trim();
  // Quote multiple selections so a choice label that itself contains a comma
  // (e.g. "SQLite, Postgres") can't be misread as two separate picks.
  let sel = "";
  if (picks.length === 1) sel = picks[0];
  else if (picks.length > 1) sel = picks.map((p) => "\\u201c" + p + "\\u201d").join(", ");
  if (sel && note) return sel + " — " + note;
  return sel || note;
}

function renderQuestionnaire(s, readOnly) {
  const q = s.questionnaire || null;
  const questions = (q && q.questions) || [];
  const gated = s.gate === "questionnaire" && !readOnly;
  const locked = !!s.pending;
  const head = readOnly ? reviewBar("Plan") : "";
  const banner = gated ? '<div class="gate-banner">' + svg("gate") + 'Human gate · answer to shape the plan</div>' : lockBanner(s);
  const answered = s.answers && s.answers.commentId;

  // Read-only (or no live gate): show the whole questionnaire as a static list so
  // the plan-review screen and history stay reviewable.
  if (!gated || locked || !questions.length) {
    const list = questions.map((qq) =>
      '<div class="qitem"><div class="qprompt"><span class="badge badge-neutral">' + esc(qq.id) +
      '</span> ' + esc(qq.prompt) + '</div>' +
      (qq.choices && qq.choices.length
        ? '<ul class="qchoices-ro">' + qq.choices.map((c) => '<li>' + esc(c) + '</li>').join("") + '</ul>'
        : '') + '</div>'
    ).join("");
    $("panel").innerHTML =
      '<div class="card">' + head + banner +
      panelHead("plan", "Planning · questionnaire", s.title || "Clarifying questions") +
      '<p class="sub">' + questions.length + ' question' + (questions.length === 1 ? "" : "s") +
      (s.issueUrl ? ' · Issue <a class="issue-link" href="#" data-ext="' + esc(s.issueUrl) + '">#' + esc(s.issue) + svg("external") + '</a>' : '') + '</p>' +
      (questions.length ? '<div class="qlist">' + list + '</div>'
        : '<p class="muted" style="margin-top:16px">No questions parsed yet.</p>') +
      (answered ? '<div class="brief" id="answersBrief"><span class="muted">Loading your answers…</span></div>' : '') +
      '</div>';
    if (readOnly) wireBack();
    if (answered) loadComment(s.answers.commentId, "answersBrief");
    return;
  }

  qEnsureModel(questions);
  paintQuestionStep(s, questions);
}

// Renders a single question step and wires its inputs + navigation. Re-invoked
// on every Back/Next so the panel always reflects qStep and the answer model.
// focusStep is set only by Back/Next so keyboard/screen-reader users land on
// the new question instead of the top of the panel; a choice-toggle re-render
// (same step) must NOT steal focus from the control the user just activated.
function paintQuestionStep(s, questions, focusStep, focusChoice) {
  if (qStep < 0) qStep = 0;
  if (qStep > questions.length - 1) qStep = questions.length - 1;
  const qq = questions[qStep];
  const m = qModel[qq.id] || (qModel[qq.id] = { choices: new Set(), text: "" });
  const isLast = qStep === questions.length - 1;
  const multi = qq.select === "multi";
  const inputType = multi ? "checkbox" : "radio";

  const choiceRows = (qq.choices || []).map((c, i) => {
    const cid = "qc_" + qq.id + "_" + i;
    const on = m.choices.has(c);
    return '<label class="choice' + (on ? " on" : "") + '" for="' + cid + '">' +
      '<span class="choice-mark ' + (multi ? "box" : "dot") + (on ? " on" : "") + '">' + (on ? svg("check") : "") + '</span>' +
      '<input class="choice-input" type="' + inputType + '" name="qc_' + esc(qq.id) + '" id="' + cid + '" data-choice="' + esc(c) + '"' + (on ? " checked" : "") + '>' +
      '<span class="choice-text">' + esc(c) + '</span></label>';
  }).join("");

  const noteLabel = (qq.choices && qq.choices.length)
    ? (multi ? "Add a note or other option (optional)" : "Other / add a note (optional)")
    : "Your answer";

  const nav =
    '<div class="row qnav">' +
      '<button class="btn btn-secondary" id="qBackBtn"' + (qStep === 0 ? " disabled" : "") + '>' + svg("chevron-left") + 'Back</button>' +
      (isLast
        ? '<button class="btn btn-primary has-icon" id="answersBtn">' + svg("send") + 'Submit answers</button>'
        : '<button class="btn btn-primary has-icon" id="qNextBtn">Next' + svg("chevron-right") + '</button>') +
    '</div>';

  $("panel").innerHTML =
    '<div class="card">' +
      '<div class="gate-banner">' + svg("gate") + 'Human gate · answer to shape the plan</div>' +
      panelHead("plan", "Planning · questionnaire", s.title || "Clarifying questions") +
      '<div class="qprogress"><div class="qprogress-meta"><span>Question ' + (qStep + 1) + ' of ' + questions.length + '</span>' +
        (s.issueUrl ? '<a class="issue-link" href="#" data-ext="' + esc(s.issueUrl) + '">#' + esc(s.issue) + svg("external") + '</a>' : '') + '</div>' +
        '<div class="qbar"><span style="width:' + Math.round(((qStep + 1) / questions.length) * 100) + '%"></span></div></div>' +
      '<div class="qstep">' +
        '<div class="qstep-prompt" id="qStepPrompt" tabindex="-1"><span class="badge badge-neutral">' + esc(qq.id) + '</span> ' + esc(qq.prompt) + '</div>' +
        (choiceRows ? '<div class="choices' + (multi ? " multi" : "") + '">' + choiceRows + '</div>' : '') +
        '<label class="field" for="qtext" style="margin-top:' + (choiceRows ? "16px" : "4px") + '">' + esc(noteLabel) + '</label>' +
        '<textarea class="textarea qa" id="qtext" placeholder="' + (choiceRows ? "Anything to add…" : "Your answer…") + '"></textarea>' +
      '</div>' +
      nav +
      '<p class="hint">Blank answers are fine — the plan agent will use its judgment.</p>' +
    '</div>';

  // Wire choices → answer model.
  (qq.choices || []).forEach((c, i) => {
    const el = $("qc_" + qq.id + "_" + i);
    if (!el) return;
    el.onclick = () => {
      if (multi) {
        if (m.choices.has(c)) m.choices.delete(c); else m.choices.add(c);
      } else {
        m.choices.clear(); m.choices.add(c);
      }
      paintQuestionStep(s, questions, false, i); // re-render to reflect selection, keep focus on this choice
    };
  });

  const note = $("qtext");
  if (note) {
    note.value = m.text || "";
    note.oninput = () => { m.text = note.value; };
  }

  const back = $("qBackBtn");
  if (back) back.onclick = () => { qStep -= 1; paintQuestionStep(s, questions, true); };
  const next = $("qNextBtn");
  if (next) next.onclick = () => { qStep += 1; paintQuestionStep(s, questions, true); };

  // Move focus to the new question when navigating steps (not on a same-step
  // choice re-render), so keyboard/AT users aren't dropped back to the top.
  if (focusStep) { const fp = $("qStepPrompt"); if (fp && fp.focus) fp.focus(); }
  // On a same-step choice toggle, keep keyboard focus on the choice the user just
  // activated instead of dropping it after the panel is rebuilt.
  if (focusChoice != null) { const ci = $("qc_" + qq.id + "_" + focusChoice); if (ci && ci.focus) ci.focus(); }

  const submit = $("answersBtn");
  if (submit) submit.onclick = async () => {
    submit.disabled = true;
    const answers = questions.map((qqq) => ({ id: qqq.id, prompt: qqq.prompt, answer: qAnswerText(qqq) }));
    const ok = await sendIntent("answers", { answers }, ctxFor(s));
    if (ok) { qModel = null; qModelKey = null; qStep = 0; toast("Answers sent — drafting the plan."); }
    else submit.disabled = false;
  };
}

// ---- Plan-review gate --------------------------------------------------------
function renderPlanReview(s, readOnly) {
  const gated = s.gate === "plan-review" && !readOnly;
  const locked = !!s.pending;
  const head = readOnly ? reviewBar("Plan") : "";
  const banner = gated ? '<div class="gate-banner">' + svg("gate") + 'Human gate · approve the plan or request changes</div>' : lockBanner(s);
  const hasPlan = s.plan && s.plan.commentId;

  const controls = gated
    ? '<div class="decision">' +
        '<label class="field" for="planFb">Requested changes — optional when approving, required when requesting changes.</label>' +
        '<textarea class="textarea" id="planFb" placeholder="e.g. Split step 3 into migration + backfill, and call out the rollback path"' +
        (locked ? " disabled" : "") + '></textarea>' +
        '<div class="row">' +
          '<button class="btn btn-primary has-icon" id="planOkBtn" disabled>' + svg("check") + 'Approve plan &amp; build</button>' +
          '<button class="btn btn-secondary" id="planReviseBtn"' + (locked ? " disabled" : "") + '>Request changes</button>' +
        '</div>' +
        (hasPlan ? '' : '<p class="hint">Approve unlocks once the plan artifact is posted.</p>') +
        '</div>'
    : "";

  $("panel").innerHTML =
    '<div class="card">' + head + banner +
    panelHead("plan", "Planning · plan review", s.title || "Implementation plan") +
    (s.issueUrl ? '<p class="sub">Issue <a class="issue-link" href="#" data-ext="' + esc(s.issueUrl) + '">#' + esc(s.issue) + svg("external") + '</a></p>' : '') +
    (hasPlan ? '<div class="brief" id="planBrief"><span class="muted">Loading the plan…</span></div>'
      : '<p class="muted" style="margin-top:16px">No plan artifact yet.</p>') +
    controls + '</div>';

  if (readOnly) wireBack();
  // Fail closed: Approve stays disabled until the plan prose actually loads, so
  // the human can never green-light a plan they were unable to see.
  let planLoaded = false;
  if (hasPlan) loadComment(s.plan.commentId, "planBrief", (ok) => {
    if (!gated || locked) return;
    planLoaded = !!ok;
    const b = $("planOkBtn"); if (b) b.disabled = !ok;
  });
  if (!gated || locked) return;

  $("planOkBtn").onclick = async () => {
    if ($("planOkBtn").disabled) return; // fail-closed: plan not loaded / not visible
    const note = ($("planFb").value || "").trim();
    $("planOkBtn").disabled = true; $("planReviseBtn").disabled = true;
    const ok = await sendIntent("plan-ok", { notes: note }, ctxFor(s));
    if (ok) toast("Plan approved — starting the build.");
    else { $("planOkBtn").disabled = !planLoaded; $("planReviseBtn").disabled = false; }
  };
  $("planReviseBtn").onclick = async () => {
    const fb = ($("planFb").value || "").trim();
    if (!fb) { $("planFb").focus(); toast("Add the changes you want before requesting a revision."); return; }
    $("planOkBtn").disabled = true; $("planReviseBtn").disabled = true;
    const ok = await sendIntent("plan-revise", { feedback: fb }, ctxFor(s));
    if (ok) toast("Sent — revising the plan.");
    else { $("planOkBtn").disabled = !planLoaded; $("planReviseBtn").disabled = false; }
  };
}

// ---- Feedback gate -----------------------------------------------------------
// Colour the aggregate CI state. "unknown" (read failed) and "none" (confirmed
// no checks) are deliberately distinct so a read failure never looks green.
function ciBadge(checks) {
  const state = (checks && checks.state) || "unknown";
  const map = {
    passed: ["badge-sage", "Checks passing"],
    failed: ["badge-rust", "Checks failing"],
    pending: ["badge-amber", "Checks running"],
    none: ["badge-neutral", "No checks reported"],
    unknown: ["badge-neutral", "Checks unknown"],
  };
  const m = map[state] || map.unknown;
  let label = m[1];
  const c = checks && checks.counts;
  if (c && (state === "failed" || state === "pending") && (c.fail || c.pending)) {
    label += " (" + (c.fail ? c.fail + " failing" : c.pending + " running") + ")";
  }
  return '<span class="badge ' + m[0] + '">' + esc(label) + '</span>';
}

// Render a unified-diff patch with per-line colouring. The marker is read from
// the RAW line before escaping, so escaping can never change classification.
function diffHtml(patch) {
  return String(patch).split("\\n").map((raw) => {
    const ch = raw.charAt(0);
    const cls = (raw.slice(0, 2) === "@@") ? "diff-hunk"
      : ch === "+" ? "diff-add"
      : ch === "-" ? "diff-del" : "";
    return '<span class="dl ' + cls + '">' + (esc(raw) || " ") + "</span>";
  }).join("");
}

function fileDiff(f) {
  const stat = [];
  if (f.additions != null) stat.push("+" + f.additions);
  if (f.deletions != null) stat.push("-" + f.deletions);
  const meta = [f.status, stat.join(" ")].filter(Boolean).join(" · ");
  const head = "<summary><code>" + esc(f.path) + "</code>" +
    (meta ? ' <span class="muted">' + esc(meta) + "</span>" : "") + "</summary>";
  let body;
  if (f.noPatch) body = '<p class="muted">No inline diff (binary, too large, or unavailable).</p>';
  else body = '<pre class="diff">' + diffHtml(f.patch) +
    (f.patchTruncated ? '<span class="dl muted">… (diff truncated)</span>' : "") + "</pre>";
  return '<details class="file">' + head + body + "</details>";
}

function renderPrSnapshot(snap) {
  if (!snap || snap.available === false) {
    if (snap && snap.reason === "no-pr") return '<p class="muted">No PR is linked to this issue yet.</p>';
    return '<span class="muted">Could not load the PR from GitHub. </span>' +
      '<button type="button" class="btn btn-sm btn-secondary" id="prRetry">Retry</button>';
  }
  const parts = [];
  if (snap.headMovedFromReview)
    parts.push('<div class="gate-banner recover">' + svg("gate") + 'The PR moved since you last reviewed it — re-review before shipping.</div>');
  else if (snap.stale)
    parts.push('<div class="gate-banner recover">' + svg("gate") + 'The PR changed while loading — Refresh to review the current revision.</div>');
  else if (snap.unpinned)
    parts.push('<div class="gate-banner recover">' + svg("gate") + 'This build has no pinned reviewed revision, so Ship stays locked — request a fresh build to pin the head.</div>');
  const sum = [];
  if (snap.changedFiles != null) sum.push(snap.changedFiles + " file" + (snap.changedFiles === 1 ? "" : "s") + " changed");
  if (snap.additions != null) sum.push("+" + snap.additions);
  if (snap.deletions != null) sum.push("-" + snap.deletions);
  parts.push('<div class="pr-summary">' + ciBadge(snap.checks) +
    (snap.isDraft ? '<span class="badge badge-neutral">Draft</span>' : "") +
    (sum.length ? '<span class="muted">' + esc(sum.join(" · ")) + "</span>" : "") +
    '<button type="button" class="btn btn-sm btn-secondary" id="prRefresh">Refresh</button></div>');
  if (snap.files && snap.files.length) {
    parts.push('<div class="files">' + snap.files.map(fileDiff).join("") + "</div>");
    if (snap.truncatedFiles)
      parts.push('<p class="muted">Showing the first ' + esc(snap.shownFiles) + ' files. Open the PR on GitHub for the rest.</p>');
  } else {
    parts.push('<p class="muted">No changed files reported.</p>');
  }
  return parts.join("");
}

// Fetch and render the head-pinned PR snapshot into #prReview. Ship is treated as
// fail-closed: it is DISABLED before this resolves, stays disabled on any error or
// non-reviewable snapshot, and is only enabled after a successful snapshot that is
// explicitly available && reviewable. A generation guard discards a stale response
// (e.g. an earlier Refresh landing after a newer one) so it can't flip Ship open.
function loadPrReview(s, gated) {
  const host = $("prReview");
  if (!host) return;
  const gen = ++prReviewGen;
  if (gated) { shipReviewable = false; lastReviewedHeadSha = null; const sb = $("shipBtn"); if (sb) sb.disabled = true; }
  const rewire = () => {
    const rt = $("prRetry"); if (rt) rt.onclick = () => reload();
    const rf = $("prRefresh"); if (rf) rf.onclick = () => reload();
  };
  const reload = () => {
    if (gated) { shipReviewable = false; lastReviewedHeadSha = null; const sb = $("shipBtn"); if (sb) sb.disabled = true; }
    const h = $("prReview"); if (h) h.innerHTML = '<span class="muted">Loading the PR…</span>';
    loadPrReview(s, gated);
  };
  const wantPr = s && s.impl ? s.impl.prNumber : null;
  fetch("/pr", { headers: CAPH })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then((snap) => {
      if (gen !== prReviewGen) return; // a newer load superseded this one
      // Job-identity guard: never paint a snapshot for a different owner/repo/
      // issue/PR than the one this panel is bound to. The active pointer is global
      // and can move under a second canvas instance, and a bare PR number is not
      // unique across repos — so compare the whole identity, not just the number.
      const mismatch = (a, b) => a != null && b != null && String(a) !== String(b);
      if (snap && snap.available !== false && (
        mismatch(snap.prNumber, wantPr) ||
        mismatch(snap.owner, s && s.owner) ||
        mismatch(snap.repo, s && s.repo) ||
        mismatch(snap.issue, s && s.issue))) return;
      // Fail-closed identity for Ship: enabling merge requires the snapshot to
      // POSITIVELY carry the full owner/repo/issue/PR identity matching this
      // panel. A missing field is treated as untrusted (never enables Ship),
      // since the server now always stamps identity on a live /pr snapshot.
      const idComplete = !!(snap && s &&
        String(snap.prNumber) === String(wantPr) &&
        String(snap.owner) === String(s.owner) &&
        String(snap.repo) === String(s.repo) &&
        String(snap.issue) === String(s.issue));
      const h = $("prReview");
      if (!h) return;
      h.innerHTML = renderPrSnapshot(snap);
      rewire();
      if (gated) {
        const ok = !!(snap && snap.available !== false && snap.reviewable === true && idComplete &&
          typeof snap.headRefOid === "string" && snap.headRefOid.length);
        shipReviewable = ok;
        lastReviewedHeadSha = ok ? (snap.headRefOid || null) : null;
        const ship = $("shipBtn");
        if (ship) ship.disabled = !ok;
      }
    })
    .catch(() => {
      if (gen !== prReviewGen) return;
      if (gated) { shipReviewable = false; lastReviewedHeadSha = null; const sb = $("shipBtn"); if (sb) sb.disabled = true; }
      const h = $("prReview");
      if (!h) return;
      h.innerHTML = '<span class="muted">Could not load the PR from GitHub. </span>' +
        '<button type="button" class="btn btn-sm btn-secondary" id="prRetry">Retry</button>';
      rewire();
    });
}

// The "Try it out" affordance at the feedback gate. Machine verification (CI)
// lives in the PR snapshot; this block is the HANDS-ON path and is portable
// across project types via a preview descriptor the implement agent declares:
//   impl.preview = { kind:"web"|"command"|"none", path?, run?:[], notes? }
// web  → an interactive sandboxed iframe of the built artifact (served from the
//        per-issue asset origin, same as prototypes);
// command/none → run steps + the deterministic branch. Every kind also offers
// the universal "Open PR in a session" path so non-web work (native app, API,
// CLI, library) can be checked out and run however that project runs.
function tryItBlock(s, impl, branch, readOnly) {
  const prNo = impl && impl.prNumber;
  if (!prNo) return "";
  const p = impl && impl.preview ? impl.preview : null;
  const kind = p && p.kind ? p.kind : "none";
  const assetOrigin = ASSET_BASE || location.origin;
  let body = "";
  const webKind = kind === "web";
  if (webKind && p && p.path) {
    const url = assetOrigin + "/work/" + p.path;
    body +=
      '<div class="preview"><iframe class="demo-frame" src="' + esc(url) + '" title="Live demo" ' +
      'sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe></div>' +
      '<div class="links" style="margin-top:8px"><a href="#" data-ext="' + esc(url) + '">' +
      svg("external") + 'Open the demo</a></div>';
  } else if (webKind) {
    // A web descriptor missing its path renders honestly, not as an empty block.
    body += '<p class="muted">The interactive demo is not available for this build — ' +
      'review the diff below or open the PR in a session.</p>';
  }
  if (p && Array.isArray(p.run) && p.run.length) {
    body += '<div class="run-steps"><span class="muted">Run it locally:</span><ol>' +
      p.run.map((c) => '<li><code>' + esc(String(c)) + '</code></li>').join("") + '</ol></div>';
  }
  if (p && p.notes) body += '<p class="muted" style="margin-top:10px">' + esc(p.notes) + '</p>';
  body += '<div class="branch">Branch <code>' + esc(branch) + '</code></div>';
  if (!readOnly) {
    body += '<div class="row" style="margin-top:10px">' +
      '<button type="button" class="btn btn-secondary has-icon" id="reviewLocalBtn">' +
      svg("external") + 'Open PR in a session</button></div>';
  }
  const label = webKind ? "Try it out" : "Try it out locally";
  // Demo-freshness caption from state alone (synchronous, re-pin-proof): compare
  // the head the demo was BUILT at (preview.headSha, stamped at Build Ready) to
  // the CURRENT reviewed pin (impl.headSha). They diverge only when the pin
  // advanced without a rebuild — e.g. a SHIP head-adopt or a Finalize that moved
  // the head — in which case the on-disk demo predates the reviewed revision.
  // (headMovedFromReview compares live-tip vs pin, a different axis that goes
  // false right after a re-pin, so it must NOT drive this caption.)
  const builtAt = p && p.headSha ? String(p.headSha) : null;
  const pinnedAt = impl && impl.headSha ? String(impl.headSha) : null;
  const stale = !!(builtAt && pinnedAt && builtAt !== pinnedAt);
  const roundN = esc(impl.round || s.implRound || 1);
  const foot = webKind && p && p.path
    ? '<p class="hint" id="demoNote">' + (stale
        ? "Heads up — the reviewed revision has advanced since this demo was built. " +
          "It shows implement round " + roundN + ", not the current PR head."
        : "This demo is the build from implement round " + roundN + ".") + '</p>'
    : "";
  return '<div class="tryit"><div class="t">' + label + '</div>' + body + foot + '</div>';
}

function renderFeedback(s, readOnly) {
  const gated = s.gate === "feedback" && !readOnly;
  const locked = !!s.pending;
  if (gated && !locked) { shipReviewable = false; lastReviewedHeadSha = null; }
  const head = readOnly ? reviewBar("Implement") : "";
  const banner = gated ? '<div class="gate-banner">' + svg("gate") + 'Human gate · review the PR, then ship or request changes</div>' : lockBanner(s);
  const impl = s.impl || null;
  const prNo = impl && impl.prNumber;
  const prUrl = impl && impl.prUrl;
  const noPr = !prNo;
  const branch = (impl && impl.branch) || ("agent-loop/issue-" + s.issue);

  const prRow = prUrl
    ? '<div class="meta-row">Pull request <a class="issue-link" href="#" data-ext="' + esc(prUrl) + '">#' + esc(prNo) + svg("external") + '</a></div>'
    : (impl && impl.commentId ? '' : '<p class="muted" style="margin-top:16px">No PR linked yet.</p>');

  const controls = gated
    ? '<div class="decision">' +
        '<label class="field" for="revFb">Requested changes — optional when shipping, required when requesting changes.</label>' +
        '<textarea class="textarea" id="revFb" placeholder="e.g. Add a test for the empty-state, and tighten the aria-live copy"' +
        (locked ? " disabled" : "") + '></textarea>' +
        '<div class="row">' +
          '<button class="btn btn-primary has-icon" id="shipBtn" disabled>' + svg("check") + 'Ship it</button>' +
          '<button class="btn btn-secondary" id="reviseBtn"' + (locked ? " disabled" : "") + '>Request changes</button>' +
        '</div>' +
        (noPr ? '<p class="hint">Ship unlocks once a PR is linked to this issue.</p>' : '') +
        '</div>'
    : "";

  $("panel").innerHTML =
    '<div class="card">' + head + banner +
    panelHead("implement", "Implement · review round " + esc(s.implRound || 1), s.title || "Build ready") +
    (s.issueUrl ? '<p class="sub">Issue <a class="issue-link" href="#" data-ext="' + esc(s.issueUrl) + '">#' + esc(s.issue) + svg("external") + '</a></p>' : '') +
    prRow +
    (impl && impl.commentId ? '<div class="brief" id="buildBrief"><span class="muted">Loading the build summary…</span></div>' : '') +
    (impl ? tryItBlock(s, impl, branch, readOnly) : '') +
    (prNo ? '<div class="pr-review" id="prReview"><span class="muted">Loading the PR…</span></div>' : '') +
    controls + '</div>';

  if (readOnly) wireBack();
  if (impl && impl.commentId) loadComment(impl.commentId, "buildBrief");
  if (prNo) loadPrReview(s, gated && !locked);
  const rlBtn = $("reviewLocalBtn");
  if (rlBtn && !readOnly) {
    rlBtn.onclick = async () => {
      rlBtn.disabled = true; // guard against a double-fire while the prompt is in flight
      const ok = await sendIntent("review-local", { prNumber: prNo || null }, ctxFor(s));
      if (ok) toast("Opening the PR in a session…");
      // Re-enable either way: REVIEW-LOCAL changes no durable state, so a poll
      // won't re-render this button — and it is idempotent (open_pr_session
      // focuses the existing session), so it must stay repeatable.
      rlBtn.disabled = false;
    };
  }
  if (!gated || locked) return;

  $("shipBtn").onclick = async () => {
    if ($("shipBtn").disabled) return; // fail-closed: PR missing or head moved
    const note = ($("revFb").value || "").trim();
    $("shipBtn").disabled = true; $("reviseBtn").disabled = true;
    const ok = await sendIntent("ship", { prNumber: prNo || null, reviewedHeadSha: lastReviewedHeadSha || null, notes: note }, ctxFor(s));
    if (ok) toast("Shipping — finalizing the PR.");
    else { $("shipBtn").disabled = !shipReviewable; $("reviseBtn").disabled = false; }
  };
  $("reviseBtn").onclick = async () => {
    const fb = ($("revFb").value || "").trim();
    if (!fb) { $("revFb").focus(); toast("Add the changes you want before requesting a revision."); return; }
    $("shipBtn").disabled = true; $("reviseBtn").disabled = true;
    const ok = await sendIntent("revise", { prNumber: prNo || null, feedback: fb }, ctxFor(s));
    if (ok) toast("Sent — revising the PR.");
    else { $("shipBtn").disabled = !shipReviewable; $("reviseBtn").disabled = false; }
  };
}


function renderDone(s, readOnly) {
  const head = readOnly ? reviewBar("Done") : "";
  const impl = s.impl || null;
  const prUrl = impl && impl.prUrl;
  const prNo = impl && impl.prNumber;
  $("panel").innerHTML =
    '<div class="card">' + head +
    '<div class="done-icon">' + svg("done", "icon-lg") + '</div>' +
    panelHead("done", "Shipped", s.title || "Done") +
    '<p class="sub">' + esc(s.statusText || "The build is finalized and ready to merge.") + '</p>' +
    (s.approved ? '<div class="meta-row">Approved prototype <span class="badge badge-sage">' + esc(s.approved) + '</span></div>' : '') +
    (prUrl ? '<div class="meta-row">Pull request <a class="issue-link" href="#" data-ext="' + esc(prUrl) + '">#' + esc(prNo) + svg("external") + '</a></div>' : '') +
    (prNo ? '<div class="pr-review" id="prReview"><span class="muted">Loading the finalized PR…</span></div>' : '') +
    '<p class="muted" style="margin-top:14px">The loop is complete: research → prototype → plan → implement → finalize. ' +
    'The finalized PR is ready for your review and merge.</p>' +
    '<div class="row">' +
    (prUrl ? '<a class="issue-link" href="#" data-ext="' + esc(prUrl) + '">Open PR to merge' + svg("external") + '</a>' : '') +
    '<a class="issue-link" href="#" data-ext="' + esc(s.issueUrl) + '">View issue #' + esc(s.issue) + svg("external") + '</a></div>' +
    '</div>';
  if (readOnly) wireBack();
  // Reuse the head-pinned PR snapshot so the human can eyeball the final diff and
  // CI here before merging. Not gated (no Ship button on Done), so it only renders.
  if (prNo) loadPrReview(s, false);
}

function renderConn(errored, haveLast) {
  const bar = $("connbar");
  if (!bar) return;
  if (errored) {
    bar.hidden = false;
    bar.style.cssText = "margin:10px 0 0;padding:9px 14px;border-radius:10px;font-size:13px;" +
      "display:flex;align-items:center;gap:8px;background:var(--warning-tint);" +
      "color:var(--warning-text);border:1px solid var(--warning)";
    const msg = haveLast
      ? "Can\\u2019t reach GitHub right now \\u2014 showing the last known state. Retrying automatically\\u2026"
      : "Can\\u2019t reach GitHub right now. Retrying automatically\\u2026";
    bar.innerHTML = svg("alert", "icon-sm") + "<span>" + msg + "</span>";
  } else {
    bar.hidden = true;
    bar.innerHTML = "";
  }
}

function render(s) {
  // On a read failure, buildState() returns a synthetic fallback (stage research)
  // with an error set. Rendering that would make an in-flight job appear to regress,
  // so keep showing the last GOOD state and just overlay a connectivity banner.
  const errored = !!(s && s.error);
  if (!errored) lastGoodState = s;
  // Only reuse the last good state if it's the SAME job — otherwise an active-issue
  // switch mid-outage would show the wrong issue's panel.
  const sameJob = lastGoodState && s && lastGoodState.owner === s.owner &&
    lastGoodState.repo === s.repo && String(lastGoodState.issue) === String(s.issue);
  const usingLast = errored && !!sameJob;
  const view = usingLast ? lastGoodState : s;
  lastState = view;
  if (view.active) idleBuildGen++;
  // Once a job is active, retire the kickoff nonce so a future new idea gets a
  // fresh reqId and can't accidentally adopt this issue. Retries while still
  // idle keep reusing the same nonce (it's only cleared on an active state).
  if (view.active && kickoffReqId) kickoffReqId = null;
  updateAppbar(view);
  renderConn(errored, usingLast);
  if (viewKey && viewKey === currentKey(view)) viewKey = null;
  renderStrip(view);
  if (viewKey) { renderReview(view, viewKey); return; }
  if (!view.active) { renderIdle(); return; }
  if (view.status === "done") { renderDone(view, false); return; }
  if (view.gate === "signoff") { renderPrototype(view, false); return; }
  if (view.gate === "questionnaire") { renderQuestionnaire(view, false); return; }
  if (view.gate === "plan-review") { renderPlanReview(view, false); return; }
  if (view.gate === "feedback") { renderFeedback(view, false); return; }
  if (currentKey(view) === "prototype") { renderPrototype(view, false); return; }
  renderWorking(view);
}

function reviewBar(label) {
  return '<div class="reviewbar"><button class="btn btn-ghost btn-sm has-icon" id="backBtn">' + svg("back") + 'Back to current stage</button>' +
    '<span class="badge badge-neutral">Reviewing · ' + esc(label) + '</span></div>';
}
function wireBack() {
  const b = $("backBtn");
  if (b) b.onclick = () => { viewKey = null; render(lastState); };
}

// Read-only view of a completed (or in-progress) stage, reached via the strip.
function renderReview(s, key) {
  if (key === "research") {
    $("panel").innerHTML =
      '<div class="card">' + reviewBar("Research") +
      panelHead("research", "Research", "Research brief") +
      '<p class="sub">Prior art, native vs. custom trade-offs, and the recommended direction.</p>' +
      (s.research && s.research.commentId
        ? '<div class="brief" id="brief"><span class="muted">Loading research brief…</span></div>'
        : '<p class="muted" style="margin-top:16px">No research artifact yet.</p>') +
      '</div>';
    wireBack();
    if (s.research && s.research.commentId) {
      gfetch("/comment/" + s.research.commentId).then((r) => r.json()).then((c) => {
        if (c && c.body && $("brief")) $("brief").innerHTML = mdLite(c.body);
      }).catch(() => {});
    }
    return;
  }

  if (key === "prototype") {
    renderPrototype(s, true);
    return;
  }

  if (key === "plan") {
    // Read-only plan review: prefer the plan artifact, else the questionnaire/answers.
    if (s.plan && s.plan.commentId) { renderPlanReview(s, true); return; }
    renderQuestionnaire(s, true);
    return;
  }

  if (key === "implement") {
    renderFeedback(s, true);
    return;
  }

  if (key === "finalize") {
    $("panel").innerHTML =
      '<div class="card">' + reviewBar("Finalize") +
      panelHead("finalize", "Finalize", s.title || "Finalize") +
      '<p class="sub">Hardening the approved build before it is marked ready to merge.</p>' +
      (s.finalized && s.finalized.commentId
        ? '<div class="brief" id="finBrief"><span class="muted">Loading the finalize summary…</span></div>'
        : (s.impl && s.impl.prUrl
            ? '<div class="meta-row">Pull request <a class="issue-link" href="#" data-ext="' + esc(s.impl.prUrl) + '">#' + esc(s.impl.prNumber) + svg("external") + '</a></div>'
            : '<p class="muted" style="margin-top:16px">No finalize artifact yet.</p>')) +
      '</div>';
    wireBack();
    if (s.finalized && s.finalized.commentId) loadComment(s.finalized.commentId, "finBrief");
    return;
  }

  if (key === "done") {
    renderDone(s, true);
    return;
  }

  viewKey = null;
  render(s);
}

async function refresh() {
  try {
    const s = await fetch("/state", { cache: "no-store", headers: CAPH }).then((r) => r.json());
    const sig = JSON.stringify(s);
    if (sig !== last) { last = sig; render(s); }
  } catch (e) { /* keep last view */ }
}

refresh();
setInterval(refresh, 4000);
try {
  const es = new EventSource(capUrl("/events"));
  es.addEventListener("refresh", () => refresh());
} catch (e) {}
</script>
</body>
</html>`;
}
