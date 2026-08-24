# CLAUDE.md

A Paseo plugin that adds a **GitHub** sidebar surface: the signed-in user's open issues, draft pull
requests, open pull requests, and discussions, in four columns.

The repo root `CLAUDE.md` covers what every plugin here shares: the per-folder npm layout, the
typecheck/reload loop, the client/server bundle split, and the constraints nothing catches at
compile time. This file covers only what is specific to `github-board`.

## Orientation

| File               | What it owns                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| `index.ts`         | Wiring only — binds the three RPC contracts and registers the sidebar surface. |
| `board.shared.ts`  | The zod contracts, and the `BoardItem` shape both halves agree on.          |
| `board.server.ts`  | Every `gh` subprocess, the settings file, and the server-side board cache.  |
| `board.client.tsx` | The surface: columns, cards, the repository filter, and the client cache.   |
| `README.md`        | What the board shows a user, and which query backs each column.             |

## Checking a `gh` query against reality

There is no test script and no UI harness here, so a clean `npm run typecheck` plus a clean
`paseo plugin reload github-board` prove the code compiles and loads, nothing more.

The server half is checkable on its own, though: everything it imports from `board.shared` is an
`import type`, so it transpiles to a module with no runtime dependency beyond Node built-ins.

```bash
npx tsc board.server.ts --module esnext --target es2022 --moduleResolution bundler \
  --outDir /tmp/gbcheck --skipLibCheck
# then call loadBoardHandler from a throwaway .mjs in that directory, and delete it after
```

Run it with `PASEO_HOME` pointed at a scratch directory so a throwaway never writes the real
`settings.json`.

## The `gh` calls

Shells out to `gh` via `execFile` on the **daemon machine**, not the device running the app, so `gh`
must be installed and authenticated there.

Three calls per refresh, not four: both PR columns split one search result by `isDraft`. That search
is `gh api graphql` rather than `gh search prs`, because `closingIssuesReferences` — the link from a
pull request to the issues it closes — has no `gh search` field.

Each column is fetched independently and carries its own `error`, so a missing `read:discussion`
scope blanks one column instead of the board. Preserve that when adding columns.

`@me` is always resolved to a concrete login before any query runs, because GitHub's search types
disagree about the alias. Login precedence: header field → saved settings → `gh`'s authenticated
account.

## Issues folded into their pull requests

An issue claimed by an open pull request is dropped from the Issues column and rendered as an
`Issue #123` pill on the pull request card. The claiming happens in the client's `columns` memo,
*after* the repository filter, so a pull request the filter hides stops claiming its issue instead
of taking the issue's card off the board with it. Drafts claim too.

## Settings and caching

Settings persist to `$PASEO_HOME/plugins/github-board/settings.json`, defaulting to `~/.paseo`, and
hold both `login` and the repository filter's `hiddenRepositories`. Two handlers write that one
file, so both go through `updateSettings`, which read-modify-writes — a whole-file write from either
would drop the other's key.

A plugin surface unmounts whenever the user switches workspaces, so anything that should outlive
that (the repository filter) belongs in settings, not component state. The same unmount is why both
halves cache the board for five minutes — module scope in `board.client.tsx` for an instant repaint,
and a keyed value in `board.server.ts` so a cold mount still skips the three `gh` calls. `force` on
`board.load` is the Refresh button bypassing both. Keep `hiddenRepositories` out of the server's
cached value: settings are read per load, or a filter saved after that board was built comes back
stale on the next hit.

The client bundle's module scope surviving an unmount is an assumption about the host, not a
guarantee — the server cache is what makes the speedup hold if it turns out to be wrong. The board's
filter rides along in the `board.load` response and is adopted once, guarded by a ref: later
refreshes must not overwrite a selection the user is mid-way through changing.
