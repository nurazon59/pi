# pi

Personal [Pi](https://pi.dev/) extensions.

## Extensions

- `statusline`: custom status line
- `ask-user`: interactive question UI
- `plan-mode`: planning and review UI
- `compact-tools`: compact tool rendering
- `contextual-ctrl-p`: Vim editor and contextual Ctrl+P behavior

## Installation

Clone this repository to `~/src/github.com/nurazon59/pi` and install its dependencies:

```sh
mise exec -- npm ci --omit=peer
```

The dotfiles Pi settings reference this local package, so changes here are picked up after `/reload` or a restart. Runtime settings, keybindings, themes, and the `pi-vim-keys` configuration remain managed by dotfiles.

For a Git-based installation instead, configure `git:github.com/nurazon59/pi` as the package source. This uses a managed checkout rather than the local working tree; update it with `pi update`. Do not configure both sources at once.
