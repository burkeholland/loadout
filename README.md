# loadout

A loadout of shareable **GitHub Copilot** capabilities — canvases, skills, and custom agents you
can drop into any project.

Everything here is self-contained. Grab a single folder; nothing depends on the repo root.

## Artifacts

| Artifact | Type | What it does | Install |
| --- | --- | --- | --- |
| [`agent-loop`](canvases/agent-loop) | Canvas | Human-in-the-loop, multi-agent build loop (kickoff → research → prototype → sign-off → …) rendered as an in-app canvas, backed by a GitHub issue. | `install_extension` (see below) |
| [`postrboard`](skills/postrboard) | Skill | Applies the Postrboard design language to frontend work — quiet CSS for loud products; restrained, code-native, non-generic. | Copy folder (see below) |

## Installing by type

### Canvases

Point the Copilot CLI's `install_extension` at the canvas folder in this repo:

```
install_extension url:https://github.com/burkeholland/loadout/tree/main/canvases/agent-loop scope:user
```

Use `scope:user` to make it available in every project, or `scope:project` to install it into the
current repo under `.github/extensions/`. Each canvas has its own README with details.

### Skills

Copy the skill folder into your personal skills directory:

```
~/.agents/skills/<name>/
```

For example, drop `skills/postrboard/` in as `~/.agents/skills/postrboard/`. Reload (or restart)
Copilot and the skill is available.

### Agents

Copy the agent `.md` file into `.github/agents/` in your repo (or your personal agents directory).

## Contributing

Add a new artifact as a self-contained folder under `canvases/`, `skills/`, or `agents/`, give it
its own README (or front matter, for skills/agents), then add a row to the table above.
