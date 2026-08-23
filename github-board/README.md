# paseo-github-board

A Paseo plugin that adds a **GitHub** sidebar surface showing your work in four columns:

| Column | Source |
| --- | --- |
| Issues | `gh search issues --author <login> --state open` |
| Draft PRs | `gh search prs --author <login> --state open`, filtered to `isDraft` |
| Open PRs | the same search, filtered to non-draft |
| Discussions | `gh api graphql`, `search(type: DISCUSSION)` |

Both pull request columns come from one search, so the board makes three `gh`
calls per refresh, not four.

## Requirements

- **Paseo 0.5.0-beta or newer.** The plugin system does not exist in 0.4.0 —
  there is no `paseo plugin` command to install this with.
- `gh` installed and authenticated **on the daemon machine**, not the device
  running the app. Handlers run in a subprocess next to the daemon.

## Install

```bash
git clone https://github.com/gpambrozio/paseo-plugins.git
cd paseo-plugins/github-board
npm install
npm run typecheck
paseo plugin install "$PWD"
```

`install` records the directory, so keep the clone where it is — the daemon loads the plugin from
that path every time it starts.

The daemon needs `"pluginsEnabled": true` in its `config.json`. Run `paseo reload` after changing
it. Plugin code is trusted and unsandboxed: the server half shells out to `gh` on the daemon
machine and the client half runs inside the Paseo app.

## Develop

```bash
npm run typecheck
paseo plugin reload github-board   # after any source change
paseo plugin logs github-board     # load errors and stderr
```

## Which account the board follows

The login resolves in this order:

1. the login typed into the header field (persisted on **Set**),
2. the saved login at `$PASEO_HOME/plugins/github-board/settings.json`,
3. the account `gh` is authenticated as.

`@me` is always resolved to a concrete login before any query runs, because
GitHub's search types disagree about the alias and an unresolved `@me` in the
header tells you nothing about which account you are looking at.

## Known limits

- **Discussions are authored-only.** GitHub's discussion search accepts
  `author:` but silently returns nothing for `involves:` and `commenter:`, so
  there is no "discussions I participated in" column to build.
- **Issues and PRs are authored-only too**, for symmetry. Swapping `--author`
  for `--involves` in `board.server.ts` widens them to anything you touched.
- Each column caps at `limit` (default 30, max 100) items.
- A column that fails renders its own error; the other three still load.
