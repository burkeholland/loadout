# Agent Loop canvas (project extension)

A deterministic human-in-the-loop build loop backed by a GitHub issue. The
issue, comments, labels, and one control-block comment are the durable state.
The extension owns orchestration; agents only generate assets and submit them
back through the existing canvas action.

## Flow

`kickoff → research → prototype → sign-off → questionnaire → plan review → implement → feedback → finalize → done`

Human buttons POST structured `/intent` JSON. The coordinator validates the live
control block, writes `AL-IN`/`AL-OUT`/`AL-SYS` comments, updates the control
block, reconciles labels, mints `opId`/submission capabilities, and sends exact
self-contained work orders with `session.send`.

The idle launcher also reads `GET /issues`, which returns the five most recently
updated open Agent Loop issues from the canvas session's repository. Selecting
one sends `open-existing`; code validates its label and canonical control block,
then binds that canvas instance without changing workflow state or waking an
agent.

Agents must not mutate Agent Loop issue state. A work order tells them what to
read, what asset to produce, and to call:

```json
{ "opId": "...", "submissionToken": "...", "artifact": { } }
```

via `submit_stage` on the already-open canvas instance.

Each newly opened canvas starts unbound at the launcher, even when `active.json`
points to a previous workflow. Selecting or starting a build binds only that
canvas server, so another canvas cannot retarget an existing window.

Agents inherit the user's repository credentials and therefore remain a trusted
asset generator. The coordinator rejects workflow markers and control fields in
submitted artifacts, but it cannot prevent a deliberately rogue agent from
using those credentials outside the supplied work order.

## Files

| File | Role |
| --- | --- |
| `extension.mjs` | Canvas declaration, read-only actions, `submit_stage`, and work-order delivery. |
| `workflow.mjs` | Explicit deterministic coordinator, control/comment rendering, transition logic, validation, queues, recovery, and work-order contracts. |
| `server.mjs` | Loopback HTTP backend: `/state`, `/issues`, `/intent`, `/events`, `/comment`, `/pr`, `/open`, and asset serving. `/prompt` is not registered. |
| `github.mjs` | `gh` read/mutation helpers using argv/stdin, parsers, label reconciliation, and PR reads. |
| `webview.mjs` | UI panels and structured intent payloads. |
| `pr.mjs` | Pure PR review snapshot/check/diff helpers. |

Prototype and demo assets are served from `~\.agent-loop\work\<owner>\<repo>\<issue>\...` and are hash/containment validated before state advances.
