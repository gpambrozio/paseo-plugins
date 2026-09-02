# paseo-github-board

A Paseo plugin that adds a **GitHub** sidebar surface showing your work — and the
work waiting on you — in four columns:

| Column | Source |
| --- | --- |
| Issues | `gh api graphql`, `search(type: ISSUE)` for `is:issue state:open` |
| Draft PRs | `gh api graphql`, `search(type: ISSUE)` for `is:pr state:open`, filtered to `isDraft` |
| Open PRs | the same search, filtered to non-draft |
| Discussions | `gh api graphql`, `search(type: DISCUSSION)` |

Every column runs its search **twice**: once for `author:<login>`, and once for
`user:<login>` — everything in the repositories that login owns, whoever opened
it. That second half is why an issue somebody else filed on your own repository
shows up here, and the card names its author when it is not you. GitHub search
ANDs its qualifiers, so the two cannot be folded into one query; they are two
aliased searches inside one `gh api graphql` request instead.

Both pull request columns come from one search, so the four columns cost three
`gh` calls per refresh, not four or six — plus one more for the check runs on
the open pull requests, when there are any. Everything goes through GraphQL
rather than `gh search`, because only GraphQL exposes `closingIssuesReferences`
and `statusCheckRollup` — see below.

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

## Empty columns come off the board

A column with nothing in it is left out: the remaining columns share the full
width, and on a phone the tab bar lists only the tabs that lead somewhere. It is
counted after the repository filter and the issue fold, so filtering a repository
down to nothing, or a pull request claiming the last issue, takes that column
with it.

A column that **failed** to load stays, error and all — it is empty because the
query broke, not because there is no work. And when every column is empty the
whole board comes back, four "Nothing here." columns saying it loaded and found
nothing.

## Checks on open pull requests

An open pull request card leads its footer with the state of CI on the head
commit, the same three counts Paseo's own sidebar shows on a workspace:

| Pill | Means |
| --- | --- |
| `✓ 12` | checks that passed |
| `✕ 1` | checks that failed, timed out, or need action — in the theme's danger colour |
| `● 3` | checks still queued or running, in the accent colour |

An outcome nobody has is left out, so a green pull request shows one pill rather
than two zeroes, and a pull request whose head commit nothing reported on shows
none at all. Skipped and cancelled checks are counted nowhere: they are neither
a result nor something to wait for. Where a check has been re-run, only the
latest attempt counts.

**Draft pull requests show no checks.** A draft says the work is not finished,
so its CI is not yet anyone's business — and asking for fewer pull requests
keeps the extra request small.

The checks are a **separate `gh` call** from the search on purpose. A token
without permission to read checks — a fine-grained PAT, usually — makes GitHub
fail the whole GraphQL request, and folding the rollup into the search would
turn that into two blank pull request columns. On its own, it costs only the
pills, and the reason lands in `paseo plugin logs github-board`.

Checks are cached with the rest of the board for five minutes; **Refresh** is
what re-reads a run that has finished since.

## Configuring the prompts

The **gear button** in the header opens the settings view. It holds the GitHub
login the board queries for, and the first message each kind of card is sent
with:

| Column | Default prompt |
| --- | --- |
| Issues | `Read issue {url}, investigate and give me ways to address it.` |
| Draft PRs | `Read draft pull request {url} and help me finish it.` |
| Open PRs | `Review pull request {url} and tell me what needs attention.` |
| Discussions | `Read discussion {url} and summarise what is being decided.` |

Templates can use `{url}`, `{title}`, `{number}` and `{repository}`. Anything
else in braces is passed through untouched. A template is only the starting
point — the launch dialog lets you rewrite the message before it is sent.

Pick a Paseo project from the row of chips to override those four prompts for
that project alone; a dot on a chip means it has overrides. Cards are matched to
a project by the repository's git remote, the same way sending one is — so a
fork and the repository it was forked from share one set of prompts, and a
repository with no project needs none, since it cannot be sent anywhere either.

**Clearing a field is how you reset it** — a blank project prompt falls back to
the one for all projects, and a blank prompt for all projects falls back to the
built-in default above. Nothing is saved until you press **Save prompts**.

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

## Reading a card

**Click a card** and it opens in a panel beside the board — the right half of the surface, or the
whole of it on a phone. The panel shows the title, who opened it, the comment count, the labels,
a pull request's branches, and the description rendered from its Markdown, followed by the
assignees. A pill in the panel's header says whether the item is still open, or has been closed or
merged since the board was fetched.

**Open on GitHub** is in the panel, next to **Send to chat**, so nothing the card used to do is
gone — it is one press further away. **Refresh** reloads the description if it was edited on
GitHub in the meantime; otherwise the panel remembers what it fetched for five minutes.

A **Load comments** button at the foot of the panel fetches the conversation — the comments on an
issue or pull request, or a discussion's comments with their replies indented under them. It shows
the first 50 and says so if there are more; pull request review comments on the diff are not
included. Refresh reloads the comments too once they have been loaded.

Screenshots pasted into the description or a comment are shown in the panel, including
attachments on private repositories, which the plugin fetches through `gh` on the daemon. Press
one to open the original.

While the panel is open the cards beside it still work: clicking another one swaps the panel to
it, and the open card is outlined so you can see which one you are reading.

## Labels

**Right-click** an issue or pull request card — **long-press** on a phone or tablet — and its
repository's labels open where you clicked. Press a label to add it, press it again to remove it.
Each press is applied to GitHub straight away and the card's pills update with whatever GitHub
reports back, so a label a teammate added in the meantime shows up rather than being wiped by your
edit.

Discussions have no label menu. Cards show three labels and then a `+2`, so an edit past the third
is still visible as a change.

Editing labels needs a `gh` login with write access to the repository; without it the menu says so
and leaves the label alone. The menu lists the repository's first 100 labels by name, with a filter
box once there are more than eight.

## Send to chat

Hover a card and a **Send to chat** button appears in its bottom-right corner.
It opens a **New workspace** dialog, the same choices Paseo asks for when you
start a chat yourself:

- **Local** or **New worktree** — a worktree is offered only for git projects.
- The **agent**, picked the way Paseo picks one: a menu of providers with their
  model counts, then that provider's models behind a back arrow, with a search
  box that ranks across every provider.
- **Thinking**, for models that have levels, and the **permission mode**, for
  providers that have modes. Both follow the model you pick.
- The **first message**, pre-filled from that column's prompt template and
  yours to rewrite.

Press **Send** and the plugin creates the workspace on the project checked out
from that card's repository, titled after the issue, pull request or discussion,
starts the agent you chose in it, sends your message, and opens the new
workspace in the app.

Your choices are remembered, so the next card opens on the same agent. A model
or provider that has since disappeared quietly falls back to what the host
actually offers.

If no project has a git remote pointing at the repository, the dialog says so
and creates nothing.

The host is not one of the choices: a plugin surface talks to the daemon it was
installed on, and the board is that daemon's `gh`. Use the host switcher in the
surface header to work from another one.

On phones and tablets there is no hover, so the button is always visible.

## Caching

Revisiting the board does not re-run `gh`. Two caches sit in front of it, both
in memory and both five minutes:

- The surface keeps the last board at module scope, so a workspace switch —
  which unmounts it — repaints instantly. Past the window the stale board stays
  on screen while a refresh runs underneath it.
- The handler keeps the last board per login, so even a cold mount usually skips
  the `gh` calls. A board with a failed column is not cached, so the retry
  is not held off for five minutes.

**Refresh** bypasses both. The repository filter is read from settings on every
load and is never part of the cached board, so changing it cannot be undone by
a cache hit.

## Requirements

- **Paseo 0.5.0-beta or newer.** The plugin system does not exist in 0.4.0 —
  there is no `paseo plugin` command to install this with. The board itself
  needs 0.5.2, which is where the daemon learned to list projects.
- **Paseo 0.7.0-beta.3 or newer to open a chat without a page reload.** That
  release lets a plugin ask the app to navigate. Older apps still land on the
  new agent, by way of a deep link that reloads the app on web and desktop.
  This one is gated on the app, not the daemon, so an up-to-date desktop and an
  older phone can differ while talking to the same daemon.
- `gh` installed and authenticated **on the daemon machine**, not the device
  running the app. Handlers run in a subprocess next to the daemon.

## Install

```bash
paseo plugin add gpambrozio/paseo-plugins --path github-board
```

This repository holds two plugins, hence `--path`. The daemon clones it under `$PASEO_HOME/plugins`
and runs no package manager — the plugin is source only, and everything it imports at runtime the
host provides. Pin a release with `--ref <tag>`; later, `paseo plugin status` and
`paseo plugin update github-board` follow the branch.

To hack on it instead, install from a clone of your own:

```bash
git clone https://github.com/gpambrozio/paseo-plugins.git
cd paseo-plugins/github-board
npm install
npm run typecheck
paseo plugin install "$PWD"
```

`install` records the directory, so keep that clone where it is — the daemon loads the plugin from
that path every time it starts. `npm install` is for the typecheck; installing needs none of it.

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

The settings file holds `login`, `hiddenRepositories`, the `prompts`, and the
`launch` defaults the send dialog reopens on, and each handler merges rather
than overwrites, so saving one never drops the others. A file from an older
version with only `login` is read and upgraded in place.

`@me` is always resolved to a concrete login before any query runs, because
GitHub's search types disagree about the alias and an unresolved `@me` in the
header tells you nothing about which account you are looking at.

## Known limits

- **Nothing you merely participated in appears.** Every column is what you
  authored plus what is open on repositories you own; a thread you only
  commented on elsewhere is neither. GitHub's discussion search silently returns
  nothing for `involves:` and `commenter:`, so a "discussions I participated in"
  column cannot be built at all; for issues and pull requests it would mean a
  third aliased `involves:<login>` search in `board.server.ts`.
- **"Repositories you own" means `user:<login>`.** An organisation whose
  repositories you maintain but do not own contributes only what you authored
  yourself. Widening that means an `org:` search per organisation, and a list of
  organisations to keep somewhere.
- Each column caps at `limit` (default 30, max 100) items — both halves of the
  search are allowed that many rows, and the merged column is cut back to one
  budget's worth of the most recently updated. An issue whose pull request falls
  past that cap keeps its own card, since nothing on the board claims it.
- A column that fails renders its own error; the other three still load.
- **The label menu offers existing labels only**, the first 100 by name. Creating a
  label, or renaming one, still happens on GitHub.
- **Only a provider that names its models can be picked.** Paseo creates agents
  as `provider/model`, so a provider that offers no selectable model is left out
  of the agent list rather than shown and then refused.
- **Send to chat matches a repository against every git remote** of every
  project — `origin` first, then the rest. A pull request you opened from a fork
  lives in the upstream repository, so it matches the fork you have checked out
  only if that checkout keeps the upstream as a remote, which `gh repo clone`
  and `gh repo fork` both set up. A project with no remote pointing at the
  card's repository will not match.
