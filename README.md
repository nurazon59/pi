# pi

Personal [Pi](https://pi.dev/) extensions.

## Extensions

- `statusline`: custom status line
- `ask-user`: interactive question UI
- `plan-mode`: planning and review UI
- `compact-tools`: compact tool rendering
- `clear`: `/clear` alias for `/new`
- `contextual-ctrl-p`: Vim editor and contextual Ctrl+P behavior
- `project-memory`: personal project-specific memory loaded at session start

## Installation

Clone this repository to `~/src/github.com/nurazon59/pi` and install its dependencies:

```sh
mise exec -- npm ci --omit=peer
```

The dotfiles Pi settings reference this local package, so changes here are picked up after `/reload` or a restart. Runtime settings, keybindings, themes, and the `pi-vim-keys` configuration remain managed by dotfiles.

For a Git-based installation instead, configure `git:github.com/nurazon59/pi` as the package source. This uses a managed checkout rather than the local working tree; update it with `pi update`. Do not configure both sources at once.

## Project memory

`project-memory` supplements `pi-memory` with a concise personal memory for each project. It stores Markdown files under `${PI_MEMORY_DIR:-~/.pi/agent/memory}/projects/`, within the existing qmd collection. Git repositories are identified by their canonical Git common directory, so subdirectories and worktrees share memory; non-Git directories use their canonical starting directory. Separate clones have separate memories.

Use the `project_memory` tool to read or replace the current project's memory. Writes replace the complete file and are limited to 4,000 characters. Read before updating and preserve relevant facts. If another session changes the file, reload before writing to avoid overwriting its changes. Files edited externally are loaded on the next session start or `/reload`.

A session snapshots the project memory at startup and refreshes it after a successful tool write. Current code, `AGENTS.md`, and explicit user instructions take precedence over the snapshot. Changes are indexed in the background when `PI_MEMORY_QMD_UPDATE` is `background` (the default); `manual` or `off` disables automatic indexing. Existing `pi-memory` tools and their data remain unchanged.
