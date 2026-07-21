# Agent Loop canvas (project extension)

A human-in-the-loop, multi-agent **build loop** as an in-app canvas. An idea goes
**kickoff → research → prototype → sign-off** through a chain of specialist agents, with the
human weighing in only at the gates. The canvas is the interface; a GitHub **issue** is the
backing store; an **orchestrator session** conducts.

This extension is **portable** — drop it into any repo and it builds in *that* repo. It has no
hardcoded owner/repo; the target is detected at kickoff (`gh repo view`) and tracked in
`~/.agent-loop/active.json`.

## Install it

Point the CLI's `install_extension` at this folder in the [loadout](https://github.com/burkeholland/loadout)
repo:

```
install_extension url:https://github.com/burkeholland/loadout/tree/main/canvases/agent-loop scope:user
```

Use `scope:user` to make it available in every project, or `scope:project` to install it into the
current repo under `.github/extensions/agent-loop/`. You can also just copy this folder into
`.github/extensions/agent-loop/` by hand — the Copilot CLI auto-discovers project extensions there.

Then:

1. Make sure `gh` is authenticated for the repo (`gh auth status`) — the canvas reads GitHub for
   free using your `gh` token, and the orchestrator writes to it.
2. Reload extensions (or restart the CLI). The `agent-loop` canvas becomes available.

## Run a job

1. Open a session in the project and have it **act as the Agent Loop orchestrator** (follow
   `ORCHESTRATOR.md` at the repo root). That session opens the `agent-loop` canvas —
   *the session that owns the canvas is the conductor* (Model A).
2. In the canvas idle panel, type an idea (e.g. *"a date picker web component"*) and click
   **Start the loop**. The canvas sends that as a kickoff prompt to the orchestrator.
3. Watch the pipeline strip. Research runs, then prototype options arrive at the **sign-off**
   gate. **Refine** (describe changes → a new round) or **Approve** (advance). The pipeline
   strip doubles as read-only nav — click a completed stage to review its artifact.

## What's in here

| File | Role |
| --- | --- |
| `extension.mjs` | Canvas declaration + actions (`refresh`/`get_state`/`get_config`/`get_playbook`/`set_active`), `joinSession`, and the `session.send` handoff that delivers canvas prompts to the orchestrator. |
| `server.mjs` | Local HTTP backend: serves the webview, proxies GitHub reads via `gh`, serves prototype assets from `~/.agent-loop/work/…`, proxies live prototype previews (`/prototype?url=` with a `<base>` + height-report inject), exposes `/state` (poll) + `/events` (SSE) + `/prompt` + `/open`. |
| `webview.mjs` | The vanilla-JS UI: pipeline strip + idle/working/sign-off/done panels, in-canvas live prototype previews, the sticky decision bar, and read-only stage review. |
| `github.mjs` | `gh`-backed read helpers + control-block and prototype-comment parsing. |
| `playbook.mjs` | The embedded conductor playbook (served via the `get_playbook` action) so the orchestrator doesn't depend on a repo file. |
| `postrboard-css.mjs` | The [Postrboard](https://burkeholland.github.io/postrboard-design/) design system, vendored inline so the canvas renders offline for private repos. The UI is built from its tokens/components with light + dark modes. |

The orchestrator playbook, stage-agent contracts, and control-block spec are **embedded in
`playbook.mjs`** and served to the orchestrator via the `get_playbook` action — the extension is
fully self-contained and needs no companion files in the target repo.

## Notes

- **One active job at a time.** `active.json` tracks a single current issue; the work dir is
  namespaced `~/.agent-loop/work/<owner>/<repo>/<issue>/round-<N>/<option>/`.
- **Private-repo friendly.** Prototypes are served locally (not committed, no public preview),
  so it works for private repos where GitHub Pages wouldn't.
- The code repo only ever receives the **final PR** (implementation stage — later).
