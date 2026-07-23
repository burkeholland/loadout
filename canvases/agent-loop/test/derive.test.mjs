// Fixture tests for the Agent Loop backend read model (deriveState) and the
// github.mjs conversation parsers. Pure, no network — run: node derive.test.mjs
import assert from "node:assert";
import { deriveState } from "../server.mjs";
import {
  parseControlBlock, findControlBlock, parseQuestionnaire,
  findBuildReadyComment, findPrototypeComments, isDegradedError,
  normalizeAgentLoopIssues, STATE_SENTINEL,
} from "../github.mjs";
import { summarizeChecks, boundFiles, buildSnapshot } from "../pr.mjs";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  -", name); }
  catch (e) { console.error("FAIL  -", name, "\n   ", e.message); process.exitCode = 1; }
}

// Build a control-block comment body from a state object.
function ctlComment(id, state) {
  return { id, body: `${STATE_SENTINEL}\n<details>\n\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n</details>` };
}
const iss = { html_url: "https://github.com/o/r/issues/7", title: "Copy button", labels: [] };
function withLabels(...names) { return { ...iss, labels: names.map((name) => ({ name })) }; }

// ---- github.mjs parsers -------------------------------------------------

test("parseControlBlock extracts JSON body", () => {
  const c = ctlComment(1, { version: 2, txn: 3, stage: "prototype" });
  const d = parseControlBlock(c.body);
  assert.equal(d.txn, 3);
  assert.equal(d.stage, "prototype");
});

test("normalizeAgentLoopIssues keeps five newest open labeled issues", () => {
  const raw = [
    { number: 1, title: "Old", state: "open", updated_at: "2026-01-01", html_url: "u1", labels: [{ name: "agent-loop" }] },
    { number: 2, title: "Closed", state: "closed", updated_at: "2026-07-01", html_url: "u2", labels: [{ name: "agent-loop" }] },
    { number: 3, title: "PR", state: "open", updated_at: "2026-07-02", html_url: "u3", pull_request: {}, labels: [{ name: "agent-loop" }] },
    { number: 4, title: "Ordinary", state: "open", updated_at: "2026-07-03", html_url: "u4", labels: [] },
    ...Array.from({ length: 6 }, (_, i) => ({
      number: 10 + i, title: `Build ${i}`, state: "open", updated_at: `2026-07-${10 + i}`,
      html_url: `u${10 + i}`, labels: [{ name: "agent-loop" }, { name: i ? "stage:planning" : "gate:signoff" }],
    })),
  ];
  const out = normalizeAgentLoopIssues(raw, 5);
  assert.deepEqual(out.map((issue) => issue.number), [15, 14, 13, 12, 11]);
  assert.deepEqual(out[4].labels, ["agent-loop", "stage:planning"]);
  assert.equal(out[0].updatedAt, "2026-07-15");
});

test("parseControlBlock returns null on malformed JSON", () => {
  const bad = `${STATE_SENTINEL}\n\`\`\`json\n{ not valid json ]\n\`\`\``;
  assert.equal(parseControlBlock(bad), null);
});

test("findControlBlock ignores non-sentinel comments", () => {
  const comments = [{ id: 1, body: "just a normal comment" }, ctlComment(2, { txn: 1 })];
  assert.equal(findControlBlock(comments).commentId, 2);
});

test("parseQuestionnaire pulls stable q-ids", () => {
  const body = "## 📋 Questionnaire\n\n**q1.** How should errors surface?\n**q2.** Dark mode?";
  const qs = parseQuestionnaire(body);
  assert.deepEqual(qs.map((q) => q.id), ["q1", "q2"]);
  assert.equal(qs[0].prompt, "How should errors surface?");
  // No choices → free-text ("text") select type.
  assert.equal(qs[0].select, "text");
  assert.deepEqual(qs[0].choices, []);
});

test("parseQuestionnaire parses single/multi choices with select tags", () => {
  const body = [
    "## 📋 Questionnaire",
    "",
    "**q1.** (single) Which framework?",
    "- React",
    "- Vue",
    "",
    "**q2.** (multi) Which constraints must v1 support?",
    "- [ ] Min/max dates",
    "- [x] Disabled dates",
    "",
    "**q3.** Untagged with choices infers single",
    "- A",
    "- B",
  ].join("\n");
  const qs = parseQuestionnaire(body);
  assert.equal(qs.length, 3);
  assert.equal(qs[0].select, "single");
  assert.deepEqual(qs[0].choices, ["React", "Vue"]);
  assert.equal(qs[1].select, "multi");
  // Task-list markers `[ ]` / `[x]` are stripped from choice text.
  assert.deepEqual(qs[1].choices, ["Min/max dates", "Disabled dates"]);
  assert.equal(qs[2].select, "single");
  assert.deepEqual(qs[2].choices, ["A", "B"]);
});

test("parseQuestionnaire: a blank line before bullets does NOT capture them as choices", () => {
  // A free-text question followed by an unrelated bullet must stay free-text.
  const body = "**q1.** Any additional context?\n\n- A stray reminder bullet\n\n**q2.** Next?";
  const qs = parseQuestionnaire(body);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].select, "text");
  assert.deepEqual(qs[0].choices, []);
  assert.equal(qs[1].id, "q2");
});

test("parseQuestionnaire: duplicate q-ids collapse to the first, bullets do not leak", () => {
  const body = "**q1.** First?\n- A\n**q1.** Duplicate id?\n- B\n**q2.** Real second?";
  const qs = parseQuestionnaire(body);
  assert.deepEqual(qs.map((q) => q.id), ["q1", "q2"]);
  assert.equal(qs[0].prompt, "First?");
  assert.deepEqual(qs[0].choices, ["A"]); // "B" from the duplicate block must not attach
});

test("findBuildReadyComment extracts PR number + url", () => {
  const comments = [{ id: 9, body: "## 🚀 Build ready\nReady: [PR #42](https://github.com/o/r/pull/42)" }];
  const bc = findBuildReadyComment(comments);
  assert.equal(bc.prNumber, 42);
  assert.equal(bc.prUrl, "https://github.com/o/r/pull/42");
});

test("findPrototypeComments sorts newest round first", () => {
  const comments = [
    { id: 1, body: "## 🧪 Prototypes — round 1\n- **A:** first" },
    { id: 2, body: "## 🧪 Prototypes — round 2\n- **B:** second" },
  ];
  const pr = findPrototypeComments(comments);
  assert.equal(pr[0].round, 2);
  assert.equal(pr[1].round, 1);
});

// ---- deriveState: every pipeline state ----------------------------------

test("research working (control block)", () => {
  const comments = [ctlComment(1, { version: 2, txn: 1, stage: "research", gate: null, status: "working", statusText: "Researching…", pending: { opId: "iss7/research/t1", kind: "research" } })];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:research"), comments });
  assert.equal(s.stage, "research");
  assert.equal(s.gate, null);
  assert.equal(s.txn, 1);
  assert.deepEqual(s.pending, { opId: "iss7/research/t1", kind: "research" });
});

test("prototype signoff gate keeps stage + exposes rounds", () => {
  const comments = [
    { id: 5, body: "## 🧪 Prototypes — round 2\n- **A — Label:** pitch text" },
    ctlComment(1, { version: 2, txn: 4, stage: "prototype", gate: "signoff", round: 2, status: "waiting", artifacts: { prototypeRounds: [{ round: 2, commentId: 5, options: [{ id: "a" }] }] } }),
  ];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:prototype", "gate:signoff", "proto-round:2"), comments });
  assert.equal(s.stage, "prototype");
  assert.equal(s.gate, "signoff");
  assert.equal(s.round, 2);
  assert.equal(s.prototypeRounds.length, 1);
});

test("questionnaire gate exposes parsed questions", () => {
  const comments = [
    { id: 6, body: "## 📋 Questionnaire\n\n**q1.** A?\n**q2.** B?" },
    ctlComment(1, { version: 2, txn: 6, stage: "planning", gate: "questionnaire", status: "waiting" }),
  ];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:planning", "gate:questionnaire"), comments });
  assert.equal(s.gate, "questionnaire");
  assert.equal(s.questionnaire.questions.length, 2);
});

test("pointer-only questionnaire artifact is enriched with parsed questions", () => {
  // Control block holds ONLY a pointer (commentId), per the pointers-not-prose
  // model; deriveState must parse questions from THAT exact comment — not the
  // newest one — and preserve the authoritative pointer commentId.
  const comments = [
    { id: 6, body: "## 📋 Questionnaire\n\n**q1.** A?\n**q2.** B?\n**q3.** C?" },
    { id: 20, body: "## 📋 Questionnaire\n\n**q1.** Newer conflicting?" },
    ctlComment(1, { version: 2, txn: 6, stage: "planning", gate: "questionnaire", status: "waiting", artifacts: { questionnaire: { commentId: 6 } } }),
  ];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:planning", "gate:questionnaire"), comments });
  assert.equal(s.questionnaire.commentId, 6);
  assert.equal(s.questionnaire.questions.length, 3);
});

test("pointer-only impl artifact resolves the pointed PR, not a newer re-post", () => {
  const comments = [
    { id: 9, body: "## 🚀 Build ready\n\nPR: [#42](https://github.com/o/r/pull/42) on branch agent-loop/issue-7." },
    { id: 30, body: "## 🚀 Build ready\n\nPR: [#99](https://github.com/o/r/pull/99) newer re-post." },
    ctlComment(1, { version: 2, txn: 10, stage: "implementing", gate: "feedback", implRound: 1, status: "waiting", artifacts: { impl: { commentId: 9, branch: "agent-loop/issue-7" } } }),
  ];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:implementing", "gate:feedback", "impl-round:1"), comments });
  assert.equal(s.impl.commentId, 9);
  assert.equal(s.impl.prNumber, 42);
  assert.equal(s.impl.prUrl, "https://github.com/o/r/pull/42");
  assert.equal(s.impl.branch, "agent-loop/issue-7");
});

test("missing questionnaire pointer returns no questions (never attaches foreign content)", () => {
  // Pointer references a comment that isn't in the list; deriveState must NOT
  // fall back to the newer questionnaire comment and stamp the stale id onto it.
  const comments = [
    { id: 20, body: "## 📋 Questionnaire\n\n**q1.** Newer unrelated?" },
    ctlComment(1, { version: 2, txn: 6, stage: "planning", gate: "questionnaire", status: "waiting", artifacts: { questionnaire: { commentId: 999 } } }),
  ];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:planning", "gate:questionnaire"), comments });
  assert.equal(s.questionnaire.commentId, 999);
  assert.ok(!s.questionnaire.questions || s.questionnaire.questions.length === 0);
});

test("plan-review gate falls back to planning stage from gate label alone", () => {
  const comments = [
    { id: 7, body: "## 🗺 Plan\nThe plan." },
    { id: 8, body: "not a control block" },
  ];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "gate:plan-review"), comments });
  assert.equal(s.stage, "planning");
  assert.equal(s.gate, "plan-review");
  assert.equal(s.plan.commentId, 7);
});

test("feedback gate exposes impl PR from control block", () => {
  const comments = [ctlComment(1, { version: 2, txn: 10, stage: "implementing", gate: "feedback", implRound: 1, status: "waiting", artifacts: { impl: { prNumber: 42, prUrl: "https://github.com/o/r/pull/42", branch: "agent-loop/issue-7", sessionId: "abc", round: 1 } } })];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:implementing", "gate:feedback", "impl-round:1"), comments });
  assert.equal(s.gate, "feedback");
  assert.equal(s.implRound, 1);
  assert.equal(s.impl.prNumber, 42);
});

test("impl.preview descriptor survives deriveState passthrough (Try-it-out)", () => {
  const preview = { kind: "web", path: "o/r/7/impl-round-2/demo/", headSha: "BUILTSHA", notes: "Live datepicker" };
  const comments = [ctlComment(1, { version: 2, txn: 12, stage: "implementing", gate: "feedback", implRound: 2, status: "waiting", artifacts: { impl: { prNumber: 42, prUrl: "https://github.com/o/r/pull/42", branch: "agent-loop/issue-7", round: 2, preview } } })];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:implementing", "gate:feedback", "impl-round:2"), comments });
  assert.equal(s.impl.branch, "agent-loop/issue-7");
  assert.ok(s.impl.preview, "preview descriptor present");
  assert.equal(s.impl.preview.kind, "web");
  assert.equal(s.impl.preview.path, "o/r/7/impl-round-2/demo/");
  assert.equal(s.impl.preview.headSha, "BUILTSHA");
  assert.equal(s.impl.preview.notes, "Live datepicker");
});

test("done terminal state", () => {
  const comments = [ctlComment(1, { version: 2, txn: 14, stage: "done", gate: null, status: "done", artifacts: { finalized: { commentId: 20 } } })];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:done"), comments });
  assert.equal(s.stage, "done");
  assert.equal(s.status, "done");
  assert.equal(s.finalized.commentId, 20);
});

// ---- deriveState: edge cases --------------------------------------------

test("missing control block falls back to labels (fail-soft display)", () => {
  const comments = [{ id: 1, body: "## 🔎 Research\nbrief" }];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:research"), comments });
  assert.equal(s.stage, "research");
  assert.equal(s.controlCommentId, null);
  assert.equal(s.research.commentId, 1);
});

test("malformed control block JSON degrades to label-derived state", () => {
  const comments = [{ id: 1, body: `${STATE_SENTINEL}\n\`\`\`json\n{ broken ]\n\`\`\`` }];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:prototype", "gate:signoff", "proto-round:3"), comments });
  assert.equal(s.stage, "prototype");
  assert.equal(s.gate, "signoff");
  assert.equal(s.round, 3);
});

test("legacy round: label still parsed", () => {
  const comments = [{ id: 1, body: "not a control block" }];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:prototype", "round:5"), comments });
  assert.equal(s.round, 5);
});

test("missing PR: feedback stage without build-ready comment yields null impl", () => {
  const comments = [ctlComment(1, { version: 2, txn: 8, stage: "implementing", gate: null, status: "working" })];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:implementing"), comments });
  assert.equal(s.impl, null);
  assert.equal(s.stage, "implementing");
});

test("control block wins over conflicting labels", () => {
  const comments = [ctlComment(1, { version: 2, txn: 9, stage: "planning-finalize", gate: null, status: "working" })];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:prototype", "gate:signoff"), comments });
  assert.equal(s.stage, "planning-finalize");
  assert.equal(s.gate, null);
});

// ---- deriveState / parser: round-2 hardening ----------------------------

test("numbered-list questionnaire (1. **q1.** …) parses", () => {
  const body = "## 📋 Questionnaire\n\n1. **q1.** First?\n2. **q2.** Second?\n3. **q3.** Third?";
  const qs = parseQuestionnaire(body);
  assert.deepEqual(qs.map((q) => q.id), ["q1", "q2", "q3"]);
  assert.equal(qs[2].prompt, "Third?");
});

test("quoted / non-leading sentinel is NOT treated as control block", () => {
  // A prose comment that quotes the sentinel mid-body plus a JSON fence.
  const prose = "Here's what the state comment looks like:\n\n" +
    `${STATE_SENTINEL}\n\`\`\`json\n{ "txn": 999, "stage": "done" }\n\`\`\``;
  const comments = [{ id: 1, body: prose }, ctlComment(2, { version: 2, txn: 2, stage: "research", gate: null, status: "working" })];
  const cb = findControlBlock(comments);
  assert.equal(cb.commentId, 2, "should pick the real first-line-sentinel comment, not the prose");
  assert.equal(cb.data.txn, 2);
  assert.equal(parseControlBlock(prose), null);
});

test("label-only stage:done shows terminal status, not a spinner", () => {
  const comments = [{ id: 1, body: "just prose, no control block" }];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:done"), comments });
  assert.equal(s.stage, "done");
  assert.equal(s.status, "done");
});

test("authoritative implRound:0 is not overridden by a stale label", () => {
  const comments = [ctlComment(1, { version: 2, txn: 3, stage: "planning", gate: null, status: "working", implRound: 0 })];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:planning", "impl-round:2"), comments });
  assert.equal(s.implRound, 0);
});

test("multiple plan revisions: newest plan comment wins in fallback", () => {
  const comments = [
    { id: 10, body: "## 🗺 Plan\nFirst draft plan." },
    { id: 11, body: "## 🗺 Plan\nRevised plan after feedback." },
    { id: 12, body: "not a control block" },
  ];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "gate:plan-review"), comments });
  assert.equal(s.plan.commentId, 11, "should surface the latest plan, not the obsolete first draft");
});

test("multiple build-ready posts: newest PR wins in fallback", () => {
  const comments = [
    { id: 20, body: "## 🚀 Build ready\n[PR #40](https://github.com/o/r/pull/40)" },
    { id: 21, body: "## 🚀 Build ready\n[PR #40](https://github.com/o/r/pull/40) — revised" },
  ];
  const s = deriveState({ owner: "o", repo: "r", issue: 7, iss: withLabels("agent-loop", "stage:implementing", "gate:feedback"), comments });
  assert.equal(s.impl.commentId, 21);
  assert.equal(s.impl.prNumber, 40);
});

test("isDegradedError: 5xx / HTML / network errors trigger the fallback", () => {
  assert.ok(isDegradedError(new Error("gh: HTTP 503")));
  assert.ok(isDegradedError(new Error("Failed to parse gh output: Unexpected token '<'")));
  assert.ok(isDegradedError(new Error("invalid character '<' looking for beginning of value")));
  assert.ok(isDegradedError(new Error("<!DOCTYPE html>")));
  assert.ok(isDegradedError(new Error("request to https://api.github.com timed out")));
  assert.ok(isDegradedError(new Error("read ECONNRESET")));
});

test("isDegradedError: auth / permission / not-found do NOT trigger the fallback", () => {
  assert.ok(!isDegradedError(new Error("gh: HTTP 404 Not Found")));
  assert.ok(!isDegradedError(new Error("gh: HTTP 403 Forbidden")));
  assert.ok(!isDegradedError(new Error("gh: HTTP 401 Bad credentials")));
  assert.ok(!isDegradedError(new Error("Could not resolve to an Issue")));
  assert.ok(!isDegradedError(null));
});

// --- PR review snapshot (feedback gate evidence) -----------------------------

test("summarizeChecks: unknown vs none are distinct (read-fail must not look green)", () => {
  assert.equal(summarizeChecks(null).state, "unknown");
  assert.equal(summarizeChecks(undefined).state, "unknown");
  assert.equal(summarizeChecks([]).state, "none");
});

test("summarizeChecks: any failure dominates pending and success", () => {
  const roll = [
    { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
    { __typename: "CheckRun", status: "IN_PROGRESS" },
    { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
  ];
  const r = summarizeChecks(roll);
  assert.equal(r.state, "failed");
  assert.equal(r.counts.fail, 1);
  assert.equal(r.counts.pending, 1);
  assert.equal(r.counts.pass, 1);
});

test("summarizeChecks: pending beats success when nothing failed", () => {
  assert.equal(summarizeChecks([
    { status: "COMPLETED", conclusion: "SUCCESS" },
    { status: "QUEUED" },
  ]).state, "pending");
});

test("summarizeChecks: StatusContext state field is classified", () => {
  assert.equal(summarizeChecks([{ state: "SUCCESS" }, { state: "SUCCESS" }]).state, "passed");
  assert.equal(summarizeChecks([{ state: "PENDING" }]).state, "pending");
  assert.equal(summarizeChecks([{ state: "ERROR" }]).state, "failed");
});

test("boundFiles: caps file count and flags truncation", () => {
  const files = Array.from({ length: 80 }, (_, i) => ({ filename: "f" + i + ".js", patch: "x", additions: 1, deletions: 0 }));
  const b = boundFiles(files, { maxFiles: 10 });
  assert.equal(b.files.length, 10);
  assert.equal(b.shownFiles, 10);
  assert.ok(b.truncatedFiles);
});

test("boundFiles: over-long patch is sliced and flagged; missing patch is noPatch", () => {
  const b = boundFiles([
    { filename: "big.js", patch: "a".repeat(50), additions: 9, deletions: 0 },
    { filename: "logo.png", additions: 0, deletions: 0 }, // binary → no patch field
  ], { maxPatchBytes: 10 });
  assert.equal(b.files[0].patch.length, 10);
  assert.ok(b.files[0].patchTruncated);
  assert.equal(b.files[0].noPatch, false);
  assert.equal(b.files[1].noPatch, true, "a missing patch must be noPatch, not empty diff");
  assert.equal(b.files[1].patch, null);
});

test("boundFiles: total byte budget caps cumulative patch bytes", () => {
  const files = Array.from({ length: 5 }, (_, i) => ({ filename: "f" + i, patch: "z".repeat(100) }));
  const b = boundFiles(files, { maxTotalBytes: 150, maxPatchBytes: 100 });
  const withPatch = b.files.filter((f) => f.patch != null);
  assert.ok(withPatch.length < 5, "some files should have their patch dropped by the total budget");
  assert.ok(b.files.some((f) => f.patchTruncated));
});

test("buildSnapshot: head moved since review blocks Ship (reviewable=false)", () => {
  const snap = buildSnapshot({
    metaA: { number: 11, url: "u", headRefOid: "newsha", additions: 3, deletions: 1, changedFiles: 2, statusCheckRollup: [] },
    metaB: { headRefOid: "newsha" },
    files: [{ filename: "a.js", patch: "+x", additions: 3, deletions: 1 }],
    reviewedHead: "OLDSHA",
  });
  assert.equal(snap.headMovedFromReview, true);
  assert.equal(snap.reviewable, false);
});

test("buildSnapshot: head that moves mid-read is marked stale + not reviewable", () => {
  const snap = buildSnapshot({
    metaA: { number: 11, url: "u", headRefOid: "sha1", statusCheckRollup: [] },
    metaB: { headRefOid: "sha2" },
    files: [],
    reviewedHead: "sha1",
  });
  assert.equal(snap.stale, true);
  assert.equal(snap.reviewable, false);
});

test("buildSnapshot: matching reviewed head is reviewable", () => {
  const snap = buildSnapshot({
    metaA: { number: 11, url: "u", state: "OPEN", headRefOid: "sha1", statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }] },
    metaB: { headRefOid: "sha1", state: "OPEN" },
    files: [{ filename: "a.js", patch: "+x" }],
    reviewedHead: "sha1",
  });
  assert.equal(snap.reviewable, true);
  assert.equal(snap.checks.state, "passed");
});

test("buildSnapshot: a missing reviewedHead is NOT reviewable (unpinned)", () => {
  const snap = buildSnapshot({
    metaA: { number: 11, url: "u", state: "OPEN", headRefOid: "sha1", statusCheckRollup: [] },
    metaB: { headRefOid: "sha1", state: "OPEN" },
    files: [{ filename: "a.js", patch: "+x" }],
    reviewedHead: null,
  });
  assert.equal(snap.reviewable, false);
  assert.equal(snap.unpinned, true);
  assert.equal(snap.headMovedFromReview, false); // nothing "moved" — it was never pinned
});

test("buildSnapshot: a closed/merged PR is not reviewable even when head matches", () => {
  const snap = buildSnapshot({
    metaA: { number: 11, url: "u", state: "MERGED", headRefOid: "sha1", statusCheckRollup: [] },
    metaB: { headRefOid: "sha1", state: "MERGED" },
    files: [{ filename: "a.js", patch: "+x" }],
    reviewedHead: "sha1",
  });
  assert.equal(snap.reviewable, false);
});

test("buildSnapshot: a missing second head read is NOT reviewable (re-read required)", () => {
  const snap = buildSnapshot({
    metaA: { number: 11, url: "u", state: "OPEN", headRefOid: "sha1", statusCheckRollup: [] },
    metaB: { state: "OPEN" }, // second read returned no headRefOid
    files: [{ filename: "a.js", patch: "+x" }],
    reviewedHead: "sha1",
  });
  assert.equal(snap.reviewable, false);
});

test("summarizeChecks: an unrecognized check is fail-closed to unknown, never passed", () => {
  // one clean pass + one COMPLETED-but-garbage conclusion must NOT read green.
  assert.equal(summarizeChecks([
    { status: "COMPLETED", conclusion: "SUCCESS" },
    { status: "COMPLETED", conclusion: "MYSTERY" },
  ]).state, "unknown");
  // only-unknown must be "unknown", not the all-clear "none".
  assert.equal(summarizeChecks([{ status: "COMPLETED", conclusion: "WAT" }]).state, "unknown");
  // COMPLETED with no conclusion at all is unrecognized too → unknown.
  assert.equal(summarizeChecks([{ status: "COMPLETED" }]).state, "unknown");
  // a real failure still dominates an unknown.
  assert.equal(summarizeChecks([
    { status: "COMPLETED", conclusion: "MYSTERY" },
    { status: "COMPLETED", conclusion: "FAILURE" },
  ]).state, "failed");
});

console.log(`\n${passed} assertions passed`);