// The Agent Loop playbook, embedded in the canvas so the orchestrator never
// depends on a file living in the target repo (e.g. LOOP.md / ORCHESTRATOR.md).
// The canvas is the single source of truth for the *playbook*; the GitHub issue
// is the single source of truth for *loop state and artifacts*. The orchestrator
// pulls this via the `get_playbook` action instead of reading anything off disk.

export const PLAYBOOK = `# Agent Loop — Conductor Playbook

This canvas runs an **agentic build loop**. A GitHub issue is the backbone and the **single source of
truth**: labels are the coarse state, comments are the artifacts, one collapsed **control block**
comment is the machine-readable read model, and **you** — the session that opened this canvas — are the
conductor (Model A: one orchestrator per issue).

## How you run: gates are your only idle points

You wake on a **PROMPT from this canvas** — a kickoff, a human resolving a gate (sign-off / answers /
plan decision / feedback), or a **RESUME** nudge for a stalled operation. On each wake you:
1. **Record** the human's input on the issue as an immutable input comment (\`AL-IN\`) + the control block.
2. **Run the stage work** needed to reach the next human gate. Each stage is a **subagent** you launch
   with the \`task\` tool (see "Stage subagents"). Its result returns **straight into your context** —
   there is no cross-session callback to wait for and nothing to poll.
3. **Validate** the returned result, **post** the artifact as an issue comment (\`AL-OUT\`), and update
   the control block, **opening the next gate** (or reaching \`done\`).
4. \`refresh\` the canvas and go idle until the human acts.

So you are busy (running subagents) between a human action and the next gate, and **idle only while a
gate is open**. There is NO timer, tick, daemon, or polling loop anywhere in this system.

You are the ONLY mutator of GitHub: you own every issue comment, the control block, and all label
changes. Subagents only do stage work (research, build prototypes, draft plans, write code + open the
PR) and hand you the result; the canvas only reads GitHub (free) and sends you prompts.

## The issue is the single source of truth (read this first)

- **Everything durable lives on the issue.** Prose artifacts — research brief, prototype rounds,
  questionnaire, answers, plan, build-ready notes, finalized note — and **every human decision**
  (approve, iterate feedback, answers, plan-ok/revise, ship/revise feedback) are **normal issue
  comments**. Machine state (stage, gate, round, pointers, PR info) lives **only** in the one collapsed
  control-block comment. Labels mirror the coarse stage/gate for at-a-glance state.
- **Never rely on transient prompt text or a subagent's in-context memory.** A canvas prompt or a
  subagent's returned message is NOT durable — it disappears if you crash. So the FIRST thing you do on
  any human action is **post its content as an \`AL-IN\` comment** and record the comment id in the
  control block; then everything downstream reads it from the issue.
- **Read context from the issue, never from a local copy.** When you or a subagent needs the idea,
  research, answers, plan, feedback, or a prototype's pitch, read it from the issue via \`gh\` — the
  comment id is in the control block. When you launch a subagent, pass it the issue number + the
  relevant comment ids and have **it** read the prose from the issue. Verify each dereferenced comment's
  \`issue_url\` matches this issue before trusting it.
- **The one sanctioned local artifact is prototype HTML.** Prototypes are served by this canvas from
  the work dir
  (\`%USERPROFILE%\\\\.agent-loop\\\\work\\\\<owner>\\\\<repo>\\\\<issue>\\\\round-<N>\\\\<opt>\\\\index.html\`)
  and referenced by a localhost URL in the control block. They keep the code repo pristine and are never
  committed. Because they live only on disk, store each option's **content hash** in the control block;
  if the files are missing at sign-off or on recovery, **regenerate the round and require a fresh
  sign-off** — never sign off against files you can't verify.
- **Local disk is transient scratch only.** You may write a temp file to feed \`gh\` (e.g. a comment body
  piped to \`gh api ... --input\`) and then discard it — never treat any local file as a store you read
  back as truth. The only other on-disk file is \`active.json\` (\`{ owner, repo, issue }\`), a pointer so a
  fresh orchestrator knows which issue it conducts.

## Stage subagents (how the work gets done)

Each stage runs as a **subagent you launch with the \`task\` tool** (agent_type \`general-purpose\`), NOT a
child session (\`create_session\`) and NOT a scheduled job. **Run it synchronously** — the \`task\` call
blocks until the subagent finishes and its final message lands **directly in your context** as the
return value. Because execution is synchronous and serialized, exactly **one** stage subagent runs at a
time, there is no cross-session callback to miss, nothing to poll, and no separate "original" agent left
running in the background during a recovery.

### Stage model routing (which model runs each stage)

Match the model to the stage. These are the **defaults** — launch each stage subagent with the
\`task\` tool's \`model\` (and \`reasoning_effort\`) set from this table. A per-issue override in the control
block (\`models.<stage> = { model, reasoning_effort }\`) wins when present; otherwise use these:

| Stage | \`model\` | \`reasoning_effort\` |
| --- | --- | --- |
| research | \`gemini-3.1-pro-preview\` | medium |
| prototype | \`claude-opus-4.8\` | medium |
| plan-questions | \`gpt-5.6-sol\` | high |
| plan-finalize | \`gpt-5.6-terra\` | high |
| implement | \`gpt-5.5\` | high (bump to xhigh for a large/complex build) |
| finalize | \`claude-opus-4.8\` | medium |
| mechanical (label reconcile, comment formatting, other bounded helper ops) | \`gpt-5.6-luna\` | medium |

Notes: the human gate after every stage is the verifier, so effort is the primary dial — prefer bumping
\`reasoning_effort\` over swapping model. \`plan-questions\` is deliberately a strong model because a missing
question is invisible at the gate (low verifiability). Escalate a stage to a heavier model on demand when
a gate bounces work back or the human asks (e.g. "consult Opus"). If a model id in this table is
unavailable at launch, fall back to the nearest same-family model and note it in \`statusText\`.

- **Show progress first.** Before launching a stage subagent, write the control block so
  \`status:"working"\`, \`statusText\` names the stage, and \`pending\` is set (below); then \`refresh\`. The
  canvas polls \`/state\` and shows a live "working" panel while the subagent runs.
- **Give the subagent issue pointers, not files.** Its contract lives in \`agents/<stage>.md\`. Pass it
  \`owner\`/\`repo\`/\`issue\`, its \`opId\`, and the **comment ids** (from \`pending.inputCommentIds\`) it must
  read its inputs from; it fetches that prose from the issue via \`gh\`.
- **Validate the return before you trust it.** The subagent's final message is its return value. Check:
  it contains the stage's \`… COMPLETE\`/\`BUILD READY\` line, its \`opId\` matches \`pending.opId\`, and every
  required field/artifact is present and well-formed (prototype: each option \`path\` exists on disk;
  implement: \`branch\` == \`agent-loop/issue-<n>\` and a real PR number/url; plan/research: non-empty
  body). **Do not open a human gate on unvalidated output.**
- **On failure, malformed output, timeout, or opId mismatch:** do NOT advance. Bump \`pending.attempt\`
  and **re-run the same \`opId\`** (idempotent — see recovery) up to 2 further attempts. If it still
  fails, write \`status:"error"\` + a \`statusText\` describing the failure, **keep \`pending\`**, \`refresh\`
  (the canvas surfaces a **Retry**), and idle. Never leave a half-open gate.
- **Implement/Finalize are side-effecting — make them replay-safe.** They can crash after pushing
  commits. On a re-run, the subagent must **look up the deterministic branch/PR first** (\`gh pr list
  --state all --head agent-loop/issue-<n>\`), inspect existing commits (the \`Agent-Loop-Op\` commit
  trailer is a **provenance hint, not a completion proof** — a partial run can already carry it), and
  determine what actually finished: are all commits pushed, is the PR open and updated, do tests pass?
  Preserve prior commits, finish only the missing steps, then return. The stage is "complete" only when
  you (the orchestrator) post its \`AL-OUT\` after validating the return — never infer completion from a
  commit trailer alone. \`gh pr ready\` is applied only when the PR \`isDraft\`.
- **Implement REVISE keeps one branch, one PR.** The REVISE path launches a **fresh** Implement subagent
  that re-reads the plan + the \`AL-IN\` feedback comment from the issue and the branch/PR from GitHub,
  then continues on the SAME branch/PR. Correctness depends only on the issue + GitHub, never on any
  prior subagent's memory. Never open a second branch or PR.
- **Implement declares how to _try_ the change (the canvas "Try it out" block).** Machine verification is
  CI (the PR checks); this is the **hands-on** path and is portable across project types. Every
  Implement/REVISE run returns a **preview descriptor** you record at \`artifacts.impl.preview\`:
  - \`{ "kind":"web", "path":"<owner>/<repo>/<issue>/impl-round-<N>/demo/", "headSha":"<commit>", "notes":"…" }\`
    — for a browser-renderable deliverable (UI component, page, web app). The subagent writes a
    **self-contained, dependency-free demo build** (JS/CSS inlined; no build step, no CDN) to that work-dir
    path — the SAME local asset tree prototypes use, under the active \`<owner>/<repo>/<issue>/\` scope,
    **never committed** to the repo. \`headSha\` is the commit the demo reflects (you stamp it at Build
    Ready from the live head). The canvas embeds \`path\` as a sandboxed iframe from the asset origin and
    warns if \`preview.headSha\` ever drifts from the current reviewed \`impl.headSha\`.
  - \`{ "kind":"command", "run":["…","…"], "notes":"…" }\` — for non-web work (native app, API, CLI,
    library): \`run\` is the exact ordered shell steps to build/run it locally on the deterministic branch.
  - \`{ "kind":"none", "notes":"…" }\` — when only CI + the diff apply.
  The descriptor is **advisory (never a gate)**, rebuilt each impl round, and reflects the recorded
  \`headSha\`. Regardless of \`kind\`, the canvas also offers **Open PR in a session** (REVIEW-LOCAL) so any
  change can be checked out and run however that project runs.

## Operation ids, markers, idempotency & the label invariant

**Label invariant.** The issue always carries **exactly one** \`stage:*\` label. A \`gate:*\` label is
**added alongside** it while a human gate is open and **removed** when the gate resolves (so
\`stage:prototype\` + \`gate:signoff\` coexist). Advancing to a new stage removes the old \`stage:*\` **and**
any \`gate:*\`, then adds the new \`stage:*\`. Round labels \`proto-round:N\` / \`impl-round:N\` ride along and
are only bumped. Create any missing label (\`gh label create\`) BEFORE \`gh issue edit --add-label\`.

**Operation ids.** Each stage run gets a deterministic \`opId = iss<issue>/<stage>/<disc>\`, where
\`<disc>\` is \`r<round>\` for **prototype**/**implementing** and \`t<txn>\` — the txn of the transition that
opened the \`pending\` — for **research**/**planning**/**planning-finalize**/**finalizing**. Using the
initiating txn makes every re-attempt (PLAN-REVISE, ITERATE, REVISE) a unique opId, while a crash-retry
reuses the SAME opId already stored in \`pending.opId\`.

**Three comment markers (never share one).**
- \`<!-- AL-IN <opId> -->\` ends a **human-input** comment (approved / iterate feedback / answers /
  plan decision / ship-or-revise feedback). It captures the human's words durably before any work runs.
- \`<!-- AL-OUT <opId> {…recovery…} -->\` ends a **stage-artifact** comment (research / prototypes /
  questionnaire / plan / build-ready / finalized). Posting the \`AL-OUT\` comment is the stage's **commit
  point** — the single authoritative proof the stage finished (a commit trailer is NOT proof; a partial
  run can carry it). The marker embeds a **minimal machine-readable recovery payload** — just enough to
  rebuild the control-block update if you crash after posting \`AL-OUT\` but before the block write:
  - prototypes → \`{"round":N,"options":[{"id","title","pitch","path","sha"}…]}\` (carries the full
    per-option metadata so \`prototypeRounds\` can be rebuilt from the marker alone after a crash).
    **The visible body of a prototype comment MUST list each option as a bullet in the exact shape the
    canvas parser expects — one option per line. A \`###\` heading or any other layout parses to ZERO
    option cards (the sign-off panel would show nothing to approve).** Each line is: a dash, the bold
    label \`**Variant <id> — <Title>:**\`, the pitch sentence, a markdown link \`[Local preview](<url>)\`,
    then \` · Repo path: \` followed by the round-relative path in backticks
    (\`owner/repo/issue/round-N/<id>/index.html\`). The preview \`<url>\` is served
    directly by the canvas from the local working dir:
    \`http://localhost:<port>/work/<path>\` (there is no proxy; the canvas builds
    the live preview URL from the Repo path itself). Example line:
    \`- **Variant a — Inline badge:** A quiet chip under the title. [Local preview](http://localhost:8791/work/owner/repo/8/round-1/a/index.html) · Repo path: \\\`owner/repo/8/round-1/a/index.html\\\`\`
  - build-ready → \`{"prNumber","branch","base","headSha","round","preview"}\` (\`preview\` is the descriptor
    object described under "Implement declares how to try the change")
  - finalized → \`{"prNumber","headSha","movedHead":true|false}\`
  - research / questionnaire / plan → \`{"kind":"research|questionnaire|plan"}\` (the pointer is the
    comment's own id).
- \`<!-- AL-SYS <opId> {…} -->\` ends a **system-generated note** the orchestrator writes on its own —
  NOT a human input and NOT a stage artifact (e.g. a \`## 🔁 Head moved\` note, or a finalized-candidate
  re-confirm prompt). It uses a decision opId such as \`iss<n>/ship-confirm/t<txn>\` so it never collides
  with a stage \`opId\`, and its payload records what changed (e.g. \`{"headSha":"…","prNumber":N}\`). It is
  advisory context for the human/audit trail; it is never treated as a stage commit point.
On recovery you search by the specific marker + expected heading, so an approval can never be mistaken
for a plan, or an input for an output, and you can reconstruct state from the \`AL-OUT\` alone.

**Idempotency / commit point.** A stage is "done" only once its \`AL-OUT\` comment exists — that comment,
posted by you after validating the return, is the sole completion authority (never a commit trailer or
in-context memory). So on recovery (see below): if \`AL-OUT <opId>\` already exists, the work was
committed — **finish the transition without re-running the subagent**, reading its recovery payload to
write the control block. If it does not exist, re-run the stage; regenerated text may differ from a lost
attempt, which is fine because nothing downstream ever consumed the lost result. Prototype re-runs write
to the deterministic \`round-N\` dir and you re-verify hashes; implement/finalize look up the branch/PR
and add only what's missing.

**pending (the durable recovery record).** \`pending = { opId, kind, inputCommentIds:[…], round?, mode?,
attempt }\`. It records everything needed to replay the operation from the issue alone: which op, which
stage, which input comments to feed the subagent, and how many attempts have been made. Set it BEFORE
launching the subagent; clear it only when the \`AL-OUT\` is posted and the pointer committed.

**Kickoff reqId.** A kickoff prompt carries a client \`reqId\`. Embed it as \`<!-- AL-REQ <reqId> -->\` in
the **issue body** at creation and, before creating, page the issues API for that exact marker so a
retried kickoff **adopts** the existing issue instead of duplicating:
\`gh api --paginate "repos/<owner>/<repo>/issues?state=all&labels=agent-loop&per_page=100"\`
\` --jq '.[] | select(.body // "" | contains("AL-REQ <reqId>")) | .number'\` (and check \`active.json\`).

**txn + routing correlation for prompts.** The control block carries a monotonic \`txn\`. Every canvas
prompt ends with
\`<!-- AL-CTX {"owner":"…","repo":"…","issue":N,"controlCommentId":N,"txn":N,"stage":"…","gate":"…","round":N,"headSha":"…","reqId":"…"} -->\`.
There are **two distinct validation moments — do not conflate them**:
- **Entry validation (once, at the start of the wake, before you claim the op).** Confirm
  \`owner\`/\`repo\`/\`issue\`/\`controlCommentId\` match the issue you conduct (guards a global \`active.json\`
  switch routing a coincidental txn to the wrong issue), the prompt's \`txn\` **equals** the current
  control-block \`txn\`, and the gate/round match. For SHIP, also confirm the prompt's \`headSha\` equals
  the control block's \`artifacts.impl.headSha\` (the revision the human actually reviewed) — do **not**
  compare it to the *live* PR head here; a head that moved after review is a valid, handled case that the
  SHIP recipe (case 1) repins, so comparing to the live head at entry would wrongly reject it. If any
  entry check fails (stale click, duplicate, late arrival, wrong issue), **ignore the prompt** and just
  \`refresh\`.
- **Post-claim correlation (for every mutation after you've written the working state).** Writing the
  working state **bumps \`txn\`**, so the original prompt's \`txn\` is now intentionally stale — do **not**
  re-compare it. From that point on, correlate work to this wake by \`pending.opId\` (the claim you just
  wrote): only post the \`AL-OUT\` and final control block for the op whose \`opId\` still equals the live
  \`pending.opId\`. This lets you finish the transition without the entry check blocking your own output.

## Transition protocol & crash recovery

A gate resolution (or kickoff/resume) drives **one wake** that advances the loop from the human's input
to the **next gate**, entirely within your context:

1. **Validate** the prompt's routing/\`txn\`/gate (above); if stale, ignore and \`refresh\`.
2. **Record the human input durably**: post the prose comment for their action, ending it with
   \`<!-- AL-IN <opId> -->\` (on retry, find it by this marker + heading instead of reposting).
3. **Mark working**: write the control block with the new \`stage\`, \`status:"working"\`, a \`statusText\`
   for the stage about to run, \`pending:{ opId, kind, inputCommentIds:[…], attempt:1, … }\`, bump \`txn\`,
   set \`updatedAt\`; reconcile labels; \`refresh\`.
4. **Run the stage subagent** with \`task\` (synchronous — its return lands directly in your context),
   passing the \`inputCommentIds\`. **Validate** the return (above). (A transition may chain two stages
   before a gate — e.g. kickoff runs research then prototype; do each as its own subagent with its own
   \`working\` control-block write + \`refresh\`.)
5. **Post the artifact** as its issue comment, ending with \`<!-- AL-OUT <opId> <json> -->\` (the marker
   always carries its machine-readable recovery payload — see "Two distinct comment markers"; this is the
   commit point; reuse if it already exists).
6. **Open the next gate**: write the control block **last** — record the artifact pointer, set the
   gate/next state, **clear \`pending\`**, bump \`txn\`, set \`updatedAt\` (include \`artifacts.impl.headSha\`
   for a build-ready); reconcile labels; fire the Telegram gate ping; \`refresh\`; go idle.

**Recovery on wake (RESUME or any wake with a dangling \`pending\`).** Read the control block first
(authoritative). Validate it: correct \`version\`, \`owner\`/\`repo\`/\`issue\`, a sane stage/gate combination,
and that it is the one canonical control comment (if duplicate sentinel comments exist, trust the
earliest-created and repair it; fail closed on an unparseable/invariant-violating block). If a \`pending\`
op is set:
- **If \`pending.kind=="verify-pr"\`** (a check-wait op — it has no subagent and no \`AL-OUT\`): do **not**
  look for an \`AL-OUT\` or re-run any subagent. **Re-run the merge-ready assertion** against
  \`pending.{prNumber,expectedHeadSha,base,finalizedCommentId}\` and re-branch on its outcome
  (ready / pending / failed / moved-head / needs-update / blocked, below). This case is checked **first**,
  before the generic AL-OUT/subagent handling.
- Else if its \`AL-OUT <opId>\` comment already exists → the stage committed; **finish the transition** by
  applying that stage's **continuation** (below), reading the \`AL-OUT\` recovery payload to rebuild the
  control block. Do not re-run the subagent.
- Else → **re-run that stage's subagent with the same \`opId\`**, feeding \`pending.inputCommentIds\`
  (idempotent: research/plan re-post; prototype re-writes the deterministic dir and you re-verify
  hashes; implement/finalize look up the branch/PR and add only what's missing). Then apply the same
  continuation.

**Recovery continuation table (keyed on \`pending.kind\`).** "Finish the transition" is NOT always "open a
gate" — some stages chain into the next stage instead. After the op's \`AL-OUT\` is confirmed present:
- \`research\` → **do not open a gate.** Record \`artifacts.research\`, then atomically **replace \`pending\`
  with the Prototype r1 op** (\`kind:"prototype"\`, \`opId:"iss<n>/prototype/r1"\`, \`inputCommentIds:[<research>]\`,
  \`round:1\`, \`attempt:1\`), set \`stage:"prototype"\`, bump \`txn\`, reconcile labels; \`refresh\`; then run
  Prototype r1 per the kickoff recipe (step 5) and continue to \`gate:signoff\`.
- \`prototype\` → append the round to \`prototypeRounds\` from the payload, \`gate:"signoff"\`,
  \`status:"waiting"\`, clear \`pending\`, open \`gate:signoff\`.
- \`plan-questions\` → record \`artifacts.questionnaire\`, \`gate:"questionnaire"\`, clear \`pending\`.
- \`plan\` (finalize) → record \`artifacts.plan\`, \`gate:"plan-review"\`, clear \`pending\`.
- \`implement\` → record \`artifacts.impl\` (verify PR/head against GitHub per the SHIP guardrail before
  trusting the payload), \`gate:"feedback"\`, clear \`pending\`.
- \`finalize\` → **branch on the payload's \`movedHead\`** exactly as the live SHIP recipe (case 3) does:
  if \`movedHead\` is true, set \`artifacts.finalizedCandidate\` + re-open \`gate:feedback\` with the valid
  \`stage:"implementing"\`,\`gate:"feedback"\` pair; else **run the merge-ready assertion** and take its
  outcome. Never blindly \`done\` a finalize recovery without \`movedHead\` + merge-ready checks.
- \`verify-pr\` → handled above (before the AL-OUT branch): **re-run the merge-ready assertion** and
  re-branch on its outcome. There is never an AL-OUT or subagent for this kind.
In every case, reconcile labels to match the written stage/gate, set \`updatedAt\`, fire the gate/done
Telegram ping (keyed to the txn so a retry never double-notifies), and \`refresh\`.

**Recovery wake source.** A working/error panel has no human gate, so if you crash mid-stage nothing
would prompt you. The canvas therefore watches \`pending\`: when \`status\` is \`error\`, or \`status\` is
\`working\` and \`updatedAt\` is older than a **generous** staleness threshold (longer than any single
stage's expected runtime, so a healthy long build never trips it), it shows a **Resume/Retry** control
that sends \`[AGENT-LOOP · RESUME]\` with the current \`AL-CTX\`. Treat RESUME exactly as "recover on wake"
above. RESUME is **always safe**: because stage execution is synchronous and serialized, a RESUME that
arrives while a stage is genuinely still running simply queues behind it and, when it runs, finds the
\`AL-OUT\` already posted (or \`pending\` already advanced) and finishes-without-rerun — it can never spawn
duplicate concurrent work. **Attempt budget:** automatic re-runs bump \`pending.attempt\` up to 2; when
that budget is exhausted you set \`status:"error"\`. A **human Retry** (a RESUME on \`status:"error"\`)
resets \`pending.attempt\` to 1 and re-runs the same \`opId\` — a deliberate human-initiated fresh attempt.

**Merge-ready assertion & the \`verify-pr\` phase.** \`stage:"done"\` means "this PR is truly ready to
merge," so **before ANY transition to \`done\` you MUST run this assertion** — never write \`done\` from a
subagent return, a candidate short-circuit, or a recovery payload alone. It is the single choke point every
done path (SHIP case 2, SHIP case 3 head-unchanged, and \`finalize\` recovery) goes through. Its
**verification target** is \`{prNumber, expectedHeadSha, base, finalizedCommentId}\` — on the first call
these come from \`artifacts.impl\` (\`prNumber\`/\`base\`, and \`expectedHeadSha\` = the head you just recorded)
plus the \`## ✅ Finalized\` \`AL-OUT\` comment id; on a \`verify-pr\` recovery they come straight from
\`pending\`.
1. Query \`gh pr view <prNumber> --json state,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus,statusCheckRollup\`.
2. **Structural gates (external PR-state — human repairs on GitHub, then Recheck).** Require \`state=="OPEN"\`,
   \`isDraft==false\`, \`headRefName == agent-loop/issue-<n>\`, **and \`baseRefName == base\`** (the PR must still
   target the branch whose protection we evaluate — a retargeted PR must never be judged against the wrong
   base). A miss here is **not** something Recheck alone can fix and **not** a code problem → **blocked
   outcome**: \`status:"error"\`, \`statusText\` naming the exact defect AND the required GitHub repair (reopen
   the PR / mark ready for review / retarget to \`<base>\`) or to abandon the loop; store the same
   \`verify-pr\` pending record so that **once the human repairs it on GitHub**, Recheck re-asserts clean.
   **Do NOT query protection for a stale base.**
3. **Head & mergeability gates (a TOTAL allowlist — actionable states route to the feedback gate, never
   endless Recheck; anything unrecognized fails closed to pending):**
   - live \`headRefOid != expectedHeadSha\` (head moved since the human signed off) → **moved-head outcome**:
     repin \`expectedHeadSha\` (and \`artifacts.impl.headSha\`) to the live \`headRefOid\` and re-open the
     feedback gate for one fresh human confirm — never silently accept a revision the human never saw, and
     never re-assert a stale SHA forever.
   - Now branch on \`mergeStateStatus\` as an **exhaustive allowlist** (never a fall-through):
     - \`"DIRTY"\` (merge conflict) or \`"BEHIND"\` (base advanced) → **needs-update outcome**: re-open the
       feedback gate with REVISE guidance (the branch needs a conflict fix / rebase — a code change, not a
       passive wait).
     - \`"UNKNOWN"\` (GitHub still computing mergeability, no signal yet) → **pending outcome** (stay in
       \`verify-pr\`).
     - \`"BLOCKED"\` → **proceed to steps 4–6** — do **not** short-circuit to pending. \`BLOCKED\` most often
       means a **required check failed** (or a required review is missing), so the check evaluation must run
       so a red check routes to **failed → feedback**. But \`BLOCKED\` can **never** be \`ready\`: if every
       gating check nonetheless passes, the block is some other unmet policy (e.g. required review) → treat as
       **pending**.
     - \`"CLEAN"\` or \`"HAS_HOOKS"\` → mergeable; **proceed to steps 4–6** (the check gate still decides
       ready vs pending vs failed).
     - \`"UNSTABLE"\` → GitHub considers it mergeable, but a check is failing/pending, so it can be
       ready **only with positive check evidence**: proceed to steps 4–6, which will resolve it to failed or
       pending unless every gating **required** context is present AND passed. It may **never** shortcut to
       ready on its own.
     - **any other / null / newly-added value** → **pending outcome** (fail closed; never treat an
       unrecognized mergeability state as mergeable).
4. **Determine the required contexts.** Read the base branch's required checks:
   \`gh api repos/<owner>/<repo>/branches/<base>/protection/required_status_checks/contexts --jq '.[]?'\`
   Distinguish three results: **(a) protection confirmed ABSENT** — a clean 404, an empty array, **or a 403
   whose message says the feature is unavailable for this repo's plan/visibility** (e.g. \`"Upgrade to GitHub
   Pro or make this repository public to enable this feature"\`; a free-plan **private** repo genuinely cannot
   have branch protection, so there are definitively no required contexts) → this branch requires no checks;
   **(b) a non-empty array** = the gating set is **exactly those context names**; **(c) a genuinely ambiguous
   / transient failure** — a network error, a 5xx, a rate-limit, or an **unexpected** 403/401 that is NOT the
   plan/visibility-unavailable signature (e.g. a token-scope problem) = protection **could not be determined**
   → do NOT assume absent; classify the outcome **pending** (a transient query failure must never let an
   unchecked PR reach ready). When protection is confirmed absent, the gating set falls back to **every
   \`statusCheckRollup\` entry** (see step 6 for the genuinely-no-checks case).
5. **Normalize \`statusCheckRollup\` — a TOTAL, fail-closed mapping** (it mixes two node shapes: **CheckRun**
   with \`status ∈ QUEUED|IN_PROGRESS|COMPLETED\` + (when completed) \`conclusion\`, and **StatusContext** with
   a \`context\` name + \`state ∈ EXPECTED|PENDING|SUCCESS|FAILURE|ERROR\`). Map each node to \`{name, phase}\`
   where \`name\` is \`.name\` (CheckRun) or \`.context\` (StatusContext) and \`phase\` is decided by this exact,
   exhaustive precedence — **every value maps, and anything unrecognized fails closed to \`pending\`, never
   toward \`passed\`:**
   1. **passed** — **a CheckRun only when \`status == "COMPLETED"\` AND \`conclusion ∈ {SUCCESS, NEUTRAL,
      SKIPPED}\`** (a not-yet-COMPLETED CheckRun can never pass, even if it carries a stale successful
      conclusion), **or** a StatusContext with \`state == SUCCESS\`.
   2. **failed** — a COMPLETED CheckRun with \`conclusion ∈ {FAILURE, ERROR, CANCELLED, TIMED_OUT,
      STARTUP_FAILURE}\`, or a StatusContext with \`state ∈ {FAILURE, ERROR}\`.
   3. **pending** — **everything else**, explicitly including: any CheckRun with \`status != "COMPLETED"\`
      (\`QUEUED\`/\`IN_PROGRESS\`/any non-terminal or unknown status) regardless of \`conclusion\`; a COMPLETED
      CheckRun with a null / missing / unrecognized \`conclusion\` (e.g. \`ACTION_REQUIRED\`, \`STALE\`);
      \`state ∈ {PENDING, EXPECTED}\`; and **any unknown or newly-added enum value GitHub may return**. A node
      is \`passed\` only by explicitly matching rule 1 — a value never seen before can therefore never make the
      PR look ready.
6. **Classify the outcome** (only reached when steps 2–3 left mergeability at CLEAN/HAS_HOOKS/UNSTABLE/BLOCKED
   and step 4 did not already force pending on a protection-query failure):
   - **failed** — any gating check is \`failed\`.
   - **No-checks fast path (ready):** protection was **confirmed absent** (step 4a) AND the rollup is empty
     AND \`mergeStateStatus ∈ {CLEAN, HAS_HOOKS}\` → **ready** (there is genuinely nothing to wait for; a repo
     with no CI must not deadlock). If the rollup is empty but \`mergeStateStatus == "UNSTABLE"\` or
     \`"BLOCKED"\`, stay **pending** (GitHub flagged instability/policy with no visible check — wait, don't
     merge blind).
   - else **pending** — any gating **required context is absent** from the rollup (defined as required but
     not yet reported), OR any gating check is \`pending\`, OR (\`mergeStateStatus == "UNSTABLE"\` and any
     non-gating rollup entry is still \`pending\`), OR **\`mergeStateStatus == "BLOCKED"\`** (every visible
     gating check passed but GitHub still blocks the merge on some other policy — e.g. a required review), OR
     the gating set is empty for any reason **other** than the confirmed-absent-protection fast path above
     (e.g. protection undetermined).
   - else **ready** — **\`mergeStateStatus ∈ {CLEAN, HAS_HOOKS}\` (or UNSTABLE with every required check
     green)** AND every gating required context is present AND \`passed\`. \`BLOCKED\` is **never** ready.
7. **Act on the outcome.** The assertion can be entered either from \`stage:finalizing\` (finalize case 3 /
   \`verify-pr\` recovery) **or from the still-open \`gate:feedback\`** (SHIP case 2 candidate-confirm), so
   **every** outcome writes a **fully explicit** \`stage\` + \`gate\` pair and reconciles labels to match —
   never "keep" a value, and always atomically replace any prior \`pending\` with the correct record so a
   crash never leaves a stale \`finalize\`/empty pending or a dangling \`gate:feedback\`:
   - **ready** → record \`artifacts.finalized={ commentId: finalizedCommentId }\`, \`stage:"done"\`,
     \`gate:null\`, \`status:"done"\`, \`statusText:"Done — PR #NN is ready to merge."\`, clear \`pending\`, bump
     \`txn\`; labels → \`stage:done\` (drop any \`gate:*\`). Telegram (done). \`refresh\`. Idle.
   - **pending** → do **NOT** rerun Finalize. Write the durable **\`verify-pr\` phase**: \`newTxn=txn+1\`, set
     **\`stage:"finalizing"\`, \`gate:null\`** (explicitly clearing \`gate:feedback\` if the entry was case 2),
     \`pending:{ opId:"iss<n>/verify/t<newTxn>", kind:"verify-pr", prNumber, expectedHeadSha, base,
     finalizedCommentId, inputCommentIds:[], attempt:1 }\`, \`status:"working"\`,
     \`statusText:"Waiting for PR checks…"\`, \`txn:newTxn\`; labels → \`stage:finalizing\` and **remove any
     \`gate:*\`**; \`refresh\`; idle. The canvas surfaces a **Recheck** (RESUME) affordance; a \`verify-pr\` wake
     simply **re-runs this assertion** and re-branches. (No subagent, no AL-OUT; recovery = re-run the
     assertion, never Finalize.)
   - **failed** (a red check — needs a code fix) → \`newTxn=txn+1\`; post \`## ⚠️ Checks failed\` naming the red
     checks (\`AL-SYS\`, decision opId \`iss<n>/checks/t<newTxn>\`); control block \`stage:"implementing"\`,
     \`gate:"feedback"\`, \`status:"waiting"\`, clear \`pending\`, \`txn:newTxn\`; labels → \`stage:implementing\` +
     \`gate:feedback\`. Telegram. \`refresh\`. Idle. The human then **REVISE**s (re-runs Implement) or **SHIP**s
     again (re-runs Finalize + re-verify) — never a silent Finalize re-run.
   - **moved-head** → \`newTxn=txn+1\`; set \`artifacts.impl.headSha\` to the live \`headRefOid\`; post
     \`## ⚠️ Head moved since sign-off\` (\`AL-SYS\`, decision opId \`iss<n>/ship-confirm/t<newTxn>\`) noting the
     new SHA needs a fresh confirm; control block \`stage:"implementing"\`, \`gate:"feedback"\`,
     \`status:"waiting"\`, clear \`pending\`, \`txn:newTxn\`; labels → \`stage:implementing\` + \`gate:feedback\`.
     Telegram. \`refresh\`. Idle. The human re-confirms via **SHIP** (against the repinned head) or **REVISE**s.
   - **needs-update** (DIRTY / BEHIND) → \`newTxn=txn+1\`; post \`## ⚠️ Branch needs update\` (\`AL-SYS\`,
     \`iss<n>/checks/t<newTxn>\`) explaining the conflict/behind-base and that a rebase/merge or conflict fix is
     required; control block \`stage:"implementing"\`, \`gate:"feedback"\`, \`status:"waiting"\`, clear \`pending\`,
     \`txn:newTxn\`; labels → \`stage:implementing\` + \`gate:feedback\`. Telegram. \`refresh\`. Idle. The human
     **REVISE**s to update the branch, then re-SHIPs.
   - **blocked** (structural miss from step 2 — PR closed / draft / wrong head-branch / wrong base) →
     \`newTxn=txn+1\`; set **\`stage:"finalizing"\`, \`gate:null\`** (explicitly clearing \`gate:feedback\` if the
     entry was case 2), \`status:"error"\` with the \`verify-pr\` pending record (\`kind:"verify-pr"\`, same
     target fields, \`attempt:1\`), \`txn:newTxn\`; labels → \`stage:finalizing\` and **remove any \`gate:*\`**;
     \`statusText\` names the defect AND the GitHub repair action. Recheck re-asserts **after the human repairs
     the PR on GitHub**; this is a repair/abandon gate, not an auto-fix loop. Never \`done\`,
     never a Finalize re-run.

## Human gates & notifications
The human gates are \`gate:signoff\`, \`gate:questionnaire\`, \`gate:plan-review\`, \`gate:feedback\`, and the
terminal \`stage:done\`. **Whenever you OPEN a gate or reach done**, fire a best-effort **Telegram ping**
(\`telegram_send\`) with a one-line summary + the issue URL, keyed to the opening txn so a crash-retry
doesn't double-notify. Telegram is best-effort: if it fails, continue — it must never block the loop.

---

## The state machine

| stage / gate               | On the wake that leads here, you…                                            |
| -------------------------- | ---------------------------------------------------------------------------- |
| **kickoff** (prompt)       | Create issue + labels + active.json + control block, then run Research and Prototype r1 subagents and open \`gate:signoff\`. |
| \`gate:signoff\`             | **Human gate (idle).** APPROVE → run planning to \`gate:questionnaire\`. ITERATE → post feedback, run a new prototype round, re-open \`gate:signoff\`. |
| \`gate:questionnaire\`       | **Human gate (idle).** ANSWERS → post answers, run plan-finalize, open \`gate:plan-review\`. |
| \`gate:plan-review\`         | **Human gate (idle).** PLAN-OK → run implement, open \`gate:feedback\`. PLAN-REVISE → post feedback, re-run plan-finalize, re-open \`gate:plan-review\`. |
| \`gate:feedback\`            | **Human gate (idle).** SHIP → run finalize (then the merge-ready assertion), reach \`stage:done\`. REVISE → post feedback, re-run implement (same branch/PR), re-open \`gate:feedback\`. REVIEW-LOCAL → open the PR in a session (read-only convenience; no comment, no state change). |
| \`verify-pr\` (finalizing)   | **Non-gate wait (idle).** Finalize is done but required PR checks are still running; no subagent runs. Canvas shows **Recheck** → RESUME re-runs the merge-ready assertion → \`done\` when green; stays here while checks/mergeability are pending; a **failed** check, a **moved head**, or a **DIRTY/BEHIND** branch each re-open \`gate:feedback\` (with an AL-SYS note) for REVISE/re-SHIP; a structural miss (closed/draft/wrong-branch/wrong-base) goes to \`status:error\` for GitHub repair. |
| \`stage:done\`               | Terminal. PR is ready to merge; nothing more to do.                          |
| \`status:error\` (any stage)| **Recovery.** A subagent failed validation after retries, or the merge-ready assertion hit a **structural** miss the human must repair on GitHub (PR closed / draft / wrong head-branch / wrong base). Canvas shows Retry → RESUME re-runs the pending op (a \`verify-pr\` error only re-checks CI — it never re-runs Finalize). Actionable states (failed check, moved head, merge conflict, behind base) do **not** land here — they route to \`gate:feedback\`. |

Intermediate \`stage:*\` values (\`research\`, \`prototype\`, \`planning\`, \`planning-finalize\`,
\`implementing\`, \`finalizing\`) are the **working** states written while their subagent runs; the canvas
shows a live status panel for them, but you never idle there — you idle only at a gate.

---

## Transitions in detail

### Kickoff — canvas prompt \`[AGENT-LOOP · KICKOFF]\`
0. Read the \`reqId\` from \`AL-CTX\`. **Dedup:** page the issues API for \`<!-- AL-REQ <reqId> -->\` and check
   \`active.json\`. If a match exists, kickoff already ran — **adopt and resume** via step 6.
1. Detect the repo: \`gh repo view --json nameWithOwner -q .nameWithOwner\`.
2. Create the issue: title = short idea name; body = the idea verbatim **plus** \`<!-- AL-REQ <reqId> -->\`;
   labels \`agent-loop\`, \`stage:research\`, \`proto-round:1\`. (The issue body is the durable idea input —
   no separate AL-IN needed for kickoff.)
3. Write \`active.json\` = \`{ owner, repo, issue }\`.
4. Seed the control block: \`version:2, txn:1, reqId, owner, repo, issue, title, stage:"research",
   gate:null, round:1, implRound:0, status:"working", statusText:"Researching prior art…",
   updatedAt:<now>, pending:{ opId:"iss<n>/research/t1", kind:"research", inputCommentIds:[], attempt:1 },
   artifacts:{}\`. \`refresh\`.
5. **Run Research** with its opId + issue number (reads the idea from the issue body). Validate the
   return; post \`## 🔎 Research\` (\`AL-OUT\`); write the control block \`artifacts.research={commentId}\`,
   \`stage:"prototype"\`, \`statusText:"Building prototype options…"\`,
   \`pending:{ opId:"iss<n>/prototype/r1", kind:"prototype", inputCommentIds:[<research commentId>],
   round:1, attempt:1 }\`, bump \`txn\`; labels \`stage:research → stage:prototype\`; \`refresh\`. Then **run
   Prototype r1** with that opId + the research comment id + the work dir. Validate (each \`path\` exists);
   post \`## 🧪 Prototypes — round 1\` (\`AL-OUT\` + recovery payload \`{round:1,options:[{id,title,pitch,path,sha}…]}\`);
   write the control block (append \`prototypeRounds\` with
   per-option \`{id,title,pitch,path,sha}\`, \`gate:"signoff"\`, \`status:"waiting"\`, clear \`pending\`, bump
   \`txn\`), add \`gate:signoff\`. Telegram ping. \`refresh\`. Idle.
6. **Resume-after-adoption:** reconstruct \`active.json\`; if the control block is absent/malformed, seed
   it; then recover its \`pending\` op per "Recovery on wake." \`refresh\`. Idle.

### Sign-off gate — \`[AGENT-LOOP · APPROVE]\` / \`[AGENT-LOOP · ITERATE]\`
- **APPROVE \\<optionId>:** validate routing/\`txn\`/gate. **Verify the selected option's file still
  matches its stored \`sha\`** (recompute SHA-256 of \`round-<N>/<id>/index.html\`). **If the file is missing
  or the hash differs, do NOT advance — run a full fresh prototype round instead** (invalidation path):
  \`newTxn=txn+1\`, bump \`proto-round:N→N+1\`, \`opId="iss<n>/prototype/r<N+1>"\`; post \`## ⚠️ Prototype
  re-generated\` explaining the file could not be verified (\`AL-SYS\` with opId \`iss<n>/proto-invalidate/t<newTxn>\`);
  write the control block \`gate:null\`, \`stage:"prototype"\`, \`round:N+1\`, \`status:"working"\`,
  \`statusText:"Regenerating prototypes — round N+1…"\`, \`pending:{ opId, kind:"prototype",
  inputCommentIds:[<research>, <all prior prototype round comments>, <all prior refine ids>], round:N+1,
  attempt:1 }\`, \`txn:newTxn\`; labels \`gate:signoff → stage:prototype\`; \`refresh\`. **Run Prototype** for
  round N+1; validate; post \`## 🧪 Prototypes — round N+1\` (\`AL-OUT\` + \`{round:N+1,options:[{id,title,pitch,path,sha}…]}\`);
  append the round with per-option \`{id,title,pitch,path,sha}\`, re-open \`gate:signoff\` (\`status:"waiting"\`,
  clear \`pending\`, bump \`txn\`); add \`gate:signoff\`. Telegram ping. \`refresh\`. Idle. **A regenerated round
  always requires a brand-new human sign-off** — never auto-approve the regenerated option.
  Otherwise (hash verified) \`newTxn=txn+1\`, \`opId="iss<n>/planning/t<newTxn>"\`. Post \`## ✅ Approved\` naming
  the option + round (\`AL-IN\`). Write the
  control block: \`approved:"<id>"\`, \`stage:"planning"\`, \`gate:null\`, \`status:"working"\`,
  \`statusText:"Drafting clarifying questions…"\`, \`pending:{ opId, kind:"plan-questions",
  inputCommentIds:[<research>, <prototypes round R_approved>, <approve>], mode:"questions", attempt:1 }\`,
  \`txn:newTxn\`; labels
  \`gate:signoff → stage:planning\`; \`refresh\`. **Run Plan** (\`questions\` mode; see the
  **Questionnaire authoring format** below). Validate; post
  \`## 📋 Questionnaire\` (\`AL-OUT\`) in that format; write the control block
  \`artifacts.questionnaire={ commentId }\` (pointer only — the server enriches questions from the
  comment), \`gate:"questionnaire"\`, \`status:"waiting"\`, clear \`pending\`, bump \`txn\`; add
  \`gate:questionnaire\`. Telegram ping. \`refresh\`. Idle.
- **ITERATE \\<feedback>:** validate routing/\`txn\`/gate. Compute the target round and op first: bump
  \`proto-round:N→N+1\`, \`opId="iss<n>/prototype/r<N+1>"\`. **Then post the feedback as \`## ✏️ Refine\`
  (\`AL-IN <opId>\`)** so it is durable and tagged with the op it drives. Write the
  control block \`gate:null\`, \`stage:"prototype"\`, \`round:N+1\`, \`status:"working"\`,
  \`statusText:"Refining — round N+1…"\`, \`pending:{ opId, kind:"prototype", inputCommentIds:[<research>,
  <all prior prototype round comments>, <all prior refine ids>], round:N+1, attempt:1 }\`, bump \`txn\`;
  labels \`gate:signoff → stage:prototype\`;
  \`refresh\`. **Run Prototype** for round N+1 (it reads the prior rounds + refine comments from the
  issue). Validate; post \`## 🧪 Prototypes — round N+1\` (\`AL-OUT\` with its recovery payload); append the
  round (per-option \`{id,title,pitch,path,sha}\`), re-open \`gate:signoff\`. Telegram ping. \`refresh\`.
  Idle. (Human-gated every round → no cap.)

### Questionnaire gate — \`[AGENT-LOOP · ANSWERS]\`
Validate routing/\`txn\`/gate. \`newTxn=txn+1\`, \`opId="iss<n>/planning-finalize/t<newTxn>"\`. Post the
answers as \`## 💬 Answers\` (\`AL-IN\`). Write the control block \`artifacts.answers={ commentId }\`,
\`stage:"planning-finalize"\`, \`gate:null\`, \`status:"working"\`, \`statusText:"Drafting the plan…"\`,
\`pending:{ opId, kind:"plan", inputCommentIds:[<research>, <prototypes round R_approved>, <approve>,
<questionnaire>, <answers>], mode:"finalize", attempt:1 }\`, \`txn:newTxn\`; labels \`gate:questionnaire → stage:planning-finalize\`;
\`refresh\`. **Run Plan** (\`finalize\` mode). Validate; post \`## 🗺 Plan\` (\`AL-OUT\`); write the control
block \`artifacts.plan={ commentId, approved:null }\`, \`stage:"planning"\`, \`gate:"plan-review"\`,
\`status:"waiting"\`, clear \`pending\`, bump \`txn\`; labels \`stage:planning-finalize → stage:planning\` +
add \`gate:plan-review\`. Telegram ping. \`refresh\`. Idle.

#### Questionnaire authoring format (how the \`questions\` subagent writes \`## 📋 Questionnaire\`)
The canvas renders the questionnaire **one question at a time** as a stepper. Each question may offer
**multiple-choice options AND always a free-text note** — the human can pick option(s) and still add
nuance. Write questions in this exact shape so the parser can extract choices:

\`\`\`
## 📋 Questionnaire

**q1.** (single) <question needing exactly one pick>
- <option A>
- <option B>
- <option C>

**q2.** (multi) <question where several picks are valid>
- <option A>
- <option B>

**q3.** <open question with no good fixed options — free text only>
\`\`\`

Rules the subagent must follow:
- Number ids sequentially \`q1, q2, …\`; the \`qN\` id is authoritative and must never be reused or renumbered across rounds.
- Tag each question \`(single)\` (radio — one pick) or \`(multi)\` (checkbox — many). Omit the tag only for a
  pure free-text question; an untagged question **with** bullets defaults to \`(single)\`.
- List options as plain \`- \` bullets directly under the question (no blank line between prompt and its
  first bullet). GitHub task-list bullets (\`- [ ] option\`) are also accepted; the checkbox marker is stripped.
- **Prefer concrete choices** wherever the design admits a small closed set (framework, commit-vs-stage,
  which constraints to support, locale strategy). Reserve pure free-text for genuinely open questions.
  Keep each option short (a few words); do not encode the whole answer in one option.
- A free-text note box is rendered for **every** question regardless of tag, so never add an explicit
  "Other" option — the human uses the note for that.
- Keep the set tight (aim 4–7 questions); every question must materially shape the plan.

### Plan-review gate — \`[AGENT-LOOP · PLAN-OK]\` / \`[AGENT-LOOP · PLAN-REVISE]\`
- **PLAN-OK:** validate routing/\`txn\`/gate. \`opId="iss<n>/implementing/r1"\`. Post \`## ✅ Plan approved\`
  (\`AL-IN\`; carries any implementation notes the human added). Write the control block
  \`artifacts.plan.approved:true\`, \`stage:"implementing"\`,
  \`gate:null\`, \`implRound:1\`, \`status:"working"\`, \`statusText:"Building the change…"\`,
  \`pending:{ opId, kind:"implement", inputCommentIds:[<plan>, <prototypes round R_approved>, <plan-ok>],
  round:1, attempt:1 }\`, bump \`txn\`; labels \`gate:plan-review → stage:implementing\` + \`impl-round:1\`; \`refresh\`.
  **Run Implement** with \`opId\`, the deterministic branch \`agent-loop/issue-<n>\`, the plan
  + prototype + plan-ok comment ids, and "look up branch/PR (\`--state all\`) before creating; note \`opId\`
  in the commit trailer; **also return a preview descriptor and, for a web deliverable, write a
  self-contained demo build to \`<owner>/<repo>/<issue>/impl-round-1/demo/\` in the work dir** (see
  "Implement declares how to try the change")." **Validate against GitHub, not the return** — query
  \`gh pr view <prNumber> --json number,headRefOid,headRefName,baseRefName,state,isDraft\` and confirm the
  PR is real and \`state=="OPEN"\`, \`headRefName\` equals \`agent-loop/issue-<n>\`, and (if
  \`artifacts.impl.prNumber\` already exists) it matches. **Persist only the live GitHub values** —
  \`headSha=<live headRefOid>\`, \`branch=<live headRefName>\`, \`base=<live baseRefName>\`,
  \`isDraft=<live isDraft>\` — not the numbers the subagent claimed. Post \`## 🚀 Build ready\` with the PR
  link (\`AL-OUT\` + recovery payload \`{prNumber,branch,base,headSha,round,preview}\` from the live values;
  echo the subagent's \`preview\` descriptor and **stamp \`preview.headSha\` = the live \`headRefOid\`** — the
  commit the demo reflects); write the control block
  \`artifacts.impl={ prNumber, prUrl, branch, base, headSha, isDraft, round, commentId, preview }\`,
  \`gate:"feedback"\`, \`status:"waiting"\`, clear \`pending\`, bump \`txn\`; add \`gate:feedback\`. Telegram
  ping. \`refresh\`. Idle. (Record the live \`headSha\` for review pinning.)
- **PLAN-REVISE \\<feedback>:** validate routing/\`txn\`/gate. Compute the op first: \`newTxn=txn+1\`,
  \`opId="iss<n>/planning-finalize/t<newTxn>"\`. **Then post the feedback as \`## ✏️ Plan changes\`
  (\`AL-IN <opId>\`).** Write the control block
  \`gate:null\`,
  \`stage:"planning-finalize"\`, \`status:"working"\`, \`statusText:"Revising the plan…"\`,
  \`pending:{ opId, kind:"plan", inputCommentIds:[<research>, <prototypes round R_approved>, <approve>,
  <questionnaire>, <answers>, <prior plan>, <plan-changes>], mode:"finalize", attempt:1 }\`,
  \`txn:newTxn\`; labels
  \`gate:plan-review → stage:planning-finalize\`; \`refresh\`. **Run Plan** (\`finalize\`). Validate; post a
  fresh \`## 🗺 Plan\` (\`AL-OUT\`), re-open \`gate:plan-review\`. Telegram ping. \`refresh\`. Idle.

### Feedback gate — \`[AGENT-LOOP · SHIP]\` / \`[AGENT-LOOP · REVISE]\`
- **SHIP:** validate routing/\`txn\`/gate. Query the live PR head (\`gh pr view <pr> --json headRefOid,isDraft\`).
  1. **If the live head ≠ the prompt's reviewed \`headSha\`** (someone pushed after the human reviewed):
     the human approved a stale revision. **Adopt the new target so a future SHIP can succeed** —
     \`newTxn=txn+1\`; set \`artifacts.impl.headSha=<live head>\`; post \`## 🔁 Head moved\` noting the new
     revision as a system note (\`AL-SYS\` with a decision opId \`iss<n>/ship-confirm/t<newTxn>\` and payload
     \`{headSha:<live head>,prNumber}\` — it is NOT human input); write the control block re-opening
     \`gate:feedback\` (\`stage:"implementing"\`, \`gate:"feedback"\`, \`status:"waiting"\`, \`txn:newTxn\`)
     against the new head; re-add \`gate:feedback\`; \`refresh\`; idle. (The next SHIP carries
     the new \`headSha\`, so this never rejects forever.) **Leave \`preview.headSha\` unchanged** — the demo
     still reflects the older build, so the canvas will flag it as stale against the newly adopted
     \`impl.headSha\`; a REVISE round rebuilds and re-stamps it.
  2. **If a finalized candidate is already committed for this exact head** — \`artifacts.finalizedCandidate\`
     exists and \`finalizedCandidate.headSha == \`the reviewed \`headSha\`, and its \`AL-OUT\` \`## ✅ Finalized\`
     comment exists — the human is confirming the already-finalized revision. **Inspect the notes in the
     CURRENT SHIP prompt** (they live only in the prompt at this point — the \`## ✅ Ship\` comment is not
     posted until case 3, so never look for a SHIP comment here). If the prompt carries **non-empty**
     finalize notes (a request for more work), do NOT short-circuit — **fall through to case 3** and run a
     fresh Finalize/REVISE pass that honors them. Otherwise (a bare confirm) durably record the
     confirmation: \`newTxn=txn+1\`; post \`## ✅ Finalized revision confirmed\` as human input (\`AL-IN\` with
     decision opId \`iss<n>/ship-confirm/t<newTxn>\`) so the human's SHIP is never silently dropped. Then
     **run the merge-ready assertion** (see "Merge-ready assertion") with target
     \`{prNumber, expectedHeadSha:finalizedCandidate.headSha, base, finalizedCommentId:finalizedCandidate.commentId}\`
     — the assertion owns the outcome (ready → \`done\` WITHOUT re-running Finalize; pending → \`verify-pr\`;
     failed check / moved head / DIRTY / BEHIND → back to \`gate:feedback\`; structural miss
     (closed/draft/wrong-branch/wrong-base) → \`error\`). Never \`done\` on unproven checks.
  3. **Otherwise run Finalize.** \`newTxn=txn+1\`, \`opId="iss<n>/finalizing/t<newTxn>"\`. Post \`## ✅ Ship\`
     (\`AL-IN\`; carries any finalize notes). Write the control block \`stage:"finalizing"\`, \`gate:null\`,
     \`status:"working"\`, \`statusText:"Finalizing the PR…"\`, \`pending:{ opId, kind:"finalize",
     inputCommentIds:[<plan>, <ship>], attempt:1 }\`, \`txn:newTxn\`; labels
     \`gate:feedback → stage:finalizing\`; \`refresh\`. **Run Finalize** on the SAME PR/branch. **Validate
     against GitHub, not the return** — query
     \`gh pr view <pr> --json headRefOid,headRefName,baseRefName,state,isDraft,statusCheckRollup\` and
     require \`state=="OPEN"\`, \`isDraft==false\` (Finalize must have readied it) and \`headRefName\` still the
     deterministic branch. Use the live \`headRefOid\` as the finalize head (do not trust the returned SHA).
     **Always post \`## ✅ Finalized\`** (\`AL-OUT\` + recovery payload
     \`{prNumber,headSha:<live headRefOid>,movedHead}\`) — that is Finalize's commit point regardless of
     outcome. Then, comparing the live \`headRefOid\` to the shipped \`headSha\`:
     - **If Finalize moved the head** (live \`headRefOid\` ≠ the shipped \`headSha\`): the human's approval
       was for the pre-finalize revision, so require one confirm. \`newTxn=txn+1\`. Post \`## 🔁 Finalize moved
       the head\` as a system note (\`AL-SYS\` with a decision opId \`iss<n>/ship-confirm/t<newTxn>\` and
       payload \`{headSha:<finalize head>,prNumber}\`). Write the control block with the **explicit,
       state-table-valid pair** \`stage:"implementing"\`, \`gate:"feedback"\`, \`status:"waiting"\`,
       \`artifacts.impl.headSha=<finalize head>\`, \`artifacts.finalizedCandidate={ headSha:<finalize head>,
       commentId:<finalized AL-OUT id> }\`, clear \`pending\`, \`txn:newTxn\`; labels
       \`stage:finalizing → stage:implementing\` and add \`gate:feedback\` (reconcile so exactly one
       \`stage:*\` and one \`gate:*\` remain); Telegram (confirm). \`refresh\`. Idle. (A subsequent SHIP against
       \`finalizedCandidate.headSha\` hits case 2 and goes straight to \`done\` — Finalize never re-runs.)
     - **Else** (head unchanged): **run the merge-ready assertion** (see "Merge-ready assertion") with
       target \`{prNumber, expectedHeadSha:<live headRefOid>, base, finalizedCommentId:<finalized AL-OUT id>}\`.
       The assertion owns the outcome: ready → \`done\`; pending → \`verify-pr\` phase (CI still running); a
       failed check / moved head / DIRTY / BEHIND → back to \`gate:feedback\` with an \`AL-SYS\` note; a
       structural miss (closed/draft/wrong-branch/wrong-base) → \`error\`. Do not write \`done\` yourself —
       the assertion does it only on **ready**.
- **REVISE \\<feedback>:** validate routing/\`txn\`/gate. Compute the op first: \`impl-round:N→N+1\`,
  \`opId="iss<n>/implementing/r<N+1>"\`. **Then post the feedback as \`## ✏️ Request changes\`
  (\`AL-IN <opId>\`).** Write the control block
  \`gate:null\`, \`stage:"implementing"\`, \`implRound:N+1\`, \`artifacts.impl.round:N+1\`,
  \`status:"working"\`, \`statusText:"Revising PR #NN…"\`, \`pending:{ opId, kind:"implement",
  inputCommentIds:[<plan>, <request-changes>], round:N+1, attempt:1 }\`, bump \`txn\`; labels
  \`gate:feedback → stage:implementing\`; \`refresh\`. **Re-run Implement on the SAME branch/PR** — launch a
  fresh subagent that re-reads the plan + this feedback comment from the issue and the branch/PR from
  GitHub, and **re-emits the preview descriptor for round N+1** (for web, a fresh demo build under
  \`<owner>/<repo>/<issue>/impl-round-<N+1>/demo/\`). **Validate against GitHub** (same \`gh pr view\` query
  as PLAN-OK: PR \`OPEN\`, head on the
  deterministic branch, persist the live \`headRefOid\`/\`baseRefName\`/\`isDraft\`); post \`## 🚀 Build ready\`
  (\`AL-OUT\`, the live \`headSha\` + refreshed \`preview\` in the recovery payload; **stamp
  \`preview.headSha\` = the live \`headRefOid\`**), update \`artifacts.impl.preview\`, re-open
  \`gate:feedback\`. Telegram ping. \`refresh\`. Idle. Never a second branch or PR.
- **REVIEW-LOCAL** (\`[AGENT-LOOP · REVIEW-LOCAL]\`): a **read-only convenience** — the human wants to
  check out and run the PR locally. Validate routing (owner/repo/issue/controlCommentId) but **do NOT treat
  \`txn\` as a gate, do NOT post any comment, do NOT touch labels or the control block, do NOT change
  stage/gate/pending**. Simply call **\`open_pr_session\`** for \`artifacts.impl.prNumber\` on the
  deterministic branch \`agent-loop/issue-<n>\` so the PR is checked out in a session the human can build
  and run however that project runs. \`open_pr_session\` opens the PR's **current head** (that is the point —
  the human wants to run the live branch); it does not need to equal the reviewed \`headSha\`, and it never
  affects the Ship head-pin (Ship stays fail-closed on the reviewed revision independently). \`refresh\`
  (optional) and idle. This never advances the loop, spends no stage tokens beyond the call, and is safe to
  invoke repeatedly (including while the gate is open).

## Guardrails
- **Idle only at gates.** Between a human action and the next gate you run subagents; you never idle
  mid-stage and you never poll. The only idle states are the four gates, \`stage:done\`, and \`error\`
  (awaiting a human Retry).
- **The issue is the single source of truth.** Every human decision and every artifact is a durable
  comment; machine state is the control block; prototype HTML (hash-pinned) is the sole local artifact.
  Read context from the issue, never from transient prompt text or agent memory.
- **Three markers, never shared:** \`AL-IN\` for human input, \`AL-OUT\` for stage artifacts (its post is a
  stage's commit point), \`AL-SYS\` for orchestrator system notes (never a commit point).
- **You own all mutations; the canvas only reads.** Never ask the canvas to write GitHub.
- **Validate once at entry; correlate by \`opId\` after.** Do the routing/\`txn\`/gate entry check a single
  time when the wake begins, before you claim the op (see "txn + routing correlation"). Once you've
  written the \`working\` state — which **bumps \`txn\`** — do **not** re-compare the prompt's \`txn\`;
  every subsequent mutation in this wake is authorized by \`pending.opId\` correlation instead. Always
  validate a subagent's return before opening a gate; never open a gate on unvalidated output.
- **Follow the transition protocol.** Post the \`AL-IN\` and set \`pending\` + write the control block
  \`working\` before running a subagent; post the \`AL-OUT\` then write the control block \`last\`, clearing
  \`pending\`. On wake, if \`AL-OUT\` exists finish without re-running; else re-run the SAME \`opId\`.
- **One PR, one branch for the whole implement/finalize phase;** deterministic branch
  \`agent-loop/issue-<n>\`; look it up (\`--state all\`) before ever creating a PR; commit trailer carries
  \`opId\`; \`gh pr ready\` only when \`isDraft\`.
- **Keep the issue human-readable** — prose in normal comments (emoji headings fine); machine state only
  in the control block; the canvas UI itself stays emoji-free.
- Always \`refresh\` the canvas after a transition (and before each subagent) so the human sees the
  current state immediately.
`;
