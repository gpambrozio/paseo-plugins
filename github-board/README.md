# paseo-github-board

A Paseo plugin that adds a **GitHub** sidebar surface showing your work in four columns:

| Column | Source |
| --- | --- |
| Issues | `gh search issues --author <login> --state open` |
| Draft PRs | `gh api graphql`, `search(type: ISSUE)` for `is:pr state:open`, filtered to `isDraft` |
| Open PRs | the same search, filtered to non-draft |
| Discussions | `gh api graphql`, `search(type: DISCUSSION)` |

Both pull request columns come from one search, so the board makes three `gh`
calls per refresh, not four. Pull requests go through GraphQL rather than
`gh search prs` because only GraphQL exposes `closingIssuesReferences` — see
below.

![The GitHub board: Issues, Draft PRs, Open PRs, and Discussions columns, with a
login field and Refresh button in the header.](docs/screenshot.png)

## Issues folded into their pull requests

An issue that already has an open pull request against it is the same piece of
work as that pull request, so it gets one card, not two: the issue drops out of
the **Issues** column and shows up as an accent-coloured `Issue #123` pill on
the pull request card. Drafts count — the work exists either way — so a draft
pull request claims its issue too.

The link is GitHub's own `closingIssuesReferences`, which sees both closing
keywords in the pull request body (`Closes #123`) and issues attached by hand
from the Development panel. A pill reads `Issue owner/name#123` when the issue
lives in another repository.

The fold happens after the repository filter, so hiding a pull request's
repository puts its issue back on the board rather than taking both cards away.

## Filtering by repository

The header dropdown next to **Set** lists every repository with a card anywhere
on the board and filters all four columns at once. Everything starts selected;
**All** and **None** set the whole list.

The selection saves to the same `settings.json` as the login, because the
surface unmounts on every workspace switch and component state would not
survive it. It is stored as the *hidden* repositories rather than the visible
ones, so a repository the filter has never seen — a new one, or one whose first
card only appears on a later refresh — arrives selected rather than silently
filtered out.

## Caching

Revisiting the board does not re-run `gh`. Two caches sit in front of it, both
in memory and both five minutes:

- The surface keeps the last board at module scope, so a workspace switch —
  which unmounts it — repaints instantly. Past the window the stale board stays
  on screen while a refresh runs underneath it.
- The handler keeps the last board per login, so even a cold mount usually skips
  the three `gh` calls. A board with a failed column is not cached, so the retry
  is not held off for five minutes.

**Refresh** bypasses both. The repository filter is read from settings on every
load and is never part of the cached board, so changing it cannot be undone by
a cache hit.

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

The settings file holds `login` and `hiddenRepositories`, and each handler
merges rather than overwrites, so saving one never drops the other. A file from
an older version with only `login` is read and upgraded in place.

`@me` is always resolved to a concrete login before any query runs, because
GitHub's search types disagree about the alias and an unresolved `@me` in the
header tells you nothing about which account you are looking at.

## Known limits

- **Discussions are authored-only.** GitHub's discussion search accepts
  `author:` but silently returns nothing for `involves:` and `commenter:`, so
  there is no "discussions I participated in" column to build.
- **Issues and PRs are authored-only too**, for symmetry. Widening them to
  anything you touched means `--involves` for the issues search and `involves:`
  in the pull request query, both in `board.server.ts`.
- Each column caps at `limit` (default 30, max 100) items. An issue whose pull
  request falls past that cap keeps its own card, since nothing on the board
  claims it.
- A column that fails renders its own error; the other three still load.
