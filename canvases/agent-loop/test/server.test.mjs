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
import { startServer, setActive, ACTIVE_FILE, WORK_ROOT } from "../server.mjs";

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

const prompts = [];
const { server, assetServer, url, assetBase } = await startServer({ onPrompt: async (prompt, kind) => { prompts.push({ prompt, kind }); } });
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
ok("GET /pr without token → 403", (await req(base, "/pr")).status === 403);
ok("GET /pr with token → 200", (await req(base, "/pr", { token })).status === 200);
ok("GET /comment/123 without token → 403", (await req(base, "/comment/123")).status === 403);

// Side-effecting POSTs fail closed AND never reach onPrompt without the token.
const noTok = await req(base, "/prompt", { method: "POST", body: { prompt: "hi", kind: "x" } });
ok("POST /prompt without token → 403", noTok.status === 403);
ok("POST /prompt without token does NOT call onPrompt", prompts.length === 0);
const withTok = await req(base, "/prompt", { method: "POST", token, body: { prompt: "hello", kind: "kickoff" } });
ok("POST /prompt with token → 200", withTok.status === 200);
ok("POST /prompt with token calls onPrompt", prompts.length === 1 && prompts[0].kind === "kickoff");
ok("POST /open without token → 403", (await req(base, "/open", { method: "POST", body: { url: "https://github.com/x" } })).status === 403);

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
  await setActive("o", "r", 4);
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
    await setActive("o", "r", isu);
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

// The asset origin exposes NO privileged routes and NO token document.
ok("asset origin has NO / document (no token to steal)", (await fetch(assetOrigin + "/")).status === 404);
ok("asset origin has NO /state", (await fetch(assetOrigin + "/state")).status === 404);
const assetPrompt = await fetch(assetOrigin + "/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "x", kind: "x" }) });
ok("asset origin has NO /prompt (404) and cannot reach onPrompt", assetPrompt.status === 404 && prompts.length === 1);

server.close();
assetServer.close();
console.log(`\n${passed} assertions passed`);
