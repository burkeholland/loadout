// HTTP backend for the Agent Loop canvas, factored out of extension.mjs so it
// can be exercised by a standalone test harness (which injects a stub session).

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, stat, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize, extname, sep } from "node:path";
import { homedir } from "node:os";
import { renderHtml } from "./webview.mjs";
import * as GitHub from "./github.mjs";
import { getIssue, listComments, getComment, getPull, getPullHead, getPullFiles, findControlBlock, findCommentByHeading, findPrototypeComments, findQuestionnaireComment, findBuildReadyComment } from "./github.mjs";
import { buildSnapshot } from "./pr.mjs";
import { createCoordinator } from "./workflow.mjs";
import { validateGithubTarget } from "./target.mjs";

export const DATA_ROOT = join(homedir(), ".agent-loop");
export const ACTIVE_FILE = join(DATA_ROOT, "active.json");
export const WORK_ROOT = join(DATA_ROOT, "work");

const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Only allow opening GitHub pages or the local preview server in the system
// browser — never arbitrary URLs handed to a shell.
function isSafeOpenUrl(u) {
  try {
    const p = new URL(u);
    if (p.protocol === "https:") {
      const h = p.hostname.toLowerCase();
      return h === "github.com" || h.endsWith(".github.com");
    }
    if (p.protocol === "http:") {
      const h = p.hostname.toLowerCase();
      return h === "127.0.0.1" || h === "localhost";
    }
    return false;
  } catch { return false; }
}

function openInSystemBrowser(u) {
  const plat = process.platform;
  let child;
  if (plat === "win32") {
    // Never route the URL through `cmd /c start`: shell metacharacters that
    // survive URL parsing (e.g. `&`) would be interpreted by cmd. rundll32's
    // FileProtocolHandler opens the default browser without a shell, and Node
    // quotes the argv entries safely (no windowsVerbatimArguments).
    const root = process.env.SystemRoot || "C:\\Windows";
    child = spawn(join(root, "System32", "rundll32.exe"), ["url.dll,FileProtocolHandler", u], { detached: true, stdio: "ignore" });
  }
  else if (plat === "darwin") child = spawn("open", [u], { detached: true, stdio: "ignore" });
  else child = spawn("xdg-open", [u], { detached: true, stdio: "ignore" });
  return new Promise((resolve, reject) => {
    let settled = false;
    const onError = (err) => {
      if (settled) return;
      settled = true;
      child.off("spawn", onSpawn);
      reject(err);
    };
    const onSpawn = () => {
      if (settled) return;
      settled = true;
      child.off("error", onError);
      child.on("error", () => {});
      child.unref();
      resolve();
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    let settled = false;
    const fail = (status, message) => {
      if (settled) return;
      settled = true;
      reject(new HttpError(status, message));
    };
    req.on("data", (c) => {
      if (tooLarge) return;
      const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c);
      size += chunk.length;
      if (size > 1_000_000) {
        tooLarge = true;
        chunks.length = 0;
        fail(413, "request body too large");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      try {
        const body = chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
        resolve(body ? JSON.parse(body) : {});
      }
      catch { fail(400, "malformed JSON"); }
    });
    req.on("aborted", () => fail(400, "interrupted JSON request"));
    req.on("error", () => fail(400, "interrupted JSON request"));
  });
}

function listenLoopback(server, port = 0) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };
    const onListening = () => { cleanup(); resolve(); };
    const onError = (err) => { cleanup(); reject(err); };
    server.once("listening", onListening);
    server.once("error", onError);
    try { server.listen(port, "127.0.0.1"); }
    catch (e) { cleanup(); reject(e); }
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    try { server.close(() => resolve()); }
    catch { resolve(); }
  });
}

export async function readActive() {
  try {
    const raw = await readFile(ACTIVE_FILE, "utf8");
    const j = JSON.parse(raw);
    if (j && j.owner && j.repo && j.issue) return j;
  } catch {}
  return null;
}

function labelNames(issue) {
  return (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean);
}

// Build the issue-authoritative read model consumed by the webview.
export async function buildState(target = null) {
  const active = target || await readActive();
  if (!active) return { active: false };
  const { owner, repo, issue } = active;
  try {
    const [iss, comments] = await Promise.all([
      getIssue(owner, repo, issue),
      listComments(owner, repo, issue),
    ]);
    return deriveState({ owner, repo, issue, iss, comments });
  } catch (e) {
    return {
      active: true, owner, repo, issue, error: String(e.message || e), status: "working",
      statusText: "Reading issue state…", stage: "research", gate: null, round: 1, implRound: 0,
      txn: null, pending: null, prototypeRounds: [], prototypeComments: [],
      research: null, questionnaire: null, answers: null, plan: null, impl: null, finalized: null,
      approved: null,
    };
  }
}

// Pure derivation of the read model from a fetched issue + its comments. Kept
// side-effect-free so it can be exercised directly with fixtures.
export function deriveState({ owner, repo, issue, iss, comments }) {
  {
    const labels = labelNames(iss);
    const control = findControlBlock(comments);
    const d = (control && control.data) || {};

    const stageLabel = labels.find((l) => l.startsWith("stage:"));
    const gateLabel = labels.find((l) => l.startsWith("gate:"));
    // Accept both the current `proto-round:N` label and the legacy `round:N`.
    const roundLabel = labels.find((l) => l.startsWith("proto-round:") || l.startsWith("round:"));
    const implRoundLabel = labels.find((l) => l.startsWith("impl-round:"));

    const gate = d.gate !== undefined ? d.gate : (gateLabel ? gateLabel.slice(5) : null);
    // Gate → stage fallback covers every human gate in the full pipeline, used
    // only when the control block lacks an explicit stage.
    const stage = d.stage || (stageLabel ? stageLabel.slice(6)
      : gate === "signoff" ? "prototype"
      : gate === "questionnaire" ? "planning"
      : gate === "plan-review" ? "planning"
      : gate === "feedback" ? "implementing"
      : "research");
    const artifacts = d.artifacts || {};
    // Prototype rounds parsed from the conversation are the authoritative round
    // count at sign-off; the round label is often left stale by the loop.
    const prototypeComments = findPrototypeComments(comments);
    const round = d.round
      || (prototypeComments[0] && prototypeComments[0].round)
      || (roundLabel ? Number(roundLabel.slice(roundLabel.indexOf(":") + 1)) : 1);
    const implRound = d.implRound != null ? d.implRound
      : (implRoundLabel ? Number(implRoundLabel.slice(11)) : 0);

    let status = d.status;
    if (!status) status = gate ? "waiting" : (stage === "done" ? "done" : "working");
    let statusText = d.statusText;
    if (!statusText) {
      statusText = gate === "signoff" ? "Waiting for your sign-off."
        : gate === "questionnaire" ? "Waiting for your answers."
        : gate === "plan-review" ? "Waiting for your plan approval."
        : gate === "feedback" ? "Waiting for your review of the PR."
        : stage === "research" ? "Researching prior art and approaches…"
        : stage === "prototype" ? "Building prototype options…"
        : stage === "planning" ? "Drafting clarifying questions…"
        : stage === "planning-finalize" ? "Drafting the implementation plan…"
        : stage === "implementing" ? "Building the change…"
        : stage === "finalizing" ? "Finalizing the PR…"
        : stage === "done" ? "Done — PR ready to merge."
        : "Working…";
    }

    // Prefer control-block artifacts, but fall back to reading them straight
    // from the issue conversation so past stages stay reviewable without a
    // maintained control block.
    let research = artifacts.research || null;
    if (!research) {
      const rc = findCommentByHeading(comments, "🔎 Research");
      if (rc) research = { commentId: rc.commentId };
    }
    let prototypeRounds = artifacts.prototypeRounds || [];

    // Fall back to reading later-stage artifacts straight from the conversation
    // so every stage stays reviewable even without a maintained control block.
    let questionnaire = artifacts.questionnaire || null;
    if (!questionnaire || !Array.isArray(questionnaire.questions) || !questionnaire.questions.length) {
      const parsed = findQuestionnaireComment(comments, questionnaire && questionnaire.commentId);
      if (parsed) {
        questionnaire = {
          ...(questionnaire || {}),
          commentId: (questionnaire && questionnaire.commentId) || parsed.commentId,
          questions: parsed.questions,
        };
      }
    }
    let answers = artifacts.answers || null;
    if (!answers) {
      const ac = findCommentByHeading(comments, "💬 Answers", { newest: true });
      if (ac) answers = { commentId: ac.commentId };
    }
    let plan = artifacts.plan || null;
    if (!plan) {
      const pc = findCommentByHeading(comments, "🗺 Plan", { newest: true });
      if (pc) plan = { commentId: pc.commentId, approved: null };
    }
    let impl = artifacts.impl || null;
    if (!impl || impl.prNumber == null) {
      const bc = findBuildReadyComment(comments, impl && impl.commentId);
      if (bc) {
        impl = {
          ...(impl || {}),
          commentId: (impl && impl.commentId) || bc.commentId,
          prNumber: bc.prNumber,
          prUrl: bc.prUrl,
        };
      }
    }
    let finalized = artifacts.finalized || null;
    if (!finalized) {
      const fc = findCommentByHeading(comments, "✅ Finalized", { newest: true });
      if (fc) finalized = { commentId: fc.commentId };
    }

    return {
      active: true, owner, repo, issue,
      issueUrl: iss.html_url,
      title: d.title || iss.title,
      stage, gate, round, implRound, status, statusText,
      txn: d.txn || null,
      pending: d.pending || null,
      updatedAt: d.updatedAt || null,
      labels,
      research,
      prototypeRounds,
      prototypeComments,
      questionnaire,
      answers,
      plan,
      impl,
      finalized,
      approved: d.approved || null,
      controlCommentId: control ? control.commentId : null,
    };
  }
}

// Assemble the head-pinned PR review snapshot for the feedback gate. This is a
// SEPARATE endpoint (never folded into /state) precisely because check/diff data
// is volatile: putting it in the 4s poll would thrash the gate panel and wipe
// in-progress feedback text. The PR is resolved from the ACTIVE issue's derived
// state — the client never supplies owner/repo/number.
export async function buildPrSnapshot(target = null) {
  const state = await buildState(target);
  if (!state || !state.active) return { available: false, reason: "no-active-issue" };
  const { owner, repo, issue } = state;
  const impl = state.impl || null;
  const prNumber = impl && impl.prNumber;
  if (prNumber == null || !/^[1-9]\d*$/.test(String(prNumber))) {
    return { available: false, reason: "no-pr", owner, repo, issue };
  }
  const reviewedHead = (impl && impl.headSha) || null;
  try {
    const metaA = await getPull(owner, repo, prNumber);
    const files = await getPullFiles(owner, repo, prNumber);
    const metaB = await getPullHead(owner, repo, prNumber); // re-read to catch a mid-read head move
    const snap = buildSnapshot({ metaA, metaB, files, reviewedHead });
    // Stamp the job identity so the client can prove this snapshot belongs to the
    // issue/PR its panel is bound to (the global active pointer can move under a
    // multi-instance canvas — number alone is not unique across repos).
    return { ...snap, owner, repo, issue };
  } catch (e) {
    return { available: false, reason: "error", error: String(e.message || e), owner, repo, issue };
  }
}


async function serveWork(urlPath, res, scopeRoot) {
  let rel = decodeURIComponent(urlPath.replace(/^\/work\//, ""));
  rel = rel.split("?")[0].split("#")[0];
  let full = normalize(join(WORK_ROOT, rel));
  // Containment is enforced AFTER normalization against the (optionally scoped)
  // root. Checking a decoded string prefix BEFORE normalize is bypassable via
  // encoded traversal (e.g. `%2e%2e%2f` → `../`), so we resolve first and then
  // require `full` to live beneath the scoped root — never a string compare on
  // the raw path.
  const within = (child, root) => child === root || child.startsWith(root + sep);
  const lexRoot = scopeRoot ? normalize(scopeRoot) : WORK_ROOT;
  // Lexical: the scoped root must itself sit under WORK_ROOT, and the target
  // under the scoped root.
  if (!within(lexRoot, WORK_ROOT) || !within(full, lexRoot)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  try {
    let s = await stat(full).catch(() => null);
    if (s && s.isDirectory()) { full = join(full, "index.html"); s = await stat(full).catch(() => null); }
    if (!s) { res.writeHead(404); res.end("Not found"); return; }
    // Two-level realpath anchor. Lexical `..` is handled above, but a symlink/
    // junction can still point outside the tree. We require BOTH: (1) the scoped
    // root resolves beneath the GLOBAL work root — so a symlinked owner/repo/issue
    // dir pointing outside WORK_ROOT can't quietly move the anchor with it — and
    // (2) the target resolves beneath that scoped root.
    const realWorkRoot = await realpath(WORK_ROOT).catch(() => WORK_ROOT);
    const realScopeRoot = await realpath(lexRoot).catch(() => null);
    const realFull = await realpath(full).catch(() => null);
    if (!realScopeRoot || !within(realScopeRoot, realWorkRoot) ||
        !realFull || !within(realFull, realScopeRoot)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    const buf = await readFile(full);
    res.writeHead(200, {
      "Content-Type": MIME[extname(full).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
}

// Start a loopback HTTP server. POST /intent sends structured human intent to
// the deterministic workflow coordinator; arbitrary UI-authored prompts are not
// accepted.
export async function startServer(deps = {}) {
  if (!existsSync(DATA_ROOT)) await mkdir(DATA_ROOT, { recursive: true });
  if (!existsSync(WORK_ROOT)) await mkdir(WORK_ROOT, { recursive: true });
  const clients = new Set();
  // New canvas instances always start at the launcher. A caller may explicitly
  // bind an issue, but the process-wide compatibility pointer is never adopted
  // implicitly.
  let active = Object.hasOwn(deps, "active") && deps.active != null
    ? validateGithubTarget(deps.active)
    : null;
  const readBoundActive = async () => active;
  const setBoundActive = async (owner, repo, issue) => {
    const target = validateGithubTarget({ owner, repo, issue });
    await setActive(target.owner, target.repo, target.issue);
    active = target;
  };
  const buildBoundState = async () => active
    ? (deps.buildState || buildState)(active)
    : { active: false };
  const buildBoundPrSnapshot = async () => active
    ? (deps.buildPrSnapshot || buildPrSnapshot)(active)
    : { available: false, reason: "no-active-issue" };

  // Per-server capability token. Embedded only in the top-level document, so a
  // sandboxed prototype iframe (opaque origin) can't read it and therefore can't
  // mint privileged requests to the loopback server. `/` is the only tokenless
  // route on THIS origin; prototype assets live on a separate asset origin below.
  const token = randomBytes(24).toString("hex");
  const authed = (req, url) => {
    const h = req.headers["x-al-cap"];
    if (typeof h === "string" && h === token) return true;
    const q = url.searchParams.get("t");
    return typeof q === "string" && q === token;
  };

  // Anti-DNS-rebinding: only accept requests whose Host header is the exact
  // loopback host:port we bound. A rebinding attacker's page carries its own
  // hostname in Host (even after the name resolves to 127.0.0.1), so this rejects
  // it before the tokenless `/` can hand out the capability token.
  let mainPort = 0;
  const hostAllowed = (req, expectedPort) => {
    const host = String(req.headers.host || "").toLowerCase();
    const m = host.match(/^([^:]+|\[[^\]]+\]):(\d+)$/);
    if (!m) return false;
    const hn = m[1];
    return (hn === "127.0.0.1" || hn === "localhost" || hn === "[::1]") && Number(m[2]) === expectedPort;
  };

  // Prototype assets are served from a SEPARATE token-less loopback origin. A
  // popped-out prototype opens as a real (non-sandboxed) browser tab; keeping it
  // cross-origin from the control server means its JS cannot read the capability
  // token from `/` (blocked by the same-origin policy) nor POST /intent (403
  // cross-origin). This origin serves ONLY /work/* for the ACTIVE issue — it has
  // no token document and no privileged routes to reach.
  let assetPort = 0;
  const assetServer = createServer(async (req, res) => {
    try {
      if (!hostAllowed(req, assetPort)) { res.writeHead(403); res.end("Forbidden host"); return; }
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname.startsWith("/work/")) {
        // Scope every asset read to this canvas instance's owner/repo/issue
        // subtree so a
        // popped-out prototype can't fetch sibling issues' work dirs and exfil
        // them.
        const active = await readBoundActive();
        if (!active) { res.writeHead(404); res.end("Not found"); return; }
        const scopeRoot = join(WORK_ROOT, String(active.owner), String(active.repo), String(active.issue));
        await serveWork(url.pathname, res, scopeRoot);
        return;
      }
      res.writeHead(404); res.end("Not found");
    } catch { try { res.writeHead(500); res.end("error"); } catch {} }
  });
  await listenLoopback(assetServer, 0);
  const aAddr = assetServer.address();
  assetPort = typeof aAddr === "object" && aAddr ? aAddr.port : 0;
  const assetBase = `http://127.0.0.1:${assetPort}`;
  let serverEntry = null;
  try {
    const github = deps.github || {
      ...GitHub,
      detectRepo: () => GitHub.detectRepo(deps.workingDirectory),
    };
    const coordinator = deps.coordinator || createCoordinator({
      github,
      sendPrompt: deps.sendPrompt || deps.onPrompt || (async () => {}),
      setActive: setBoundActive,
      readActive: readBoundActive,
      workRoot: WORK_ROOT,
      assetBase,
      instanceId: deps.instanceId || "agent-loop",
      openPrSession: deps.openPrSession,
      refresh: async () => { if (serverEntry) broadcastRefresh(serverEntry); },
    });
    const openExternal = deps.openExternal || openInSystemBrowser;

    const server = createServer(async (req, res) => {
    try {
      if (!hostAllowed(req, mainPort)) { res.writeHead(403); res.end("Forbidden host"); return; }
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const path = url.pathname;

      if (req.method === "GET" && (path === "/" || path === "")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(renderHtml(token, assetBase));
        return;
      }
      // Everything below this line is privileged: reads that could expose issue/PR
      // content cross-origin, or side-effecting POSTs. The one exception is the
      // retired /prototype route (410) handled further down.
      const tokenless = path === "/prototype";
      if (!tokenless && !authed(req, url)) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
      if (req.method === "GET" && path === "/state") {
        sendJson(res, 200, await buildBoundState());
        return;
      }
      if (req.method === "GET" && path === "/issues") {
        try {
          const repoInfo = await github.detectRepo();
          const issues = (await github.listAgentLoopIssues(repoInfo.owner, repoInfo.repo, { limit: 5 })).slice(0, 5);
          sendJson(res, 200, { owner: repoInfo.owner, repo: repoInfo.repo, issues });
        } catch (e) {
          sendJson(res, 502, { error: String(e.message || e) });
        }
        return;
      }
      if (req.method === "GET" && path === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
        res.write("event: refresh\ndata: {}\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (req.method === "GET" && path.startsWith("/comment/")) {
        const id = path.slice("/comment/".length);
        if (!/^\d+$/.test(id)) { sendJson(res, 400, { error: "invalid comment id" }); return; }
        const active = await readBoundActive();
        if (!active) { sendJson(res, 404, { error: "no active issue" }); return; }
        try {
          const c = await getComment(active.owner, active.repo, id, active.issue);
          // Never hand back a comment that belongs to a different issue/repo. The
          // GraphQL fallback (used only on REST degradation) is already scoped to
          // the active issue and carries no issue_url, so absence is acceptable;
          // a present issue_url must match.
          if (c.issue_url) {
            const want = `/repos/${active.owner}/${active.repo}/issues/${active.issue}`.toLowerCase();
            if (!String(c.issue_url).toLowerCase().endsWith(want)) {
              sendJson(res, 403, { error: "comment does not belong to the active issue" });
              return;
            }
          }
          sendJson(res, 200, { id: c.id, body: c.body });
        } catch (e) { sendJson(res, 502, { error: String(e.message || e) }); }
        return;
      }
      if (req.method === "GET" && path === "/pr") {
        sendJson(res, 200, await buildBoundPrSnapshot());
        return;
      }
      if (req.method === "GET" && path === "/prototype") {
        // Removed: this proxied arbitrary loopback HTTP responses (SSRF) and
        // injected script. Prototype previews are now served directly from
        // WORK_ROOT via /work/<path>; the canvas builds those URLs itself.
        res.writeHead(410); res.end("Gone");
        return;
      }
      if (req.method === "POST" && path === "/open") {
        const body = await readBody(req);
        const target = typeof body.url === "string" ? body.url : "";
        if (!isSafeOpenUrl(target)) { sendJson(res, 400, { ok: false, error: "blocked url" }); return; }
        try { await openExternal(target); sendJson(res, 200, { ok: true }); }
        catch (e) { sendJson(res, 500, { ok: false, error: String(e.message || e) }); }
        return;
      }
      if (req.method === "POST" && path === "/intent") {
        const body = await readBody(req);
        if (!body || typeof body.kind !== "string") { sendJson(res, 400, { ok: false, error: "intent kind is required" }); return; }
        try {
          const out = await coordinator.handleIntent(body);
          sendJson(res, 200, { ok: true, result: out });
        } catch (e) {
          sendJson(res, 502, { ok: false, error: String(e.message || e) });
        }
        return;
      }
      res.writeHead(404); res.end("Not found");
      } catch (e) {
        try { sendJson(res, e.status || 500, { error: String(e.message || e) }); } catch {}
      }
    });

    await listenLoopback(server, deps.port || 0);
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    mainPort = port;
    serverEntry = {
      server, assetServer, clients, url: `http://127.0.0.1:${port}/`, assetBase,
      token, coordinator, readActive: readBoundActive, setActive: setBoundActive,
      buildState: buildBoundState, buildPrSnapshot: buildBoundPrSnapshot,
    };
    return serverEntry;
  } catch (e) {
    await closeServer(assetServer);
    throw e;
  }
}

export function broadcastRefresh(entry) {
  if (!entry) return;
  const payload = "event: refresh\ndata: {}\n\n";
  for (const client of entry.clients) { try { client.write(payload); } catch {} }
}

export async function setActive(owner, repo, issue) {
  const target = validateGithubTarget({ owner, repo, issue });
  if (!existsSync(DATA_ROOT)) await mkdir(DATA_ROOT, { recursive: true });
  await writeFile(ACTIVE_FILE, JSON.stringify(target, null, 2));
}
