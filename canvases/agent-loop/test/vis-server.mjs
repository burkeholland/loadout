// Visual harness: serves the real webview HTML + a mock /state chosen by the
// ?gate= query, so each new gate panel can be screenshotted in light + dark.
import http from "node:http";
import { renderHtml } from "../webview.mjs";

const HTML = renderHtml();

const base = { active: true, owner: "burkeholland", repo: "agent-loop-demo", issue: 7,
  issueUrl: "https://github.com/burkeholland/agent-loop-demo/issues/7",
  title: "A reusable copy-to-clipboard button", txn: 3, pending: null, round: 2, implRound: 1,
  prototypeRounds: [], prototypeComments: [] };

const STATES = {
  questionnaire: { ...base, stage: "planning", gate: "questionnaire", status: "waiting",
    statusText: "Waiting for your answers.",
    questionnaire: { commentId: 101, questions: [
      { id: "q1", prompt: "Should the button appear on hover only, or always be visible?" },
      { id: "q2", prompt: "Do we need a dark-theme variant out of the box?" },
      { id: "q3", prompt: "What confirmation feels right — inline label swap, toast, or both?" },
    ] } },
  plan: { ...base, stage: "planning-finalize", gate: "plan-review", status: "waiting",
    statusText: "Waiting for your plan approval.", plan: { commentId: 102, approved: null } },
  feedback: { ...base, stage: "implementing", gate: "feedback", status: "waiting",
    statusText: "Waiting for your review.",
    impl: { commentId: 103, prNumber: 42, prUrl: "https://github.com/burkeholland/agent-loop-demo/pull/42" } },
  done: { ...base, stage: "done", gate: null, status: "done", approved: "a",
    statusText: "The build is finalized and ready to merge.",
    impl: { commentId: 103, prNumber: 42, prUrl: "https://github.com/burkeholland/agent-loop-demo/pull/42" } },
  outage: { ...base, stage: "research", gate: null, status: "working", round: 1, implRound: 0,
    txn: null, pending: null, statusText: "Reading issue state\u2026",
    error: "gh: HTTP 503 (https://api.github.com/...)" },
};

const PLAN_MD = "## 🗺 Plan\n\n**Approach:** Ship a zero-dependency vanilla enhancer packaged as an optional web component.\n\n" +
  "- **Step 1** — Scan `pre > code`, inject a real `<button type=\"button\">` positioned top-right.\n" +
  "- **Step 2** — Copy via `navigator.clipboard.writeText` with a hidden-textarea `execCommand` fallback.\n" +
  "- **Step 3** — Confirm with an `aria-live=\"polite\"` region + label swap, revert after ~2s.\n" +
  "- **Step 4** — Respect `:focus-visible`, `:focus-within`, and `prefers-reduced-motion`.\n\n" +
  "**Risks:** insecure-context clipboard access; mitigated by the fallback path.";
const BUILD_MD = "## 🚀 Build ready\n\nOpened **PR #42** on branch `agent-loop/issue-7`.\n\n" +
  "- Added `copy-button.js` (2.1KB, no deps) and a docs demo page.\n- 6 unit tests for the fallback chain, all green.\n- Verified keyboard + screen-reader flows.";

let cur = "questionnaire";
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/") {
    const g = u.searchParams.get("gate");
    if (g && STATES[g]) cur = g;
    res.writeHead(200, { "Content-Type": "text/html" }); res.end(HTML); return;
  }
  if (u.pathname === "/state") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(STATES[cur])); return; }
  if (u.pathname.startsWith("/comment/")) {
    const id = u.pathname.split("/").pop();
    const body = id === "102" ? PLAN_MD : id === "103" ? BUILD_MD : "## Notes\nSome content.";
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ body })); return;
  }
  if (u.pathname === "/events") { res.writeHead(200, { "Content-Type": "text/event-stream" }); return; }
  res.writeHead(404); res.end("{}");
});
server.listen(0, () => console.log("VISHARNESS " + server.address().port));
