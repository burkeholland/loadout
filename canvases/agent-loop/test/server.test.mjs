// Integration tests for the loopback server's capability-token gate. Starts a
// real server on an ephemeral port and asserts privileged routes reject requests
// that lack the per-server token. Prototype assets (/work/*) live on a SEPARATE
// token-less asset origin, which is also exercised here.
// Run: node server.test.mjs
import assert from "node:assert";
import http from "node:http";
import { join } from "node:path";
import { readFile, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import { startServer, ACTIVE_FILE, WORK_ROOT } from "../server.mjs";

let passed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log("  ok  -", name); }
  else { console.error("  FAIL -", name); process.exitCode = 1; }
}

async function req(base, path, { method = "GET", token, headers = {}, body } = {}) {
  const h = { ...headers };
  if (token) h["x-al-cap"] = token;
  if (body != null) h["Content-Type"] = "application/json";
  const r = await fetch(base + path, { method, headers: h, body: body != null ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}

async function rawReq(base, path, { method = "POST", token, headers = {}, body = "" } = {}) {
  const h = { ...headers };
  if (token) h["x-al-cap"] = token;
  const r = await fetch(base + path, { method, headers: h, body });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}

const intents = [];
const entry = await startServer({
  active: null,
  coordinator: { handleIntent: async (body) => { intents.push(body); return { ok: true }; } },
});
const { server, assetServer, url, assetBase } = entry;
const base = url.replace(/\/$/, "");

// The token is embedded in the served document only.
const homeRes = await fetch(base + "/");
const home = await homeRes.text();
ok("GET / is tokenless (200)", homeRes.status === 200);
const m = home.match(/name="al-cap" content="([a-f0-9]+)"/);
ok("HTML embeds a capability token", !!m && m[1].length >= 32);
const token = m ? m[1] : "";
// The document points prototype assets at the separate asset origin.
const am = home.match(/name="al-assets" content="(http:\/\/127\.0\.0\.1:\d+)"/);
ok("HTML embeds the asset origin", !!am && am[1] === assetBase.replace(/\/$/, ""));

// Privileged reads require the token.
ok("GET /state without token → 403", (await req(base, "/state")).status === 403);
ok("GET /state with token → 200", (await req(base, "/state", { token })).status === 200);
ok("GET /state with WRONG token → 403", (await req(base, "/state", { token: "deadbeef" })).status === 403);
ok("GET /issues without token → 403", (await req(base, "/issues")).status === 403);
ok("GET /pr without token → 403", (await req(base, "/pr")).status === 403);
ok("GET /pr with token → 200", (await req(base, "/pr", { token })).status === 200);
ok("GET /comment/123 without token → 403", (await req(base, "/comment/123")).status === 403);

// Side-effecting POSTs fail closed AND never reach the coordinator without the token.
const noTok = await req(base, "/intent", { method: "POST", body: { kind: "kickoff", data: {} } });
ok("POST /intent without token → 403", noTok.status === 403);
ok("POST /intent without token does NOT call coordinator", intents.length === 0);
const withTok = await req(base, "/intent", { method: "POST", token, body: { kind: "kickoff", data: { reqId: "r1" } } });
ok("POST /intent with token → 200", withTok.status === 200);
ok("POST /intent with token calls coordinator", intents.length === 1 && intents[0].kind === "kickoff");
const promptGone = await req(base, "/prompt", { method: "POST", token, body: { prompt: "hello", kind: "kickoff" } });
ok("POST /prompt is removed even with token → 404", promptGone.status === 404);
ok("POST /open without token → 403", (await req(base, "/open", { method: "POST", body: { url: "https://github.com/x" } })).status === 403);
const malformed = await rawReq(base, "/intent", { token, headers: { "Content-Type": "application/json" }, body: "{" });
ok("POST /intent with malformed JSON → 400", malformed.status === 400);
const beforeOversize = intents.length;
const oversized = await rawReq(base, "/intent", { token, headers: { "Content-Type": "application/json" }, body: `{"kind":"${"x".repeat(1_000_010)}"}` });
ok("POST /intent with oversized JSON → 413", oversized.status === 413);
ok("oversized body does NOT call coordinator", intents.length === beforeOversize);
const multibyteBody = JSON.stringify({ kind: "kickoff", data: "😀".repeat(250_000) });
ok("multibyte oversized fixture is under 1 MB in JS characters but over in UTF-8 bytes",
  multibyteBody.length < 1_000_000 && Buffer.byteLength(multibyteBody, "utf8") > 1_000_000);
const beforeMultibyteOversize = intents.length;
const multibyteOversized = await rawReq(base, "/intent", {
  token, headers: { "Content-Type": "application/json" }, body: multibyteBody,
});
ok("POST /intent with UTF-8 multibyte oversized JSON → 413 without coordinator call",
  multibyteOversized.status === 413 && intents.length === beforeMultibyteOversize);

const rejectedOpen = await startServer({
  active: null,
  openExternal: async () => { throw new Error("launcher rejected"); },
  coordinator: { handleIntent: async () => ({ ok: true }) },
});
const rejectedOpenRes = await req(rejectedOpen.url.replace(/\/$/, ""), "/open", {
  method: "POST",
  token: rejectedOpen.token,
  body: { url: "https://github.com/o/r/pull/1" },
});
ok("POST /open waits for launcher rejection → 500", rejectedOpenRes.status === 500);
rejectedOpen.server.close();
rejectedOpen.assetServer.close();

// EventSource can't set headers, so /events accepts the token as a query param.
const evNoTok = await fetch(base + "/events");
ok("GET /events without token → 403", evNoTok.status === 403);
evNoTok.body?.cancel?.();
const evTok = await fetch(base + "/events?t=" + token);
ok("GET /events?t=<token> → 200", evTok.status === 200);
evTok.body?.cancel?.();

// Prototype assets are NO LONGER served from the privileged origin: /work there
// is now token-gated like everything else (defense in depth), so a tokenless
// request is 403, not a served file.
ok("GET /work/* on the control origin is token-gated (403)", (await fetch(base + "/work/nope/index.html")).status === 403);

// ---- Fix#1 (DNS-rebind): Host header must be the exact bound loopback host:port ----
const mainPort = Number(new URL(url).port);
const assetPort = Number(new URL(assetBase).port);
function rawGet(port, path, host) {
  return new Promise((resolve) => {
    const r = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on("error", () => resolve(0));
    r.end();
  });
}
ok("control origin: foreign Host → 403", (await rawGet(mainPort, "/", "attacker.example:" + mainPort)) === 403);
ok("control origin: wrong port in Host → 403", (await rawGet(mainPort, "/", "127.0.0.1:" + (mainPort + 1))) === 403);
ok("control origin: exact loopback Host → 200", (await rawGet(mainPort, "/", "127.0.0.1:" + mainPort)) === 200);
ok("asset origin: foreign Host → 403", (await rawGet(assetPort, "/work/x", "evil.com:" + assetPort)) === 403);

const discoveryIssues = Array.from({ length: 7 }, (_, i) => ({ number: i + 1, title: `Build ${i + 1}` }));
const discovery = await startServer({
  active: null,
  github: {
    detectRepo: async () => ({ owner: "workspace-owner", repo: "workspace-repo" }),
    listAgentLoopIssues: async (owner, repo, options) => {
      ok("issue discovery uses detected workspace repository", owner === "workspace-owner" && repo === "workspace-repo");
      ok("issue discovery requests five open builds", options.limit === 5);
      return discoveryIssues;
    },
  },
  coordinator: { handleIntent: async () => ({ ok: true }) },
});
const discovered = await req(discovery.url.replace(/\/$/, ""), "/issues", { token: discovery.token });
ok("GET /issues returns detected repository identity", discovered.status === 200 &&
  discovered.json.owner === "workspace-owner" && discovered.json.repo === "workspace-repo");
ok("GET /issues caps results at five", discovered.json.issues.length === 5);
discovery.server.close();
discovery.assetServer.close();

const discoveryFailure = await startServer({
  active: null,
  github: { detectRepo: async () => { throw new Error("discovery unavailable"); } },
  coordinator: { handleIntent: async () => ({ ok: true }) },
});
const failedDiscovery = await req(discoveryFailure.url.replace(/\/$/, ""), "/issues", { token: discoveryFailure.token });
ok("GET /issues reports discovery failure without changing /state", failedDiscovery.status === 502 &&
  (await req(discoveryFailure.url.replace(/\/$/, ""), "/state", { token: discoveryFailure.token })).json.active === false);
discoveryFailure.server.close();
discoveryFailure.assetServer.close();

const blocker = http.createServer((req, res) => { res.writeHead(200); res.end("busy"); });
await new Promise((resolve, reject) => {
  blocker.once("error", reject);
  blocker.listen(0, "127.0.0.1", resolve);
});
const busyPort = blocker.address().port;
let bindFailed = false;
try {
  await startServer({ port: busyPort, coordinator: { handleIntent: async () => ({ ok: true }) } });
} catch (e) {
  bindFailed = /EADDRINUSE|address already in use/i.test(String(e.code || e.message || e));
}
ok("startServer rejects deterministically on bind failure", bindFailed);
await new Promise((resolve) => blocker.close(resolve));

// ---- Fix#3 (work-scope): asset origin serves ONLY the active issue's subtree ----
const assetOrigin = assetBase.replace(/\/$/, "");
// Back up the live active pointer so this test never clobbers a running session.
let activeBackup = null;
try { activeBackup = await readFile(ACTIVE_FILE, "utf8"); } catch {}
try {
  // With NO active issue, the asset origin serves nothing (404, not a file).
  await rm(ACTIVE_FILE, { force: true });
  ok("asset origin with no active issue → 404", (await fetch(assetOrigin + "/work/o/r/4/index.html")).status === 404);

  // Scope to a synthetic active issue and drop a real file inside its subtree.
  await entry.setActive("o", "r", 4);
  const dir = join(WORK_ROOT, "o", "r", "4", "round-1");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), "<h1>proto</h1>");
  ok("asset origin serves the ACTIVE issue's file (200)", (await fetch(assetOrigin + "/work/o/r/4/round-1/index.html")).status === 200);
  ok("asset origin: missing file INSIDE the active subtree → 404", (await fetch(assetOrigin + "/work/o/r/4/missing.html")).status === 404);
  ok("asset origin: another issue's subtree → 403 (cross-issue leak blocked)", (await fetch(assetOrigin + "/work/o/r/9/secret.html")).status === 403);
  ok("asset origin: another repo's subtree → 403", (await fetch(assetOrigin + "/work/o/other/4/secret.html")).status === 403);
  // Encoded traversal: a REAL sibling-issue file must not be reachable by smuggling
  // `../` past the prefix as %2e%2e%2f. Prove the file exists, then that it's 403.
  const sibDir = join(WORK_ROOT, "o", "r", "9");
  await mkdir(sibDir, { recursive: true });
  await writeFile(join(sibDir, "secret.html"), "<h1>SECRET</h1>");
  const enc = await fetch(assetOrigin + "/work/o/r/4/%2e%2e%2f%2e%2e%2f9/secret.html");
  ok("asset origin: encoded ../ traversal to a real sibling file → 403", enc.status === 403);

  // Scope-root symlink escape: if the ACTIVE issue dir is itself a junction to a
  // directory OUTSIDE WORK_ROOT, containment must STILL fail — the scoped realpath
  // must resolve beneath the global work root, not merely beneath itself.
  try {
    const isu = 900000 + (Date.now() % 90000); // unique per run → never EEXIST-skips
    const outside = join(os.tmpdir(), "al-escape-" + Date.now());
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "index.html"), "<h1>ESCAPED</h1>");
    await entry.setActive("o", "r", isu);
    await symlink(outside, join(WORK_ROOT, "o", "r", String(isu)), "junction");
    const esc = await fetch(assetOrigin + "/work/o/r/" + isu + "/index.html");
    ok("asset origin: symlinked issue dir escaping WORK_ROOT → 403", esc.status === 403);
  } catch (e) {
    console.log("  skip - symlink escape test (", e.code || e.message, ")");
  }
} finally {
  if (activeBackup != null) { if (!existsSync(ACTIVE_FILE)) await mkdir(join(ACTIVE_FILE, ".."), { recursive: true }).catch(() => {}); await writeFile(ACTIVE_FILE, activeBackup); }
  else await rm(ACTIVE_FILE, { force: true });
}

// Each server is permanently bound to its own issue even when another canvas
// instance updates the compatibility pointer. New servers always start unbound.
const stateFor = async (target) => target ? { active: true, ...target } : { active: false };
let bindingBackup = null;
try { bindingBackup = await readFile(ACTIVE_FILE, "utf8"); } catch {}
let canvasA, canvasB, canvasDefault, canvasIdle;
try {
  canvasA = await startServer({ active: { owner: "o", repo: "r", issue: 41 }, buildState: stateFor, coordinator: { handleIntent: async () => ({ ok: true }) } });
  canvasB = await startServer({ active: { owner: "o", repo: "r", issue: 42 }, buildState: stateFor, coordinator: { handleIntent: async () => ({ ok: true }) } });
  await canvasB.setActive("o", "r", 43);
  const stateA = await req(canvasA.url.replace(/\/$/, ""), "/state", { token: canvasA.token });
  const stateB = await req(canvasB.url.replace(/\/$/, ""), "/state", { token: canvasB.token });
  ok("canvas A remains bound to its own issue", stateA.json.issue === 41);
  ok("canvas B follows only its own explicit rebind", stateB.json.issue === 43);
  canvasDefault = await startServer({ buildState: stateFor, coordinator: { handleIntent: async () => ({ ok: true }) } });
  const defaultState = await req(canvasDefault.url.replace(/\/$/, ""), "/state", { token: canvasDefault.token });
  ok("new canvas ignores active.json and opens unbound", defaultState.json.active === false);
  canvasIdle = await startServer({ active: null, buildState: stateFor, coordinator: { handleIntent: async () => ({ ok: true }) } });
  const idleState = await req(canvasIdle.url.replace(/\/$/, ""), "/state", { token: canvasIdle.token });
  ok("explicitly unbound canvas is consistently idle", idleState.json.active === false);
  ok("unbound canvas comment route agrees with idle state", (await req(canvasIdle.url.replace(/\/$/, ""), "/comment/123", { token: canvasIdle.token })).status === 404);
} finally {
  for (const canvas of [canvasA, canvasB, canvasDefault, canvasIdle]) {
    canvas?.server.close();
    canvas?.assetServer.close();
  }
  if (bindingBackup != null) await writeFile(ACTIVE_FILE, bindingBackup);
  else await rm(ACTIVE_FILE, { force: true });
}

// The asset origin exposes NO privileged routes and NO token document.
ok("asset origin has NO / document (no token to steal)", (await fetch(assetOrigin + "/")).status === 404);
ok("asset origin has NO /state", (await fetch(assetOrigin + "/state")).status === 404);
const assetPrompt = await fetch(assetOrigin + "/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "x", kind: "x" }) });
ok("asset origin has NO /prompt (404) and cannot reach coordinator", assetPrompt.status === 404 && intents.length === 1);

server.close();
assetServer.close();
console.log(`\n${passed} assertions passed`);
