// Pure helpers for turning raw GitHub PR reads into the bounded, head-pinned
// review snapshot the feedback gate renders. Kept side-effect-free (no gh, no
// I/O) so the CI classification and truncation budgets are fixture-testable.

// Classify a PR's aggregate check state from `gh pr view`'s statusCheckRollup.
// The critical distinction the feedback gate needs is "unknown" (we could not
// read checks) vs "none" (there are genuinely no checks) — a fail-closed UI must
// never render a read failure as a green "no CI".
//   null/undefined rollup      -> unknown  (read failed / not requested)
//   empty array                -> none     (confirmed: no checks reported)
//   any failure/error          -> failed
//   else any still-running     -> pending
//   else any UNRECOGNIZED      -> unknown  (fail-closed: an "other" check must
//                                           never be swept under a green pass)
//   else at least one success  -> passed
// A CheckRun only counts as a pass when status is COMPLETED with an allowed
// conclusion; anything COMPLETED-but-unrecognized is "other" (→ unknown).
export function summarizeChecks(rollup) {
  if (rollup == null) return { state: "unknown", counts: { total: 0 } };
  if (!Array.isArray(rollup)) return { state: "unknown", counts: { total: 0 } };
  if (rollup.length === 0) return { state: "none", counts: { total: 0 } };

  const FAIL_CONCL = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);
  const PASS_CONCL = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
  let fail = 0, pending = 0, pass = 0, other = 0;

  for (const c of rollup) {
    const status = String((c && c.status) || "").toUpperCase();     // CheckRun
    const concl = String((c && c.conclusion) || "").toUpperCase();  // CheckRun
    const state = String((c && c.state) || "").toUpperCase();       // StatusContext
    if (state) {
      if (state === "SUCCESS") pass++;
      else if (state === "PENDING" || state === "EXPECTED") pending++;
      else if (state === "FAILURE" || state === "ERROR") fail++;
      else other++;
    } else if (status !== "COMPLETED") {
      pending++; // QUEUED / IN_PROGRESS / WAITING / REQUESTED / missing status
    } else if (FAIL_CONCL.has(concl)) {
      fail++;
    } else if (PASS_CONCL.has(concl)) {
      pass++;
    } else {
      other++; // COMPLETED with an empty/unrecognized conclusion → don't trust it
    }
  }

  // Fail closed on unrecognized state: an "other" check surfaces as its own
  // non-green "unknown" rather than being ignored (which used to let one-pass +
  // one-unknown read as "passed", or only-unknown read as "none").
  const state = fail > 0 ? "failed"
    : pending > 0 ? "pending"
    : other > 0 ? "unknown"
    : pass > 0 ? "passed"
    : "none";
  return { state, counts: { fail, pending, pass, other, total: rollup.length } };
}

// Bound the changed-files list to protect the webview from a huge PR: cap file
// count, per-file patch bytes, and total patch bytes, flagging every truncation
// explicitly. A MISSING patch is preserved as `noPatch` (binary / too large /
// unavailable) — never silently rendered as "no changes".
export function boundFiles(files, limits) {
  const L = Object.assign({ maxFiles: 60, maxPatchBytes: 20000, maxTotalBytes: 400000 }, limits || {});
  const list = Array.isArray(files) ? files : [];
  const out = [];
  let total = 0;
  let truncatedFiles = false;

  for (let i = 0; i < list.length; i++) {
    if (out.length >= L.maxFiles) { truncatedFiles = true; break; }
    const f = list[i] || {};
    const path = f.filename || f.path || "(unknown)";
    let patch = typeof f.patch === "string" ? f.patch : null;
    let patchTruncated = false;
    if (patch != null) {
      if (patch.length > L.maxPatchBytes) { patch = patch.slice(0, L.maxPatchBytes); patchTruncated = true; }
      if (total + patch.length > L.maxTotalBytes) { patch = null; patchTruncated = true; }
      else total += patch.length;
    }
    out.push({
      path,
      status: f.status || null,
      additions: typeof f.additions === "number" ? f.additions : null,
      deletions: typeof f.deletions === "number" ? f.deletions : null,
      patch,
      patchTruncated,
      noPatch: patch == null,
    });
  }
  return { files: out, truncatedFiles, shownFiles: out.length };
}

// Assemble the final snapshot from PR metadata (read twice to detect a head that
// moved mid-read), the bounded files, and the head the human actually reviewed.
export function buildSnapshot({ metaA, metaB, files, reviewedHead, limits }) {
  const bounded = boundFiles(files, limits);
  const headRefOid = metaA && metaA.headRefOid ? metaA.headRefOid : null;
  const headBefore = headRefOid;
  // The second read must stand on its own — never fall back to headBefore, or a
  // failed/empty re-read would masquerade as "confirmed unchanged" and satisfy
  // headsKnown below without actually re-confirming the head.
  const headAfter = metaB && metaB.headRefOid ? metaB.headRefOid : null;
  const stale = !!(headBefore && headAfter && headBefore !== headAfter);
  const headMovedFromReview = !!(reviewedHead && headRefOid && reviewedHead !== headRefOid);
  // Ship is a fail-closed gate: it may only unlock when we can prove the revision
  // in front of the human is exactly the one that was reviewed. That requires a
  // recorded reviewedHead that equals the current head, both head reads agreeing
  // (not torn), and BOTH metadata reads reporting the PR still OPEN. A missing
  // reviewedHead (legacy / fallback build-ready artifact with no headSha) leaves
  // the PR unpinned and therefore NOT shippable.
  const headsKnown = !!(headBefore && headAfter);
  const pinned = !!(reviewedHead && headRefOid && reviewedHead === headRefOid);
  const openA = String((metaA && metaA.state) || "").toUpperCase() === "OPEN";
  const openB = String((metaB && metaB.state) || "").toUpperCase() === "OPEN";
  return {
    available: true,
    prNumber: metaA ? metaA.number : null,
    url: metaA ? metaA.url : null,
    headRefOid,
    reviewedHead: reviewedHead || null,
    headMovedFromReview,
    stale,
    isDraft: !!(metaA && metaA.isDraft),
    baseRefName: metaA ? metaA.baseRefName : null,
    mergeable: metaA ? metaA.mergeable : null,
    mergeStateStatus: metaA ? metaA.mergeStateStatus : null,
    reviewDecision: metaA ? metaA.reviewDecision : null,
    additions: metaA ? metaA.additions : null,
    deletions: metaA ? metaA.deletions : null,
    changedFiles: metaA ? metaA.changedFiles : null,
    checks: summarizeChecks(metaA ? metaA.statusCheckRollup : null),
    files: bounded.files,
    truncatedFiles: bounded.truncatedFiles,
    shownFiles: bounded.shownFiles,
    // Ship must be blocked whenever the reviewed revision is not the one on the
    // PR right now, the snapshot is torn, the head was never pinned, or the PR is
    // no longer open.
    reviewable: pinned && headsKnown && openA && openB && !stale,
    // Surfaced so the UI can explain WHY Ship is locked when nothing "moved":
    // the artifact never recorded the reviewed head.
    unpinned: !pinned,
  };
}
