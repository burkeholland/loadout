// DOM-shim harness: extracts the client script from renderHtml() and renders
// each gate panel against a mock /state, asserting the right controls appear.
// This exercises the real client JS (not just a syntax check).
import { renderHtml } from "../webview.mjs";

const html = renderHtml();
const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if (!m) { console.error("no client script found"); process.exit(1); }
const clientJS = m[1];

function makeEl(id) {
  const el = {
    id, _html: "", textContent: "", value: "", disabled: false, _focused: false,
    classList: { add() {}, remove() {}, contains() { return false; } },
    style: {}, onclick: null, _to: null,
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    focus() { this._focused = true; }, setAttribute() {}, getAttribute() { return null; },
    contains() { return false; }, closest() { return null; },
    querySelectorAll() { return []; }, addEventListener() {},
    appendChild() {}, removeChild() {},
  };
  return el;
}

function run(state, commentBody, opts) {
  opts = opts || {};
  const els = new Map();
  const getEl = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const doc = {
    getElementById: getEl,
    documentElement: { setAttribute() {}, getAttribute() { return "dark"; } },
    addEventListener() {}, createElement: () => makeEl("tmp"), body: makeEl("body"),
    querySelectorAll: () => [],
  };
  const posts = [];
  const fetchMock = async (url, o) => {
    if (o && o.method === "POST") {
      try { posts.push({ url, body: JSON.parse(o.body) }); } catch (e) {}
      const okPost = !opts.failPost;
      return { ok: okPost, status: okPost ? 200 : 502, json: async () => ({ ok: okPost }) };
    }
    if (url === "/pr" && opts.prHttpFail) return { ok: false, status: 502, json: async () => ({}) };
    if (url === "/issues" && opts.issuesHttpFail) {
      return { ok: false, status: 502, json: async () => ({ error: "discovery unavailable" }) };
    }
    return {
      ok: true, status: 200,
      json: async () => {
        if (url === "/state") return opts.statePayload || state;
        if (url === "/pr") return opts.prSnapshot || {};
        if (url === "/issues") return opts.issuesPayload || { owner: "o", repo: "r", issues: [] };
        if (url.startsWith("/comment/")) return { body: commentBody || "## Heading\nbody" };
        return {};
      },
    };
  };
  const g = {
    document: doc, window: { matchMedia: () => ({ matches: true }), addEventListener() {}, _prototypeResizeBound: true },
    localStorage: { getItem: () => "dark", setItem() {} },
    crypto: { randomUUID: () => Math.random().toString(16).slice(2, 10) + "-abcd-0000" },
    location: { origin: "http://localhost:9999" },
    fetch: fetchMock,
    EventSource: function () { return { addEventListener() {} }; },
    setInterval: () => 0, clearTimeout: () => {}, setTimeout: (fn) => { try { if (fn) fn(); } catch (e) {} return 0; },
    console,
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function(...Object.keys(g), clientJS + "\n;return { render: render, getEl: __getEl, mdLite: mdLite };"
    .replace("__getEl", "(function(id){return document.getElementById(id);})"));
  const ctx = fn(...Object.values(g));
  ctx.render(state);
  return { html: getEl("panel")._html + " ||STRIP|| " + getEl("strip")._html, el: getEl, posts, render: ctx.render, mdLite: ctx.mdLite };
}

function assert(name, cond) {
  if (cond) { console.log("  ok  -", name); }
  else { console.error("  FAIL -", name); process.exitCode = 1; }
}

const base = { active: true, owner: "o", repo: "r", issue: 7, issueUrl: "http://x/7",
  title: "Test idea", txn: 3, pending: null, round: 1, implRound: 1,
  prototypeRounds: [], prototypeComments: [] };

const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }; // flush async fetch chains (/pr, /comment)

// Questionnaire gate — one-at-a-time stepper with choices + free-text note
let r = run({ ...base, stage: "planning", gate: "questionnaire", status: "waiting",
  questionnaire: { commentId: 10, questions: [
    { id: "q1", select: "single", prompt: "Which framework?", choices: ["React", "Vue"] },
    { id: "q2", select: "multi", prompt: "Which constraints?", choices: ["Min/max", "Disabled"] },
    { id: "q3", select: "text", prompt: "Anything else?", choices: [] },
  ] } });
let out = r.el("panel")._html;
assert("questionnaire shows first question only", out.includes("Question 1 of 3") && out.includes("Which framework?"));
assert("questionnaire renders single-select choices", out.includes('id="qc_q1_0"') && out.includes('id="qc_q1_1"'));
assert("questionnaire always offers a free-text note", out.includes('id="qtext"'));
assert("questionnaire first step shows Next not Submit", out.includes('id="qNextBtn"') && !out.includes('id="answersBtn"'));
assert("questionnaire shows gate banner", out.includes("answer to shape the plan"));
// q1: pick a choice (radio) then advance
r.el("qc_q1_0").onclick();          // select "React"
assert("questionnaire keeps focus on the toggled choice (a11y)", r.el("qc_q1_0")._focused === true);
r.el("qNextBtn").onclick();          // → q2
out = r.el("panel")._html;
assert("questionnaire advances to Q2", out.includes("Question 2 of 3") && out.includes("Which constraints?"));
assert("questionnaire back button enabled after step 1", /id="qBackBtn"(?![^>]*disabled)/.test(out));
assert("questionnaire focuses the new question on Next (a11y)", r.el("qStepPrompt")._focused === true);
assert("questionnaire step prompt is focusable", /id="qStepPrompt"[^>]*tabindex="-1"/.test(out));
// q2: multi-select two choices then advance
r.el("qc_q2_0").onclick();          // "Min/max"
r.el("qc_q2_1").onclick();          // "Disabled"
r.el("qNextBtn").onclick();          // → q3 (last)
out = r.el("panel")._html;
assert("questionnaire last step shows Submit", out.includes("Question 3 of 3") && out.includes('id="answersBtn"') && !out.includes('id="qNextBtn"'));
// q3: free-text note
r.el("qtext").value = "Toast + aria-live";
r.el("qtext").oninput();
await r.el("answersBtn").onclick();
const answersPost = r.posts.find((p) => p.url === "/intent");
assert("answers POST is structured /intent", !!answersPost && answersPost.body.kind === "answers" && answersPost.body.expectedTxn === 3);
assert("answers POST carries the single-select choice", !!answersPost && answersPost.body.data.answers[0].answer === "React");
assert("answers POST carries the multi-select choices", !!answersPost && answersPost.body.data.answers[1].answer.includes("\u201cMin/max\u201d") && answersPost.body.data.answers[1].answer.includes("\u201cDisabled\u201d"));
assert("answers POST carries the free-text note", !!answersPost && answersPost.body.data.answers[2].answer.includes("Toast + aria-live"));

// Plan-review gate
out = run({ ...base, stage: "planning-finalize", gate: "plan-review", status: "waiting",
  plan: { commentId: 11, approved: null } }).html;
assert("plan-review has approve + revise", out.includes('id="planOkBtn"') && out.includes('id="planReviseBtn"'));
assert("plan-review loads plan brief", out.includes('id="planBrief"'));

// Feedback gate
r = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } },
  null, { prSnapshot: { available: true, reviewable: true, owner: "o", repo: "r", issue: 7, prNumber: 42, checks: { state: "passed" }, changedFiles: 1,
    files: [{ path: "a.js", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+x", noPatch: false }] } });
out = r.html;
assert("feedback has ship + revise", out.includes('id="shipBtn"') && out.includes('id="reviseBtn"'));
assert("feedback shows PR link", out.includes("http://x/pull/42") && out.includes("#42"));
await tick();
await r.el("shipBtn").onclick();
const shipPost = r.posts.find((p) => p.url === "/intent");
assert("ship POST emits structured kind", !!shipPost && shipPost.body.kind === "ship" && shipPost.body.expectedTxn === 3);

// Kickoff (idle) emits a reqId nonce
r = run({ active: false });
out = r.html;
assert("idle renders idea box", out.includes('id="idea"') && out.includes('id="startBtn"'));
assert("idle defaults to Existing builds with New build one tab away",
  out.includes('class="idle-tab active" id="existingTab"') && out.includes('id="newPane" role="tabpanel" hidden'));
r.el("idea").value = "A tooltip component";
await r.el("startBtn").onclick();
const kfPost = r.posts.find((p) => p.url === "/intent");
assert("kickoff POST emits reqId in structured data", !!kfPost && kfPost.body.kind === "kickoff" && /^kf-/.test(kfPost.body.data.reqId));

const issuesPayload = { owner: "o", repo: "r", issues: [
  { number: 2, title: "First build", updatedAt: new Date().toISOString(), labels: ["agent-loop", "stage:prototype"] },
  { number: 1, title: "SQLite canvas", updatedAt: new Date(Date.now() - 3600000).toISOString(), labels: ["agent-loop", "gate:signoff"] },
] };
r = run({ active: false }, null, { issuesPayload });
assert("existing-build list starts in a local loading state", r.html.includes("Loading existing builds"));
await tick();
assert("existing-build list renders repository issues", r.el("buildList")._html.includes("First build") &&
  r.el("buildList")._html.includes("SQLite canvas"));
r.el("buildSearch").value = "sqlite";
r.el("buildSearch").oninput();
assert("existing-build search filters title and issue number", !r.el("buildList")._html.includes("First build") &&
  r.el("buildList")._html.includes("SQLite canvas"));
await r.el("buildIssue_1").onclick();
const openExisting = r.posts.find((p) => p.url === "/intent" && p.body.kind === "open-existing");
assert("existing-build selection sends only structured bind routing", !!openExisting &&
  openExisting.body.owner === "o" && openExisting.body.repo === "r" && openExisting.body.issue === 1 &&
  Object.keys(openExisting.body.data).length === 0);

r = run({ active: false }, null, { issuesPayload: { owner: "o", repo: "r", issues: [] } });
await tick();
assert("empty existing-build list is explicit", r.el("buildList")._html.includes("No open Agent Loop builds yet"));

r = run({ active: false }, null, { issuesHttpFail: true });
await tick();
assert("issue discovery failure stays local to the launcher", r.el("buildStatus")._html.includes("Starting a new build is still available") &&
  r.el("panel")._html.includes('id="startBtn"'));

r = run({ active: false }, null, {
  issuesPayload,
  statePayload: { ...base, stage: "research", gate: null, status: "working" },
});
await tick();
assert("late issue discovery cannot repaint an active job", !r.el("panel")._html.includes("Existing builds") &&
  r.el("panel")._html.includes("spinner"));

// Pending lock (a child still working while a gate is nominally open): the
// stepper is withheld entirely — no way to submit until the child returns.
out = run({ ...base, stage: "planning", gate: "questionnaire", status: "waiting",
  pending: { opId: "iss7/planning/t4", kind: "planning" },
  questionnaire: { commentId: 10, questions: [{ id: "q1", select: "text", prompt: "Q?", choices: [] }] } }).html;
assert("pending withholds the submit button", !/id="answersBtn"/.test(out) && !/id="qNextBtn"/.test(out));

// Done terminal (full pipeline wording + PR link)
out = run({ ...base, stage: "done", gate: null, status: "done", approved: "a",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } }).html;
assert("done shows finalized PR", out.includes("http://x/pull/42"));
assert("done uses full-pipeline wording", out.includes("finalize") && !out.includes("vertical slice"));
assert("done offers Open PR to merge", out.includes("Open PR to merge"));
// Done reuses the head-pinned PR snapshot so the final diff/CI is visible pre-merge.
let d = run({ ...base, stage: "done", gate: null, status: "done", approved: "a",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } }, null,
  { prSnapshot: { available: true, reviewable: true, checks: { state: "passed" }, changedFiles: 1,
    files: [{ path: "final.js", status: "modified", additions: 2, deletions: 0, patch: "@@ -1 +1 @@\n+done", noPatch: false }] } });
await tick();
assert("done renders the finalized diff", d.el("prReview")._html.includes("final.js") && /diff-add/.test(d.el("prReview")._html));

// Working (implement stage spinner still renders)
out = run({ ...base, stage: "implementing", gate: null, status: "working", statusText: "Building…" }).html;
assert("implement working renders spinner", out.includes("spinner"));

// Sign-off gate: a prototypeComments option carrying only a work-dir `path`
// (no baked previewUrl) must still render a live preview iframe whose src
// resolves directly to the current origin's /work/<path> (regression guard for
// stale extension ports and the prototypeComments-branch mapper).
out = run({ ...base, stage: "prototype", gate: "signoff", status: "waiting",
  prototypeComments: [{ round: 1, commentId: 5, options: [
    { id: "variant-1", title: "Compact defaults", pitch: "zero-config", previewUrl: null,
      repoPath: "o/r/4/round-1/a/index.html", path: "o/r/4/round-1/a/index.html" },
  ] }] }).html;
assert("signoff renders preview iframe from option path",
  out.includes("preview-frame") && out.includes("http://localhost:9999/work/o/r/4/round-1/a/index.html"));
assert("signoff shows no 'Preview unavailable' when path is present", !out.includes("Preview unavailable"));

// Connectivity banner: a read-model error surfaces a non-blocking banner and
// preserves the last GOOD state (no phantom regression to Research), then clears
// once a healthy state returns.
r = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } });
assert("pre-outage feedback gate renders", r.el("panel")._html.includes('id="shipBtn"'));
// Now an outage arrives as a synthetic research fallback with error set.
r.render({ ...base, stage: "research", gate: null, status: "working",
  statusText: "Reading issue state…", error: "gh: HTTP 503" });
assert("outage shows connectivity banner", r.el("connbar").hidden === false && /reach GitHub/.test(r.el("connbar")._html));
assert("outage banner claims last-known state", /last known state/.test(r.el("connbar")._html));
assert("outage preserves last good panel (no regress to research)", r.el("panel")._html.includes('id="shipBtn"'));
r.render({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } });
assert("recovery hides connectivity banner", r.el("connbar").hidden === true);

// Cold-start outage (no prior good state): banner must NOT claim last-known.
r = run({ ...base, stage: "research", gate: null, status: "working",
  statusText: "Reading issue state…", error: "gh: HTTP 503" });
assert("cold outage shows banner", r.el("connbar").hidden === false);
assert("cold outage banner omits last-known claim", !/last known state/.test(r.el("connbar")._html));

// Job switch mid-outage: a good state for issue 7, then an errored poll for a
// DIFFERENT issue must NOT show issue 7's panel (or claim last-known).
r = run({ ...base, issue: 7, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } });
r.render({ ...base, issue: 9, stage: "research", gate: null, status: "working",
  statusText: "Reading issue state…", error: "gh: HTTP 503" });
assert("job switch mid-outage does not reuse the other issue's panel", !r.el("panel")._html.includes('id="shipBtn"'));
assert("job switch mid-outage banner omits last-known claim", !/last known state/.test(r.el("connbar")._html));

// --- Blocker-fix coverage (Sol Phase-3 review) -------------------------------

// (1) A failed /intent POST must NOT report success and must re-enable buttons.
r = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } }, null,
  { failPost: true, prSnapshot: { available: true, reviewable: true, owner: "o", repo: "r", issue: 7, prNumber: 42, checks: { state: "passed" }, changedFiles: 1,
    files: [{ path: "a.js", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+x", noPatch: false }] } });
const shipBtn = r.el("shipBtn");
await tick();
await shipBtn.onclick();
assert("failed ship POST re-enables the ship button", shipBtn.disabled === false);
assert("failed ship POST re-enables the revise button", r.el("reviseBtn").disabled === false);

// (2) Sign-off (prototype) gate honors pending like the other gates.
out = run({ ...base, stage: "prototype", gate: "signoff", status: "waiting",
  pending: { opId: "iss7/prototype/r2", kind: "prototype" },
  prototypeComments: [{ round: 2, commentId: 20, options: [{ id: "a", title: "A", pitch: "p", path: "x/a/index.html" }] }] }).html;
assert("signoff gate disables approve when pending", /id="approveBtn"[^>]*disabled/.test(out));
assert("signoff gate disables refine when pending", /id="refineBtn"[^>]*disabled/.test(out));

// (3) SHIP/REVISE structured intent carries prNumber for machine-readable PR correlation.
r = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } }, null,
  { prSnapshot: { available: true, reviewable: true, owner: "o", repo: "r", issue: 7, prNumber: 42, checks: { state: "passed" }, changedFiles: 1,
    files: [{ path: "a.js", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+x", noPatch: false }] } });
await tick();
await r.el("shipBtn").onclick();
const shipCtx = r.posts.find((p) => p.url === "/intent");
assert("ship intent carries prNumber", !!shipCtx && shipCtx.body.data.prNumber === 42);

// (4) Kickoff nonce is retired once an active state is observed, so a later
//     unrelated kickoff gets a FRESH reqId (can't adopt the prior issue).
r = run({ active: false });
r.el("idea").value = "First idea";
await r.el("startBtn").onclick();
const req1 = r.posts.find((p) => p.url === "/intent").body.data.reqId;
r.render({ ...base, stage: "research", gate: null, status: "working" }); // active observed → nonce cleared
r.render({ active: false }); // back to idle for a brand-new idea
r.el("idea").value = "Second, unrelated idea";
await r.el("startBtn").onclick();
const posts2 = r.posts.filter((p) => p.url === "/intent");
const req2 = posts2[posts2.length - 1].body.data.reqId;
assert("kickoff nonce cleared after active — fresh reqId for a new idea", !!req1 && !!req2 && req1 !== req2);

// --- mdLite block rendering (plan/build/research readability) -----------------
const md = run(base).mdLite;
// Ordered lists must render as <ol>, not paragraphs.
const ol = md("1. First step\n2. Second step");
assert("mdLite renders ordered list", /<ol><li>First step<\/li><li>Second step<\/li><\/ol>/.test(ol));
// Unordered lists still work and don't merge with ordered.
assert("mdLite renders unordered list", /<ul><li>a<\/li><\/ul>/.test(md("- a")));
// Fenced code is escaped and NOT run through the inline transforms.
const code = md("```\n<b>**x**</b> `y`\n```");
assert("mdLite fences code in pre/code", /<pre><code>[\s\S]*<\/code><\/pre>/.test(code));
assert("mdLite escapes html inside fences", code.includes("&lt;b&gt;") && !code.includes("<b>"));
assert("mdLite does not bold inside fences", code.includes("**x**") && !/<strong>/.test(code));
assert("mdLite does not code-span inside fences", !/<code>y<\/code>/.test(code));
// Inline transforms still apply outside fences.
assert("mdLite bolds outside fences", /<strong>hi<\/strong>/.test(md("**hi**")));
// An unclosed fence is flushed deterministically at EOF (no lost content).
assert("mdLite flushes unclosed fence", /<pre><code>orphan<\/code><\/pre>/.test(md("```\norphan")));
// Links are rewritten to data-ext (never a raw href) so they route through /open.
assert("mdLite link uses data-ext", /data-ext="https:\/\/github.com\/x"/.test(md("[t](https://github.com/x)")));

// --- Feedback PR review: fail-closed Ship + diff rendering -------------------

// (a) No PR linked → Ship starts disabled (fail-closed), Request-changes lives.
let f = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting", impl: null });
assert("feedback with no PR disables Ship", /id="shipBtn"[^>]*disabled/.test(f.el("panel")._html));
assert("feedback with no PR keeps Request-changes", f.el("panel")._html.includes('id="reviseBtn"') &&
  !/id="reviseBtn"[^>]*disabled/.test(f.el("panel")._html));

// (b) Head moved since review → snapshot loads, Ship is force-disabled.
f = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42", headSha: "OLD" } }, null,
  { prSnapshot: { available: true, reviewable: false, headMovedFromReview: true, checks: { state: "passed" }, files: [] } });
await tick();
assert("feedback disables Ship when reviewed head moved", f.el("shipBtn").disabled === true);
assert("feedback shows head-moved warning", /moved since you last reviewed/.test(f.el("prReview")._html));
await f.el("shipBtn").onclick();
assert("disabled Ship does not POST", !f.posts.some((p) => p.url === "/intent"));

// (c) Reviewable snapshot → files + CI render; Ship stays enabled and posts.
f = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42", headSha: "SHA1" } }, null,
  { prSnapshot: { available: true, reviewable: true, owner: "o", repo: "r", issue: 7, prNumber: 42, checks: { state: "passed" }, changedFiles: 1,
    additions: 3, deletions: 1, files: [{ path: "a.js", status: "modified", additions: 3, deletions: 1,
      patch: "@@ -1 +1 @@\n-old\n+new", noPatch: false }] } });
await tick();
assert("feedback renders changed file", f.el("prReview")._html.includes("a.js"));
assert("feedback renders diff add/del lines", /diff-add/.test(f.el("prReview")._html) && /diff-del/.test(f.el("prReview")._html));
assert("feedback shows passing CI badge", /Checks passing/.test(f.el("prReview")._html));
assert("reviewable Ship stays enabled", f.el("shipBtn").disabled === false);
await f.el("shipBtn").onclick();
assert("reviewable Ship POSTs ship", f.posts.some((p) => p.url === "/intent" && p.body.kind === "ship"));

// (d) noPatch file renders as binary/unavailable, never as an empty diff.
f = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } }, null,
  { prSnapshot: { available: true, reviewable: true, checks: { state: "none" },
    files: [{ path: "logo.png", status: "added", additions: 0, deletions: 0, patch: null, noPatch: true }] } });
await tick();
assert("noPatch file labeled binary/unavailable", /No inline diff/.test(f.el("prReview")._html));

// (d3) Identity mismatch: a snapshot for a DIFFERENT owner/repo/issue must be
// ignored — Ship never enables and the foreign diff is never painted, even if the
// snapshot claims reviewable (guards a cross-instance active-pointer swap).
f = run({ ...base, owner: "o", repo: "r", issue: 7, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } }, null,
  { prSnapshot: { available: true, reviewable: true, owner: "EVIL", repo: "r", issue: 7, prNumber: 42,
    checks: { state: "passed" }, files: [{ path: "secret.js", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+leak", noPatch: false }] } });
await tick();
assert("foreign-identity snapshot keeps Ship disabled", f.el("shipBtn").disabled === true);
assert("foreign-identity snapshot is not painted", !f.el("prReview")._html.includes("secret.js"));

// (d4) Fail-closed identity: an available/reviewable snapshot MISSING identity
// fields (owner/repo/issue) must NOT enable Ship, even though prNumber matches.
f = run({ ...base, owner: "o", repo: "r", issue: 7, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } }, null,
  { prSnapshot: { available: true, reviewable: true, prNumber: 42,
    checks: { state: "passed" }, files: [{ path: "a.js", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+x", noPatch: false }] } });
await tick();
assert("snapshot missing identity keeps Ship disabled (fail-closed)", f.el("shipBtn").disabled === true);
await f.el("shipBtn").onclick();
assert("snapshot missing identity does not POST ship", !f.posts.some((p) => p.url === "/intent"));

// (e) available:false snapshot is fail-closed: Ship never enables, and a click is a no-op.
f = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } }, null,
  { prSnapshot: { available: false, reason: "error" } });
await tick();
assert("available:false keeps Ship disabled", f.el("shipBtn").disabled === true);
await f.el("shipBtn").onclick();
assert("available:false Ship does not POST", !f.posts.some((p) => p.url === "/intent"));

// (f) A /pr HTTP failure must leave Ship disabled (fail-closed on read error).
f = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } }, null, { prHttpFail: true });
await tick();
assert("pr read failure keeps Ship disabled", f.el("shipBtn").disabled === true);
assert("pr read failure offers Retry", /id="prRetry"/.test(f.el("prReview")._html));

// (g) An UNPINNED build (reviewable:false + unpinned) blocks Ship and explains why.
f = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } }, null,
  { prSnapshot: { available: true, reviewable: false, unpinned: true, checks: { state: "passed" }, files: [] } });
await tick();
assert("unpinned build keeps Ship disabled", f.el("shipBtn").disabled === true);
assert("unpinned build explains the lock", /no pinned reviewed revision/.test(f.el("prReview")._html));

// (h) Ship is disabled WHILE the snapshot is loading (before /pr resolves), even
// though a PR is linked — the button can never be clicked ahead of evidence.
f = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42" } }, null,
  { prSnapshot: { available: true, reviewable: true, checks: { state: "passed" }, files: [] } });
assert("Ship starts disabled before /pr resolves", /id="shipBtn"[^>]*disabled/.test(f.el("panel")._html));

// --- Plan-review: fail-closed Approve until the plan actually loads ----------
// No plan artifact → Approve starts disabled with a hint; Request-changes lives.
let p = run({ ...base, stage: "planning-finalize", gate: "plan-review", status: "waiting", plan: null });
assert("plan-review with no plan disables Approve", /id="planOkBtn"[^>]*disabled/.test(p.el("panel")._html));
assert("plan-review with no plan hints why", /Approve unlocks once the plan/.test(p.el("panel")._html));
assert("plan-review with no plan keeps Request-changes enabled", p.el("planReviseBtn").disabled === false &&
  !/id="planReviseBtn"[^>]*disabled/.test(p.el("panel")._html));

// Plan present → Approve starts disabled, enables once the plan prose loads.
p = run({ ...base, stage: "planning-finalize", gate: "plan-review", status: "waiting",
  plan: { commentId: 11, approved: null } }, "## Plan\n1. do it");
assert("plan-review Approve disabled before plan loads", /id="planOkBtn"[^>]*disabled/.test(p.el("panel")._html));
await tick();
assert("plan-review Approve enables after plan loads", p.el("planOkBtn").disabled === false);
await p.el("planOkBtn").onclick();
assert("plan-review Approve POSTs plan-ok", p.posts.some((x) => x.url === "/intent" && x.body.kind === "plan-ok"));

// --- "Try it out" hands-on preview at the feedback gate ---------------------

// (i) kind:"web" + path → sandboxed demo iframe resolving to /work/<path> on the
//     current asset origin (ASSET_BASE is "" in tests → falls back to location.origin).
r = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42", branch: "agent-loop/issue-7",
    preview: { kind: "web", path: "o/r/7/impl-round-1/demo/", notes: "Interactive datepicker demo" } } });
out = r.el("panel")._html;
assert("tryit web renders demo iframe from /work path",
  /class="demo-frame"[^>]*src="http:\/\/localhost:9999\/work\/o\/r\/7\/impl-round-1\/demo\/"/.test(out));
assert("tryit web sandboxes the demo iframe", /class="demo-frame"[^>]*sandbox="allow-scripts"/.test(out));
assert("tryit web shows notes", out.includes("Interactive datepicker demo"));
assert("tryit web offers Open PR in a session", out.includes('id="reviewLocalBtn"'));
assert("tryit web shows the branch", out.includes("agent-loop/issue-7"));

// (j) kind:"command" + run[] → run-steps list, NO iframe.
out = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42", branch: "agent-loop/issue-7",
    preview: { kind: "command", run: ["npm ci", "npm start"], notes: "Serves on :3000" } } }).el("panel")._html;
assert("tryit command renders run steps", out.includes("Run it locally") && out.includes("npm ci") && out.includes("npm start"));
assert("tryit command renders no demo iframe", !/class="demo-frame"/.test(out));
assert("tryit command still offers Open PR in a session", out.includes('id="reviewLocalBtn"'));

// (k) kind:"none" (or absent preview) → branch + session button only, no iframe/steps.
out = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42", branch: "agent-loop/issue-7",
    preview: { kind: "none", notes: "CI + the diff cover it" } } }).el("panel")._html;
assert("tryit none renders no iframe or run steps", !/class="demo-frame"/.test(out) && !out.includes("Run it locally"));
assert("tryit none still offers Open PR in a session", out.includes('id="reviewLocalBtn"'));

// (l) Open-PR-in-a-session button POSTs a REVIEW-LOCAL prompt (read-only convenience).
r = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42", branch: "agent-loop/issue-7",
    preview: { kind: "web", path: "o/r/7/impl-round-1/demo/" } } });
await r.el("reviewLocalBtn").onclick();
const rlPost = r.posts.find((p) => p.url === "/intent" && p.body.kind === "review-local");
assert("review-local click POSTs kind review-local", !!rlPost);
assert("review-local intent carries the PR number", !!rlPost && rlPost.body.data.prNumber === 42);
assert("review-local intent is routed to the issue", !!rlPost && rlPost.body.owner === "o" && rlPost.body.repo === "r" && rlPost.body.issue === 7);
assert("review-local button stays repeatable after a successful click", r.el("reviewLocalBtn").disabled === false);

// (m) Branch falls back to the deterministic name when impl.branch is absent.
out = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42",
    preview: { kind: "none" } } }).el("panel")._html;
assert("tryit branch falls back to agent-loop/issue-<n>", out.includes("agent-loop/issue-7"));

// (n) A web descriptor MISSING its path renders an honest fallback, not an empty
//     block, and shows no overclaiming demo caption.
out = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42", branch: "agent-loop/issue-7",
    preview: { kind: "web", notes: "no path emitted" } } }).el("panel")._html;
assert("tryit web without path shows honest fallback", /demo is not available/.test(out) && !/class="demo-frame"/.test(out));
assert("tryit web without path shows no demoNote caption", !out.includes('id="demoNote"'));

// (o) Demo caption starts honest (round-N build) and flips to a staleness
//     warning purely from state when preview.headSha (the built commit) drifts
//     from the current reviewed impl.headSha — synchronous, no /pr needed. This
//     survives an orchestrator re-pin (SHIP head-adopt / Finalize moved head)
//     where headMovedFromReview would wrongly read false.
out = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42", branch: "agent-loop/issue-7", round: 3,
    headSha: "NEWPIN", preview: { kind: "web", path: "o/r/7/impl-round-3/demo/", headSha: "OLDBUILD" } } }).el("panel")._html;
assert("demo caption flags staleness when built head != reviewed pin", /reviewed revision has advanced/.test(out));
assert("stale demo caption names the round", out.includes("implement round 3"));

// (p) When preview.headSha matches the reviewed pin, the caption stays baseline.
out = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42", branch: "agent-loop/issue-7", round: 2,
    headSha: "SAME", preview: { kind: "web", path: "o/r/7/impl-round-2/demo/", headSha: "SAME" } } }).el("panel")._html;
assert("fresh demo keeps the baseline caption", /build from implement round 2/.test(out) && !/advanced since/.test(out));

// (p2) Head-moved PR snapshot still disables Ship (independent of the demo caption).
f = run({ ...base, stage: "implementing", gate: "feedback", status: "waiting",
  impl: { commentId: 12, prNumber: 42, prUrl: "http://x/pull/42", branch: "agent-loop/issue-7", round: 3, headSha: "OLD",
    preview: { kind: "web", path: "o/r/7/impl-round-3/demo/", headSha: "OLD" } } }, null,
  { prSnapshot: { available: true, reviewable: false, headMovedFromReview: true, owner: "o", repo: "r", issue: 7, prNumber: 42,
    checks: { state: "passed" }, files: [] } });
await tick();
assert("head-moved PR snapshot disables Ship", f.el("shipBtn").disabled === true);

console.log(process.exitCode ? "\nPANEL HARNESS: FAILURES" : "\nPANEL HARNESS: all panels OK");