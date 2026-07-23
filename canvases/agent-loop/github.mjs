// GitHub proxy for the Agent Loop canvas. Reads and deterministic workflow
// mutations go through `gh` using argv/stdin (never a shell), so this works
// safely on Windows and avoids command-line quoting/body-length issues.

import { execFile } from "node:child_process";

export const STATE_SENTINEL = "<!-- AGENT-LOOP-STATE v1 -->";

function ghOnce(args, { json = true, input = undefined, cwd = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile("gh", args, { cwd, timeout: 30000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.toString().trim() || err.message));
        return;
      }
      if (!json) {
        resolve(stdout.toString());
        return;
      }
      try {
        resolve(JSON.parse(stdout.toString() || "null"));
      } catch (e) {
        reject(new Error("Failed to parse gh output: " + e.message));
      }
    });
    if (input !== undefined) {
      child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
    }
  });
}

// Transient GitHub failures (5xx, secondary rate limits, abuse detection) are
// common and should not blank the canvas. Retry a few times with backoff; only
// give up on a persistent failure or a clearly non-transient error (4xx auth).
const TRANSIENT = /HTTP 5\d\d|was submitted too quickly|secondary rate limit|rate limit|abuse detection|timed out|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i;
async function gh(args, opts) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await ghOnce(args, opts);
    } catch (e) {
      lastErr = e;
      if (!TRANSIENT.test(String(e.message || e))) break;
      await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

export async function getIssue(owner, repo, issue) {
  return gh(["api", `repos/${owner}/${repo}/issues/${issue}`]);
}

function labelNames(issue) {
  return (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean);
}

export async function detectRepo(workingDirectory) {
  const r = await gh(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], { cwd: workingDirectory });
  const name = r && r.nameWithOwner;
  if (!name || !name.includes("/")) throw new Error("Unable to detect GitHub repository");
  const [owner, repo] = name.split("/");
  return { owner, repo, nameWithOwner: name, defaultBranch: r.defaultBranchRef?.name || "main" };
}

export function normalizeAgentLoopIssues(issues, limit = 5) {
  const max = Math.max(1, Math.min(20, Number(limit) || 5));
  return (issues || [])
    .filter((issue) => !issue.pull_request && String(issue.state || "").toLowerCase() === "open")
    .filter((issue) => labelNames(issue).includes("agent-loop"))
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
    .slice(0, max)
    .map((issue) => ({
      number: Number(issue.number),
      title: String(issue.title || `Issue #${issue.number}`),
      url: String(issue.html_url || ""),
      updatedAt: issue.updated_at || null,
      state: "open",
      labels: labelNames(issue),
    }));
}

export async function listAgentLoopIssues(owner, repo, { limit = 5 } = {}) {
  const max = Math.max(1, Math.min(20, Number(limit) || 5));
  const issues = await gh([
    "api",
    `repos/${owner}/${repo}/issues?state=open&labels=agent-loop&sort=updated&direction=desc&per_page=${max}`,
  ]);
  return normalizeAgentLoopIssues(issues, max);
}

export async function findIssueByReqId(owner, repo, reqId) {
  const marker = `AL-REQ ${String(reqId || "")}`;
  const issues = await gh(["api", "--paginate", `repos/${owner}/${repo}/issues?state=all&labels=agent-loop&per_page=100`]);
  return (issues || []).find((iss) => String(iss.body || "").includes(marker)) || null;
}

export async function ensureLabels(owner, repo, definitions) {
  for (const def of definitions || []) {
    const name = def && def.name;
    if (!name) continue;
    const body = {
      name,
      color: def.color || "ededed",
      description: def.description || "",
    };
    try {
      await gh(["api", `repos/${owner}/${repo}/labels`, "--method", "POST", "--input", "-"], { input: body });
    } catch (e) {
      if (!/already_exists|already exists|HTTP 422/i.test(String(e.message || e))) throw e;
    }
  }
}

export async function createIssue(owner, repo, { title, body, labels }) {
  return gh(["api", `repos/${owner}/${repo}/issues`, "--method", "POST", "--input", "-"], {
    input: { title, body, labels: labels || [] },
  });
}

export async function createComment(owner, repo, issue, body) {
  return gh(["api", `repos/${owner}/${repo}/issues/${issue}/comments`, "--method", "POST", "--input", "-"], {
    input: { body },
  });
}

export async function updateComment(owner, repo, commentId, body) {
  return gh(["api", `repos/${owner}/${repo}/issues/comments/${commentId}`, "--method", "PATCH", "--input", "-"], {
    input: { body },
  });
}

const WORKFLOW_LABEL = /^(agent-loop|stage:|gate:|proto-round:|impl-round:)/;

export async function reconcileWorkflowLabels(owner, repo, issue, desired) {
  const iss = await getIssue(owner, repo, issue);
  const current = labelNames(iss);
  const keep = current.filter((l) => !WORKFLOW_LABEL.test(l));
  const labels = Array.from(new Set([...keep, ...(desired || [])]));
  return gh(["api", `repos/${owner}/${repo}/issues/${issue}`, "--method", "PATCH", "--input", "-"], {
    input: { labels },
  });
}

export function findCommentByOpMarker(comments, marker, opId) {
  const escapedMarker = String(marker || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedOp = String(opId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<!--\\s*${escapedMarker}\\s+${escapedOp}(?:\\s+([\\s\\S]*?))?\\s*-->`);
  let found = null;
  for (const c of comments || []) {
    const body = String(c.body || "");
    for (const m of body.matchAll(new RegExp(re.source, "g"))) {
      let payload = null;
      if (m[1]) {
        const raw = m[1].trim();
        try {
          if (raw.startsWith("b64:")) {
            payload = JSON.parse(Buffer.from(raw.slice(4).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
          } else {
            payload = JSON.parse(raw);
          }
        } catch {}
      }
      found = { commentId: c.id, body: c.body, payload };
    }
  }
  return found;
}

export async function findPullForBranch(owner, repo, branch) {
  const pulls = await gh(["pr", "list", "--repo", `${owner}/${repo}`, "--state", "all", "--head", branch, "--json", "number,url,headRefName,headRefOid,baseRefName,state,isDraft"]);
  const open = (pulls || []).find((p) => String(p.state).toUpperCase() === "OPEN");
  return open || (pulls || [])[0] || null;
}

export async function getPullValidation(owner, repo, number) {
  return gh(["pr", "view", String(number), "--repo", `${owner}/${repo}`, "--json", "number,url,headRefName,headRefOid,baseRefName,state,isDraft,mergeStateStatus,statusCheckRollup"]);
}

export async function getRequiredCheckContexts(owner, repo, base) {
  try {
    const r = await gh(["api", `repos/${owner}/${repo}/branches/${base}/protection/required_status_checks/contexts`]);
    return { state: "present", contexts: Array.isArray(r) ? r : [] };
  } catch (e) {
    const msg = String(e.message || e);
    if (/HTTP 404|Upgrade to GitHub Pro|make this repository public|Branch not protected/i.test(msg)) {
      return { state: "absent", contexts: [] };
    }
    return { state: "unknown", contexts: [], error: msg };
  }
}

// --- Pull request reads (feedback-gate review evidence) ----------------------
// All PR reads are pure GitHub reads via the user's gh auth. `number` is always
// a server-validated positive integer, and execFile passes argv without a shell,
// so there is no injection surface here.
const PR_META_FIELDS =
  "number,url,headRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,reviewDecision,additions,deletions,changedFiles,state,statusCheckRollup";

export async function getPull(owner, repo, number) {
  return gh(["pr", "view", String(number), "--repo", `${owner}/${repo}`, "--json", PR_META_FIELDS]);
}

// A deliberately minimal re-read used to detect a head that moved WHILE we were
// assembling the snapshot (so the human never reviews a torn revision).
export async function getPullHead(owner, repo, number) {
  return gh(["pr", "view", String(number), "--repo", `${owner}/${repo}`, "--json", "headRefOid,state"]);
}

// First page of changed files WITH per-file patches. Capped at 100 (a single
// page) on purpose: the caller further bounds file/byte budgets and flags
// truncation, and a giant PR must never blow the gh output buffer.
export async function getPullFiles(owner, repo, number) {
  return gh(["api", `repos/${owner}/${repo}/pulls/${number}/files?per_page=100`]);
}

// Errors that indicate a degraded/unreachable read (not an auth or not-found
// failure). Only these should trigger the GraphQL fallback — a genuine
// 401/403/404 must surface, never be masked by an empty GraphQL result.
const DEGRADED = /HTTP 5\d\d|Failed to parse gh output|Unexpected token|invalid character|<!DOCTYPE|<html|timed out|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|socket hang up/i;
export function isDegradedError(err) {
  return DEGRADED.test(String((err && err.message) || err || ""));
}

export async function listComments(owner, repo, issue) {
  try {
    return await gh([
      "api",
      "--paginate",
      `repos/${owner}/${repo}/issues/${issue}/comments?per_page=100`,
    ]);
  } catch (e) {
    // The REST issue-comments endpoint can degrade (503 HTML pages) while the
    // GraphQL API stays healthy. Fall back ONLY for degradation errors; re-throw
    // auth/permission/not-found so they aren't masked. Parsers only read `.id`
    // and `.body`, so the reduced GraphQL shape is sufficient.
    if (!DEGRADED.test(String(e.message || e))) throw e;
    return await listCommentsGraphQL(owner, repo, issue);
  }
}

// GraphQL fallback for comment listing. Returns [{ id, body }] in chronological
// order, mirroring the REST shape the parsers depend on. Throws (rather than
// returning a false-empty result) when the repository/issue/comments connection
// is absent, so a null repo/issue can't be mistaken for "no comments".
export async function listCommentsGraphQL(owner, repo, issue) {
  const query =
    "query($owner:String!,$repo:String!,$num:Int!,$cursor:String){" +
    "repository(owner:$owner,name:$repo){issue(number:$num){" +
    "comments(first:100,after:$cursor){nodes{databaseId body} pageInfo{hasNextPage endCursor}}}}}";
  const out = [];
  let cursor = null;
  for (let i = 0; i < 25; i++) {
    const args = ["api", "graphql", "-f", "query=" + query,
      "-F", "owner=" + owner, "-F", "repo=" + repo, "-F", "num=" + issue];
    if (cursor) args.push("-F", "cursor=" + cursor);
    const r = await gh(args);
    const issueNode = r && r.data && r.data.repository && r.data.repository.issue;
    const conn = issueNode && issueNode.comments;
    if (!conn) {
      throw new Error(`GraphQL comment listing unavailable for ${owner}/${repo}#${issue}`);
    }
    for (const n of conn.nodes || []) out.push({ id: n.databaseId, body: n.body });
    if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

export async function getComment(owner, repo, commentId, issue) {
  try {
    return await gh(["api", `repos/${owner}/${repo}/issues/comments/${commentId}`]);
  } catch (e) {
    // REST single-comment reads share the same degradation; recover the body
    // from the GraphQL listing when we know the issue it belongs to. Re-throw
    // non-degradation errors so auth/not-found aren't masked.
    if (issue != null && DEGRADED.test(String(e.message || e))) {
      const all = await listCommentsGraphQL(owner, repo, issue);
      const hit = all.find((c) => String(c.id) === String(commentId));
      if (hit) return hit;
    }
    throw e;
  }
}

// Pull the JSON body out of the collapsed control-block comment. The sentinel
// must be the FIRST non-empty line so a prose comment that merely quotes the
// sentinel (plus a JSON fence) can never be mistaken for the control block.
export function hasSentinel(body) {
  if (!body) return false;
  const firstLine = body.replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => l.trim().length);
  return firstLine != null && firstLine.trim() === STATE_SENTINEL;
}

export function parseControlBlock(body) {
  if (!hasSentinel(body)) return null;
  const match = body.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

export function findControlBlock(comments) {
  const found = [];
  for (const c of comments) {
    if (hasSentinel(c.body)) {
      const data = parseControlBlock(c.body);
      if (data) found.push({ commentId: c.id, data });
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => (Number(b.data.txn || 0) - Number(a.data.txn || 0)) || (Number(a.commentId) - Number(b.commentId)));
  return found[0];
}

// Find a comment whose body carries a `## <marker>` heading. Used to surface
// stage artifacts (research brief, prototype rounds, plan, …) straight from the
// issue conversation, so the canvas can show them even when no machine-readable
// control block is maintained. `newest:true` returns the LAST match (e.g. the
// current plan after a PLAN-REVISE re-post), otherwise the first.
export function findCommentByHeading(comments, marker, { newest = false } = {}) {
  const re = new RegExp("^#{1,6}\\s*" + marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "m");
  let found = null;
  for (const c of comments) {
    if (c.body && re.test(c.body)) {
      found = { commentId: c.id, body: c.body };
      if (!newest) return found;
    }
  }
  return found;
}

// Parse the questionnaire comment into structured questions with choices.
// A question is a `**qN.**` line, optionally tagged with a select type, followed
// by contiguous choice bullets. All of these are valid:
//   **q1.** How should errors surface?                       (free text only)
//   **q2.** (single) Which framework?                        (pick one + note)
//   - React
//   - Vue
//   **q3.** (multi) Which constraints must v1 support?       (pick many + note)
//   - [ ] Min/max dates
//   - [ ] Disabled dates
// The `qN` id is authoritative. The select tag is optional; when absent it is
// inferred: `single` when choices are present, else `text`. Numbered/bullet
// prefixes on the question line (e.g. `1. **q1.** …`) still parse. A free-text
// note is always allowed alongside choices, so the webview renders one anyway.
export function parseQuestionnaire(body) {
  if (!body) return [];
  const qHead = /^\s*(?:\d+\.\s*|[-*]\s*)?\*\*(q\d+)\.\*\*\s*(?:\((single|multi|text)\)\s*)?(.+?)\s*$/i;
  const bullet = /^\s*[-*]\s+(?:\[[ xX]?\]\s*)?(.+?)\s*$/;
  const out = [];
  const seen = new Set();
  let cur = null;
  for (const raw of String(body).split(/\r?\n/)) {
    const hm = raw.match(qHead);
    if (hm) {
      const id = hm[1].toLowerCase();
      // Ignore a duplicate qN block entirely (and detach its bullets) so two
      // questions can never collapse onto one shared answer slot downstream.
      if (seen.has(id)) { cur = null; continue; }
      seen.add(id);
      cur = { id, select: (hm[2] || "").toLowerCase() || null, prompt: hm[3].trim(), choices: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const bm = raw.match(bullet);
    if (bm) { cur.choices.push(bm[1].trim()); continue; }
    // Any non-bullet line — blank or prose — ends this question's choice list.
    // Choices must sit contiguously under the prompt, so a blank line can never
    // let a later, unrelated bullet be pulled in as a choice.
    cur = null;
  }
  for (const q of out) {
    if (q.select !== "single" && q.select !== "multi" && q.select !== "text") {
      q.select = q.choices.length ? "single" : "text";
    }
    if (q.select === "text") q.choices = [];
  }
  return out;
}

// Find the questionnaire comment and its parsed questions. When `commentId` is
// given (the control block's authoritative pointer), parse THAT exact comment;
// otherwise fall back to the newest questionnaire comment by heading.
export function findQuestionnaireComment(comments, commentId) {
  let c = null;
  if (commentId != null) {
    // Pointer is authoritative: parse that exact comment or nothing. Never fall
    // back to the newest comment, which would attach foreign content to the id.
    const raw = (comments || []).find((x) => String(x.id) === String(commentId));
    if (!raw || !raw.body) return null;
    c = { commentId: raw.id, body: raw.body };
  } else {
    c = findCommentByHeading(comments, "📋 Questionnaire", { newest: true });
  }
  if (!c) return null;
  return { commentId: c.commentId, questions: parseQuestionnaire(c.body) };
}

// Find the build-ready comment and extract the PR number + URL. When `commentId`
// is given, parse THAT exact comment (the pointer wins over a newer re-post);
// otherwise use the newest build-ready comment by heading. A PLAN-REVISE/REVISE
// re-posts, so an un-pointered read reflects the latest PR state.
export function findBuildReadyComment(comments, commentId) {
  let c = null;
  if (commentId != null) {
    // Pointer is authoritative: parse that exact comment or nothing.
    const raw = (comments || []).find((x) => String(x.id) === String(commentId));
    if (!raw || !raw.body) return null;
    c = { commentId: raw.id, body: raw.body };
  } else {
    c = findCommentByHeading(comments, "🚀 Build ready", { newest: true });
  }
  if (!c) return null;
  const link = c.body.match(/\[[^\]]*\]\((https?:\/\/github\.com\/[^)\s]+\/pull\/(\d+))\)/i)
    || c.body.match(/(https?:\/\/github\.com\/[^)\s]+\/pull\/(\d+))/i);
  const hashPr = c.body.match(/#(\d+)/);
  const prUrl = link ? link[1] : null;
  const prNumber = link ? Number(link[2]) : (hashPr ? Number(hashPr[1]) : null);
  return { commentId: c.commentId, prUrl, prNumber };
}

// Collect every `## 🧪 Prototypes — round N` comment, newest round first.
export function findPrototypeComments(comments) {
  const out = [];
  for (const c of comments) {
    if (!c.body) continue;
    const m = c.body.match(/^#{1,6}\s*🧪\s*Prototypes\s*[—-]\s*round\s*(\d+)/im);
    if (m) out.push({ round: Number(m[1]), commentId: c.id, options: parsePrototypeOptions(c.body) });
  }
  return out.sort((a, b) => b.round - a.round);
}

// Parse the variant bullet list out of a prototype comment into structured
// options the canvas can render as visual cards. Each bullet looks like:
//   - **Variant 1 — Title:** pitch [Local preview](http://…) · Repo path: `path`
export function parsePrototypeOptions(body) {
  if (!body) return [];
  const out = [];
  const lines = body.split(/\r?\n/);
  let n = 0;
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+\*\*(.+?)\*\*\s*(.*)$/);
    if (!bullet) continue;
    const heading = bullet[1].replace(/:\s*$/, "").trim();
    const rest = bullet[2] || "";
    const link = rest.match(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
    const repo = rest.match(/Repo path:\s*`([^`]+)`/i);
    // Drop the trailing "[link] · Repo path: `…`" tail to leave just the pitch.
    let pitch = rest.replace(/\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/·?\s*Repo path:\s*`[^`]*`/i, "")
      .replace(/[·|]\s*$/, "").trim();
    n += 1;
    out.push({
      id: "variant-" + n,
      title: heading,
      pitch,
      previewUrl: link ? link[1] : null,
      repoPath: repo ? repo[1] : null,
      path: repo ? repo[1] : null,
    });
  }
  return out;
}
