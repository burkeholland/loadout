# loadout

A loadout of shareable GitHub Copilot skills and canvas extensions.

## Allowlist

[`loadout.json`](loadout.json) is the explicit allowlist of shareable assets in
this repository. The canonical installers below use the individual asset paths.

| Asset | Type | Purpose |
| --- | --- | --- |
| [`skills/issue`](skills/issue) | Skill | Write short, clear GitHub issues. |
| [`skills/postrboard`](skills/postrboard) | Skill | Apply the Postrboard design language to frontend work. |
| [`canvases/agent-loop`](canvases/agent-loop) | Canvas | Run a human-controlled build loop backed by a GitHub issue. |
| [`canvases/sqlite`](canvases/sqlite) | Canvas | Browse SQLite databases and run SQL. |

The repository can also contain project-scoped extensions. For example, if
`.github/extensions/winget-manager` exists, it is a project extension and is
not installed by this user loadout script.

## Canonical installs without cloning

Use the official installers when you want a normal user install from GitHub.
These commands do not need a local `X:\loadout` checkout.

### GitHub CLI

`gh skill` is in public preview and needs GitHub CLI 2.90.0 or later. Preview a
skill before you install it:

```powershell
gh skill preview burkeholland/loadout issue
gh skill install burkeholland/loadout issue --scope user
gh skill install burkeholland/loadout postrboard --scope user
```

### Copilot CLI

Add a skill source with the command line:

```powershell
copilot skill add https://github.com/burkeholland/loadout/tree/main/skills/issue
copilot skill add https://github.com/burkeholland/loadout/tree/main/skills/postrboard
```

Inside an active Copilot CLI session, the same operation is available with
`/skills add <URL|DIRECTORY>`.

### Skills CLI

The optional `skills` CLI supports a symlink install. If it asks for an
installation method, choose **Symlink** and not **Copy**:

```powershell
npx skills add burkeholland/loadout `
  --skill issue --skill postrboard `
  --global --agent github-copilot
```

Remote installs are the simple distribution path. They fetch the repository
content and do not follow later edits in `X:\loadout`.

## Canvas installs

Canvas extensions use the Copilot app's `install_extension` command. The
`scope:user` install is available in every project. Use `scope:project` for a
project-scoped extension:

```text
install_extension url:https://github.com/burkeholland/loadout/tree/main/canvases/sqlite scope:user
install_extension url:https://github.com/burkeholland/loadout/tree/main/canvases/agent-loop scope:project
```

Plugins are a separate Copilot app package mechanism. An extension under
`.github/extensions` is project-scoped; it is not a plugin.

Reload Copilot extensions or restart the session after a canvas installation.

## Contributing

Add a self-contained asset under `skills/` or `canvases/`, add its required
file, then add its path to `loadout.json`. Do not add an asset to the manifest
until its source directory and required file are checked in.
