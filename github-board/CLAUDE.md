# CLAUDE.md

A Paseo plugin that adds a **GitHub** sidebar surface: open issues, draft pull requests, open pull
requests, and discussions, in four columns — what the signed-in user wrote, plus what is open on the
repositories they own.

The repo root `CLAUDE.md` covers what every plugin here shares: the per-folder npm layout, the
typecheck/reload loop, the client/server bundle split, and the constraints nothing catches at
compile time. This file covers only what is specific to `github-board`.

## Orientation

| File               | What it owns                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| `index.ts`         | Wiring only — binds the twelve RPC contracts and registers the sidebar surface. |
| `board.shared.ts`  | The zod contracts, and the `BoardItem` shape both halves agree on.          |
| `board.server.ts`  | Every `gh` subprocess, the settings file, and the server-side board cache.  |
| `board.client.tsx` | The surface: columns, cards, the detail panel, the repository filter, and the client cache. |
| `markdown.client.tsx` | The renderer for an item's Markdown body; only the detail panel uses it.  |
| `html.client.tsx`  | Rewrites the HTML in a body into Markdown before the renderer parses it.    |
| `image-host.ts`    | Unsuffixed, in both bundles: which image hosts the daemon fetches for the app. |
| `README.md`        | What the board shows a user, and which query backs each column.             |

## Checking a `gh` query against reality

There is no test script and no UI harness here, so a clean `npm run typecheck` plus a clean
`paseo plugin reload github-board` prove the code compiles and loads, nothing more.

The server half is checkable on its own, though: everything it imports from `board.shared` is an
`import type`, so it transpiles to a module with no runtime dependency beyond Node built-ins.

```bash
npx tsc board.server.ts --module esnext --target es2022 --moduleResolution bundler \
  --outDir /tmp/gbcheck --skipLibCheck --types node --ignoreConfig
# then call loadBoardHandler from a throwaway .mjs in that directory, and delete it after
```

`board.server.ts` also imports `./image-host` at runtime, so pass `image-host.ts` to `tsc` as
well, and add the `.js` extension to that one import in the emitted `board.server.js` before
running it — the bundler resolves extensionless imports, plain Node does not.

Run it with `PASEO_HOME` pointed at a scratch directory so a throwaway never writes the real
`settings.json`.

## The project index

`loadProjectIndex` builds one map of `<host>/<owner>/<name>` to project and caches it for five
minutes. Both callers share it: the board, to label each card's project, and the send button, to
find the directory to create a workspace on. Before it existed the remote scan ran per lookup.

It is filled in two passes and the order is load-bearing: every project's `projectKey` first, then
the other remotes, and only where nothing has already claimed the id. That way a repository that is
one project's `origin` and another's `upstream` resolves to the one it belongs to.

`findProject` retries a miss against a freshly built index, so a project added moments ago is found
rather than denied for the rest of the cache window.

## The `gh` calls

Shells out to `gh` via `execFile` on the **daemon machine**, not the device running the app, so `gh`
must be installed and authenticated there.

Three search calls per refresh, not four: both PR columns split one search result by `isDraft`.
Every search is `gh api graphql` rather than `gh search`, because `closingIssuesReferences` — the
link from a pull request to the issues it closes — has no `gh search` field, and because two
searches can share one request as aliases (below). A fourth call fetches the check runs on the open
pull requests, and only when there are any; it is separate for a reason, below.

**Each column is two searches, `author:<login>` and `user:<login>`.** The second is what puts other
people's work on the board: an issue filed on a repository you own is yours to answer whether or not
you wrote it. They cannot be one query — GitHub search ANDs qualifiers, so `author:x user:x` is the
*intersection*, narrower than either half. `dualSearchQuery` aliases them into one request instead,
which is what keeps the count at three; `mergeItems` then dedupes the overlap by node id, re-sorts
(each half is sorted only within itself) and cuts back to `limit`, because both halves were allowed
`limit` rows and the column was asked for one budget.

`toItem` carries the author, and the card renders it only when it differs from the board's login —
most of the board is still the viewer's own work, so a byline everywhere would hide the one thing it
is there to say. `viewerLogin` is threaded from `board.login` through `Column` for that comparison.

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

## Empty columns come off the board

The `columns` memo drops any column holding no items, after the repository filter and after the
issue fold, so both can empty a column out of existence. A column whose `error` is non-null is kept:
it is empty because the query failed, and the error is the only thing that says so.

The all-empty case is guarded explicitly — when the filter would leave nothing, every column comes
back. Four "Nothing here." columns are a board that loaded and found nothing, where a blank surface
is indistinguishable from a broken one; on compact they also keep the tab bar and the
`RefreshControl`, which are the only things on that layout that can load the board again.

`cachedColumnId` may name a column that is no longer on the board. `activeColumn` already falls back
to `columns[0]`, and the id is left alone rather than rewritten, so the tab comes back selected once
its column has items again.

## Checks on open pull requests

`BoardItem.checks` is three counts — `passed`, `failed`, `pending` — or null, which is the same
fold Paseo's `getChecksSummaryCounts` does in `workspace-hover-card.tsx`, so the board and the
sidebar cannot disagree about a pull request they both show. Skipped and cancelled runs are counted
nowhere: neither a result nor a wait.

**It is its own `gh api graphql` request, not a field on the pull request search.** A token without
the Checks permission answers `statusCheckRollup` with "Resource not accessible", `gh` treats any
GraphQL error as a failed command, and the rollup lives under the search's own selection — so
asking there would blank Draft PRs *and* Open PRs for those users. `attachChecks` swallows its
failure to `console.warn` instead, which costs pills nobody with that token could have seen anyway.
That is also why it does not go through `settle`: the column already loaded.

The query is `nodes(ids: [...])` over the open pull requests only. GitHub caps `nodes` at 100 ids
and the caller cannot exceed it — `mergeItems` already cut to `limit`, whose own ceiling is 100.
`gh` spells a list variable as a repeated `-f 'ids[]=…'` field. Drafts are skipped deliberately, not
incidentally: a draft's CI is not yet anyone's business, and fewer ids is a smaller request.

`commits(last: 1)` is the head commit — the only one whose checks describe the pull request as it
stands — and the rollup mixes `CheckRun` (a `status` plus a `conclusion`) with `StatusContext` (a
`state`), so both inline fragments are needed or half a repository's CI reads as nothing.

`foldChecks` deduplicates by check name, keeping the highest `recency`, because a re-run leaves the
attempt it replaced in the rollup and counting both reports one check as a failure *and* a pass.
Recency prefers `checkSuite.workflowRun.databaseId`, which orders two attempts before either has a
timestamp, and falls back to `completedAt ?? startedAt`.

`checkRunOutcome` mirrors Paseo's `mapCheckRunStatus` with one deliberate difference:
`STARTUP_FAILURE` counts as failed and `STALE` as ignored, where Paseo's `default` makes both
pending. Both are terminal, and a run reported as still going that will never report again is worse
than a disagreement with the sidebar.

The three counts render as one grouped pill leading the card footer. **Leading, because the footer
wraps** — anything appended lands on a second line — and because the Send button covers the
bottom-right corner. The plugin theme has exactly one status colour, so failure takes `statusDanger`,
still-running takes `accent`, and passed takes `foregroundMuted`; the `✓ ✕ ●` glyphs are what
actually carries the meaning, which is also what makes the summary readable without colour vision.

## The detail panel

A press on a card opens it in a panel over the board — not in the browser, which is what it used to
do. The panel shows what the card already had (title, repository, author, comments, labels, linked
issues, checks) and then fetches what the search never did: the body, the live state, the creation
date, the assignees, and a pull request's branches. **Open on GitHub** is in the panel, next to
**Send to chat**, so both of the card's old actions are one press further away and nothing has
been lost.

**The body is a separate `board.item` call, not a field on the search.** A body is the largest
field an item has, and three columns of thirty would carry ninety of them on every refresh for text
the user reads one at a time. The lookup is `node(id:)` on the card's node id, which resolves any
type without saying which, so one query serves an issue, a pull request and a discussion and the
inline fragments decide which fields come back. The answer is cached on the server for five minutes
by id; `force`, from the panel's Refresh button, bypasses it for a body edited on GitHub since.

`state` is derived, not copied: `MERGED` and `CLOSED` come from `state`, a discussion's from
`closed`, and a draft reads `draft` rather than `open`. The board lists open items only, so the
panel is the first place a card that has since closed says so.

**The panel is positioned inside `body`, not the screen.** `body` is everything under the header,
and the panel is its last child, so it covers the columns by paint order alone and leaves the
header — the filter, Refresh, Configure prompts — reachable while it is open. The label menu and
the modals are still positioned against the screen, because `openLabelMenu` measures `rootRef`.

On the wide layout the panel is the **right half** and the board behind it sits under a scrim
(`detailScrim`): a wash towards `surface0` like the modal backdrop, plus a `backdropFilter` blur
(3px) spread in untyped for the web and desktop renderers — native has no blur without a library the
client bundle cannot import, and keeps the wash. A press on the scrim closes the panel. That means
the board is *not* clickable while the panel is open; it was at first, so a press on a second card
swapped the panel, but a blurred board is not something to read or aim at, and the blur was asked
for. The open card is still drawn with an accent border (`cardSelected`) so the panel reads as
that card's through the blur. On compact the panel is the whole body, there is no scrim, and Close
is the way back.

**Opening and closing are animated on one `Animated.Value`**, `detailProgress`: the scrim's
opacity is the value and the panel's `translateX` interpolates from its laid-out width (or a
fallback at least as far) to zero, so the two can never be out of step. `detailOpen` is the
intent and `detailTarget` is what is drawn: closing sets the intent false and the target is
cleared only when the timing *finishes* — an interrupted close, reopened mid-slide, leaves the
panel where the reopening finds it. `useNativeDriver` is false because the web renderer drives
everything from JavaScript anyway. Opening takes 220ms with an ease-out, closing 160ms with an
ease-in: arriving content gets a beat, a dismissal is just gone.

**The wide panel is resizable** by a `PanResponder` handle astride its left edge, half over the
board so the edge is grabbable from either side. The panel is anchored right, so a drag left grows
it: `start.width - gesture.dx`, clamped between `DETAIL_MIN_WIDTH` and the body's width less
`BOARD_MIN_WIDTH`, so neither side can be dragged out of existence. The body's width comes from
the parent's `onLayout` and is threaded in as `bodyWidth`, null on compact, which is also what
hides the handle. The chosen width is a **share of the body, not pixels** — `cachedDetailFraction` at module scope
for the instant repaint on remount, and `detailWidthFraction` in the settings file for the next
daemon start, saved once per drag by `board.save-detail-width` on release and adopted from
`board.load` only while nothing has been dragged locally since. A share, because the width was
chosen against one window and has to fit a different one — or a different machine, since the
settings live with the daemon. It is turned back into pixels against the body as laid out now and
clamped the same way a drag is, so a share that made sense on a wide window still leaves a column
of board on a narrow one. The drag
start is a ref, not state: the responder is created once and must read the latest value.

**Widening needs two things narrowing does not**, because widening drags the pointer *left*, off
the handle and across the board's columns. First, `onPanResponderTerminationRequest` returns
false: every scroll view the pointer crosses asks for the responder, and the default answer is
yes, which is why the drag used to stop partway. Second, on the web renderer the grant also
installs document-level `pointermove`/`pointerup` listeners (`trackPointerOnDocument`) that drive
the same clamp from `clientX`, so a pointer that outruns the handle, or leaves the window, still
moves the edge; a window `blur` stands in for the release the browser cannot report. Both feed
`applyDelta`, so whichever arrives first wins and they cannot disagree. Native has no `document`
and the helper is a no-op there. The same helper switches `user-select` off on the document body
for the drag's duration and pins the resize cursor there: a drag is a mouse-down plus movement,
which is how a browser starts a text selection, and once the pointer is off the handle every card
title it crosses would otherwise be selected. Both are restored on release. The
`col-resize` cursor is spread in as an untyped extra because React Native's `cursor` type allows
only `auto` and `pointer`; native ignores it.

`detailTarget` holds the pressed card, but the panel renders `detailItem` — the same id looked up
on the current board — so a label edited from the context menu while the panel is up repaints in
it. The panel is keyed by item id: opening a second card must not show the first one's body while
the second loads.

The header's Refresh and Close are icon buttons — `RefreshCw` and `X` through the host's `Icon`,
which takes any Lucide name — each with an `accessibilityLabel`, since the glyph is the whole
label. Icons, because the panel header on the wide layout sits beside the board's own Refresh
button and two "Refresh" words in one row would read as one action twice.

**Comments are a third call, `board.comments`, and only on request.** A button at the foot of the
panel loads them; most panels are opened for the description, and the conversation is an item's
long tail. The query selects `comments` on all three types and, for a discussion, each comment's
`replies` too, flattened with `depth: 1` so the panel can indent them. Pages are 50 comments and 20
replies; `truncated` says a page was full, and the panel points at GitHub for the rest rather than
paging — a thread that long is not read in a half-width panel. A pull request's *review* comments
are a different object and are not fetched. Cached by id for five minutes like the body, and the
panel's Refresh re-requests them with `force` only once they have been asked for
(`commentsRequest` stays null until the button is pressed).

**Images on their own line are rendered, and GitHub-hosted ones come through the daemon.** An
attachment on a private repository — `github.com/user-attachments/assets/…` — answers 404 to
anyone without the token and, with it, a 302 to a signed S3 URL good for five minutes. The app holds
no token, so `board.image` fetches the bytes on the daemon with `gh auth token` and answers a data
URL; `fetch` follows the redirect and drops `Authorization` across origins as the spec says. The
size cap is 4 MB and the server keeps the last 24 by URL. **Only GitHub hosts**, decided by
`isGitHubImageHost` in `image-host.ts` and checked again on the server rather than trusted from
the client: this is the daemon fetching a URL a comment's author chose, so anything else is loaded
by `Image` directly, the way a browser would. A release-asset download URL is not an attachment
and answers 404 even with the token; it is left as the text it was.

`image-host.ts` has no suffix and no Node imports on purpose — it is in both bundles — and it is
kept out of `board.shared.ts` so that file stays type-only to the server, which is what lets the
server half be transpiled and run alone. The standalone check now needs `image-host.ts` passed to
`tsc` alongside `board.server.ts`.

`RemoteImage` measures the image with `Image.getSize` — the callback form; the promise form is
newer than some react-native-web builds and returns nothing there — before rendering it, so the
frame is sized by `aspectRatio` before the bitmap paints and the thread does not jump. Capped at
480pt tall. A press opens the original on GitHub; a failure falls back to the `[image: alt]` link
the panel used to show. The client keeps its own 24-entry cache of fetched images at module scope.

`markdown.client.tsx` renders the body and every comment. It renders pipe tables as rows of
equal-width cells, and a cell that is only an image goes through `renderImage` too: a table of
screenshots, one variant per column, is how a review thread compares them, and it was where most
of the images in the pull request this was built against lived. There is no Markdown library a client bundle can import,
so it covers what an issue body actually uses — headings, lists, task lists, fenced code, quotes,
rules, collapsible `<details>`, and bold, inline code and links — and leaves the rest as text.
Single newlines break lines, as GitHub's issue flavour of GFM does. HTML comments are stripped,
because that is how issue templates carry their instructions and GitHub does not show them
either. Inline tokens are `split` on a capturing group and `.map`ped, never looped: every link's
press handler closes over its URL, and a closure made in a `for…of` body captures the final value
under Hermes.

**HTML is rewritten into Markdown before parsing, not parsed alongside it.** Dependabot writes
its whole body in HTML — `<details>` around each release-notes section, `<blockquote><h2>…<ul>`
for the upstream changelog, `<a href><code>@login</code></a>` for credits — and it rendered as a
wall of tags. `html.client.tsx` walks the tags in order with a small stack and emits each one's
Markdown spelling: a `#` heading line, a list marker indented two spaces per nesting level, a
`> ` prefix on every line written inside a quote, `[label](href)`, a pipe table whose first row is
the header. That keeps `parseMarkdown` single-purpose and means anything the renderer learns to
draw, HTML gets for free. Two things make it hold up against the real body rather than a tidy one:
line breaks are idempotent (`newline()` does nothing at the start of a line), because the
source's own newline after `</li>` plus the break a tag stands for would otherwise be a blank
line, which ends the list and drew every bullet as its own one-item block; and only tags GitHub's
sanitiser keeps are recognised, with inline code spans and fenced code skipped as tokens, so
`<dependency name>` in Dependabot's own command list stays as written. `<details>` and `<summary>`
are the one thing emitted back as tags, normalised onto their own lines with attributes intact,
because Markdown has no spelling for them; the parser collects up to the matching `</details>`,
parses the inside recursively, and `DetailsBlock` starts collapsed unless the author wrote
`open`, which is how GitHub shows it too. Quotes hold blocks the same way, so a heading or list
inside one renders as one.

To check the pass against a real body, compile `html.client.tsx` and `markdown.client.tsx` to a
scratch directory with `tsc --jsx react-jsx` over stub `react` and `react-native` modules, then
log `parseMarkdown(body)` as a tree; the `key` prop error from the stub is expected. Dependabot's
bodies (`gh pr view <n> --json body`) are the reference case.

## Editing labels from a card

Right-click an issue or pull request card — long-press on a touch platform — and its repository's
labels open as a menu at the pointer, each row a toggle. Discussions are excluded: GitHub would
label them fine, but they are not work whose labels a reader acts on.

**Each press is one `board.toggle-label` call, applied immediately.** Both GraphQL mutations
(`addLabelsToLabelable`, `removeLabelsFromLabelable`) answer with the labelable they changed, so the
item's new label set comes back in the same round trip that set it — no read-after-write, and a
label someone else added meanwhile lands on the card instead of being overwritten by what the client
assumed. `Labelable` is an interface, so the selection needs an inline fragment per concrete type.

The row waits for that answer rather than moving optimistically, and is dimmed while it does. A
failure — no write access, most likely — is shown *inside* the menu, which stays open, because the
error belongs to the label the user just pressed and not to the board.

`board.labels` lists the first 100 labels by name and caches them for five minutes on both sides.
Label sets change far more slowly than the work they are put on, and the menu is reopened card after
card on the same few repositories. Paging past 100 would mean a cursor loop for a menu nobody could
read; a repository with more edits them on GitHub.

`toggleLabelHandler` also patches the **server's cached board**, and the client patches its own
module-scope copy. Both are load-bearing: the board is remembered for five minutes and the surface
remounts on every workspace switch, so an unpatched cache would repaint the labels the edit
replaced.

### Opening at the pointer

`onContextMenu` is web-only and absent from the React Native types, so it goes on the `Pressable`
behind a `@ts-expect-error`, exactly as Paseo's own `ContextMenuTrigger` does it — `preventDefault`
first, or the browser's menu opens on top. **Long press is native-only**: on web a long press is a
held left click, which right-click already covers, and wiring both opens the menu twice on one
gesture. That is why `Card` takes `platform` rather than the old `hoverToReveal` boolean — one prop
answers both "does anything hover here" and "is a long press a duplicate".

The gesture reports a point in window coordinates; the menu is positioned inside the surface. The
surface measures itself with `measureInWindow` **in the callback, per open** — a scrolled column or
a resized window makes a remembered origin wrong — and clamps: the menu opens right and down from
the pointer unless that leaves the surface, and when it opens upward it hangs from `bottom`, so its
foot sits at the pointer whatever height it ends up with. `LABEL_MENU_WIDTH` and
`LABEL_MENU_MAX_HEIGHT` exist because that decision is made before the menu has ever laid out.

On Android the gesture's `pageY` excludes the status bar and the measured window includes it, so
`StatusBar.currentHeight` is added back. Paseo corrects the same offset the same way.

The menu's scrim is transparent, unlike the modal backdrop: a context menu dismisses on the next
press without dimming the thing it is a menu about. It also carries an explicit **Close** row,
because a plugin surface receives no key events — there is no Escape to fall back on.

Cards now show `+N` when they hold more labels than the three that fit. Silent truncation was fine
when labels were read-only; now it would read as an edit that did nothing.

## Send to chat

Every card carries a **Send to chat** button, bottom-right, revealed on hover. It opens a launch
dialog — Paseo's own New workspace screen, narrowed to one card — and the dialog does the work:
`board.send-options` finds the project, `usePaseo().providers` fills the pickers, and
`board.send-to-chat` creates the workspace, creates the agent in it, and sends the prompt as its
first message. The client then routes the app to the new workspace.

### The dialog

`board.send-options` answers what only the daemon can: which project this card's repository is
checked out as, that project's `rootPath`, whether its `kind` is `git` (Paseo offers a worktree for
exactly the git ones — `workspace-structure.ts`), and the launch defaults saved from the last send.

Everything else comes from `usePaseo().providers.snapshot({ cwd })` **on the client**, which is the
same snapshot Paseo's composer renders: providers, their models, each model's thinking options, each
provider's permission modes and `defaultModeId`. Mirroring that catalogue into an RPC of our own
would freeze a shape that the host changes. The `cwd` is the project's checkout, not the daemon's,
because a provider can offer different models per directory. Discovery is lazy, so the dialog also
holds `providers.subscribe` open while it is up and adopts updates for its own `cwd`.

**A provider with no selectable model is dropped, not shown.** `paseo.agents.create` takes
`config.provider` as `provider/model` and `parseProviderModel` throws on a bare provider, so a row
that cannot name a model is a row that cannot be sent. The protocol itself allows an absent model
(`AgentSessionConfigSchema.model` is optional) — the SDK is what does not.

A saved default is a preference, never a promise: `resolveConfiguration` keeps each field only where
the host still offers it and falls back to the host's own default otherwise, so a renamed model or
an uninstalled provider degrades instead of failing the send. Picking a new model drops the thinking
option deliberately — thinking levels belong to the model, so the new one takes its own default.

**The host is not a picker.** A surface is bound to the daemon that contributed it: `usePaseo()` is
that daemon's client (`surface-runtime.ts`), the board's `gh` runs there, and nothing in the plugin
API reaches another host. Switching hosts is the surface header's own `PluginHostSwitcher`. The
dialog names the host instead of offering it.

**The backdrop does not cancel.** The dialog opens with a prompt the user is expected to edit, and a
modal that closes on any press outside itself puts that edit one stray thumb away from being lost —
on a phone, where the card is small and the backdrop is most of the screen, that is a matter of time
rather than of luck. Cancel is the only way out, and it is labelled. The backdrop still *catches* the
press so nothing reaches the board underneath: an open popover swallows it the way every menu does,
and otherwise it dismisses the keyboard, which is what a press outside a field means on a touch
platform. It is hidden from screen readers unless it has a menu to close, because a button that does
nothing is worse than no button.

This is the opposite of the label context menu, which *does* dismiss on the next press — a menu holds
no unsaved work, and pressing away from one is how every menu is closed.

### The popovers

Each control opens a popover, the way Paseo's own composer does, not a view that takes over the
dialog. Three things make that work inside a modal card:

- **They are anchored to their row, not to their chip.** Anchoring to the chip would need the chip's
  offset inside the card, and a menu that opens past the card's right edge is clipped outright on
  Android. The row's left edge is always inside the card.
- **Direction keeps them in the card.** The top row (isolation) opens down over the prompt, the
  bottom row (model, thinking, mode) opens up over it, and `maxHeight` is sized so neither leaves the
  card. The list inside needs `flexShrink: 1` or it overflows that cap instead of scrolling.
- **`zIndex`, twice.** `cardScrim` (1) catches the press that dismisses an open popover before it
  reaches the prompt underneath; both control rows sit above it (2) so their chips stay pressable;
  and whichever row owns the open popover is raised again (3), or paint order would put the bottom
  row's chips on top of a menu the top row opened downward.

The model popover is **two steps**, mirroring `model-browser.tsx` and `model-browser-view.ts`:
providers first, with each one's model count and a chevron, then that provider's models behind a
back arrow. A flat list is unreadable once one provider ships fourteen models. Where it opens
follows `resolveInitialModelBrowserView` — a lone provider skips the redundant provider step, and an
already-chosen provider opens straight on its own models.

Search matches the same four fields Paseo ranks on (model label, model id, provider label,
description) and, from the provider step, searches **across all providers** — hence "Search all
models…" there and "Search models…" inside one. `scoreFields` is a substring rank standing in for
`@getpaseo/protocol/search/text-match`, which a client bundle cannot import. Cross-provider results
name their provider in the detail line, because the same model label ships on more than one.

### Creating the workspace and the agent

`workspace.create` takes `source: { kind: "worktree", cwd, projectId }` or
`{ kind: "directory", path, projectId }` — the same two the app's `createMultiplicityWorkspace`
sends. No `worktreeSlug`: the daemon mints a mnemonic one (`worktree-core.ts`) and renames the
branch after the prompt once the agent is running.

**`firstAgentContext` is passed here, and only here.** It is not a way to seed a composer — it is
naming context plus `expectsInitialAgent`, which flips the new workspace to an *optimistic*
`running` on the promise that the caller creates an agent next. This handler does, immediately, so
the optimism is honest; a handler that passed it and created nothing would leave a workspace
spinning until it settled on `done`.

The agent is then created through the workspace handle, so the SDK places it on the workspace's own
directory — the worktree's path when one was cut, not the project root — and `prompt` rides along as
`initialPrompt` rather than being sent afterwards, so there is no window where the workspace holds a
silent agent. The chosen configuration is saved as the next card's defaults only after all of that
worked.

If the agent fails to start, the workspace still exists; the error says so by name rather than
pretending nothing happened.

### Selecting the new workspace

The route is the app's own: `/h/<serverId>/workspace/<workspaceId>?open=agent:<agentId>`.
`props.host.id` **is** that `serverId` (`surface-screen.tsx` passes `{ id: serverId, label:
hostLabel }`), and `?open=agent:…` is the cold deep-link intent the workspace screen consumes and
then strips (`app/h/[serverId]/workspace/[workspaceId]/index.tsx`).

**It runs in the client bundle, and that is the point.** The server half lives next to the daemon,
which on a remote host is a different machine from the one the user is looking at — a link opened
there would surface on the wrong screen.

Since Paseo 0.7.0-beta.3 ([getpaseo/paseo#3901](https://github.com/getpaseo/paseo/pull/3901)) the
host passes `props.navigation`, and `handleLaunched` prefers it: `openAgent({ agentId })` alone
lands on the workspace *and* opens that agent's tab, because it runs the app's own `navigateToAgent`
against the host rendering the surface. No route, no platform branch, no reload. The prop is
optional and its **absence is the compatibility gate**.

**That gate is the app's version, not the daemon's.** `usePluginHostNavigation` lives in
`packages/app`, so the prop arrives or not according to the client rendering the surface — and one
daemon serves several. Measured on 2026-08-31 against a single 0.7.0-beta.3 daemon by throwing
instead of falling back: desktop navigated, the phone reported no prop, because the mobile app
ships on its own cadence and was still behind. If you need to re-run that experiment, throw *before*
`setSendTarget(null)` — the caller's `.catch` writes into the send dialog, so a throw after the
dialog closes sets state on an unmounted component and you see nothing.

So `selectWorkspaceInApp` is not dead code awaiting a cleanup: it is live on every client older than
the newest one, which today includes mobile. It is the pre-0.7.0-beta.3 path, and it uses what the
platform gives it:

- Native opens `paseo:/<route>` through `Linking`, which expo-router handles in-process.
- Web and the desktop renderer `history.pushState` the route and dispatch a `popstate`, which is the
  event expo-router's forked `useLinking` listens on; it finds no matching history record and
  `resetRoot`s to the route.

`paseoDesktop.opener.openUrl` is **not** usable for this: `desktop/src/features/opener.ts` allows
only `http:` and `https:` and throws on anything else, and `Linking.openURL` on the desktop renderer
is `window.open`, which opens a bare child window. Hence the history push.

The push is best effort and self-checking: routing away unmounts this surface, so if the surface is
still mounted `ROUTER_SETTLE_MS` later, nothing routed and `location.assign` finishes the job with a
reload. The success notice is set *before* navigating, so a platform where neither works still says
where the work went.

**The clipboard is gone.** It used to carry the prompt because a plugin cannot seed a composer —
drafts are app state and a client bundle may only import react, react-native, react-query, zod and
`@getpaseo/plugin`. Sending the prompt to an agent we create ourselves sidesteps that entirely.
`plugin.addAttachmentSource` was the documented route for plugin content into a composer unsent, and
this plugin **tried it and reverted it** (see git history for `board.search-attachments`): the
handler returned items that passed the host's own `PluginAttachmentSearchPayloadSchema` and the
picker still showed nothing. Budget for debugging the host before reaching for that API again.

**The overlay is the wide layout's button, and only its.** Where the columns share a row the button
is absolutely positioned in the card's bottom-right corner, so revealing it neither reflows the card
nor nudges the cards below it — which means it sits over the footer's trailing labels, hence the
opaque accent fill rather than a tint. On `layout.compact` it is an ordinary row under a divider
instead: an overlay is only unobtrusive while hover keeps it hidden, and a phone never hovers, so
the compact card would permanently cover its own metadata. Everything below about hover applies to
the wide layout; the compact button has no hover state at all.

**It is revealed by opacity, and stays mounted and hit-testable when hidden.** The card and the
button track hover separately and either one reveals it. Both halves of that are load-bearing:
moving the pointer onto the button fires the *card's* `onHoverOut`, because the button is a child
that takes the pointer for itself — so a single card-level hover state hides the action exactly when
the user reaches for it. Mounting on hover fails the same way and worse: an action that unmounts
under the cursor can never fire the `onHoverIn` that would have kept it alive. A hidden button that
kept its own hover state but went `pointerEvents: "none"` would flicker instead, handing the pointer
back to the card, which reveals it, which takes the pointer back.

Hidden-but-clickable is safe here because a pointer cannot reach the button without first crossing
the card, which reveals it — there is no invisible click target.

## The compact layout

`layout.compact` is a **different layout, not the same one narrowed**: a tab bar over one
full-width column, where the wide layout is four columns sharing a row. The host sets the flag; a
phone and a narrow desktop window both get it, so nothing here may assume touch — that is what
`layout.platform` is for, and the two are decided separately on purpose.

**The tab bar carries every column's count, not just the selected one's.** It replaced a horizontal
scroller of 300pt columns, which on a phone showed one column, slivers of its neighbours, and no
way to tell what was in the other three without swiping to them — the opposite of what a board is
for. The counts are what makes one-column-at-a-time acceptable. A column that failed to load shows
`!` rather than its count, because an errored column holds no items and a `0` would read as
"nothing to do".

The `Column` is keyed by id in that branch, so switching tabs starts the new list at the top instead
of inheriting the previous one's scroll offset. The selected id lives at module scope
(`cachedColumnId`) for the same reason the board does: the surface unmounts on every workspace
switch, and snapping back to Issues after deliberately choosing Open PRs reads as the board
forgetting.

**Compact has no Refresh button — it has `RefreshControl`.** That is why the "Updated …" timestamp,
which used to be hidden on compact, now shows there: it is the only thing left saying how old the
board is. `refreshing` is bound to `busy`, so a refresh started any other way spins the same
control. The header also drops its own "GitHub" title, because the surface chrome above it already
carries the name and the icon. The settings button is a `Settings` gear on both layouts — the row
does not wrap, so anything that does not fit is clipped off the right edge rather than moved, and a
glyph is the one label that always fits.

### The keyboard

The launch dialog is centred in a layer that fills the surface, so on a phone the keyboard opens
straight over it. `useKeyboardInset` shortens that layer by the keyboard's height and the card
recentres in what is left — **padding, not a translation**, so the card can also *shrink* into the
remaining space, which moving it could not.

It is **iOS-only on purpose**: Android resizes the window itself when the keyboard opens, so the
layout has already shrunk by the time the event lands and padding again would push the dialog off
the top. It listens on `keyboardWillShow`, which fires with the opening animation rather than after
it — and which Android does not emit at all, the other reason this is not shared. The settings view
needs none of it: a `ScrollView` can be told to inset itself with
`automaticallyAdjustKeyboardInsets`, and that is what it does.

Shrinking needs two `flexShrink: 1`s, because **Yoga does not shrink flex children by default** the
way CSS does. One on `dialogCard`, so the card obeys the shortened layer instead of overflowing it;
one on `promptInput`, so the height comes out of the prompt — which scrolls itself, being multiline
— rather than off the bottom row with the Send button on it.

Opening any picker calls `Keyboard.dismiss()` first (`togglePicker`). The popovers are sized to the
card and the card is sized to what the keyboard leaves, so a menu opened mid-typing would otherwise
get the smallest card of the session. The prompt survives the blur; it is state, not the field's
value.

Compact also drops the column's own header (the tab already names it and counts it) and its border
(it is the whole body, not one of four), and scales the card up: two title lines instead of three
because a full-width card fits more per line, and larger pills, rows and checkboxes because on a
phone those are touch targets and not just text.

## Prompts, and the settings view

What the dialog opens with is a template, not the bare URL. One per column —
`issues`, `draft-prs`, `open-prs`, `discussions` — because the column id already *is* the kind of
work, so it doubles as the template key. Placeholders are `{url}`, `{title}`, `{number}`,
`{repository}`; `renderTemplate` leaves anything else in braces standing, so a typo shows up in the
prompt instead of silently swallowing part of it.

Overrides are keyed by **Paseo project id, not repository**. A card that reaches no project cannot
be sent anywhere, so a per-repository override for one would configure something unusable — and a
fork's origin and upstream are two repositories but one project, which should not need configuring
twice. `board.load` carries `projects` (every live project, so the settings view can list them all)
and `repositoryProjects` (`owner/name` to project id, for the repositories on this board only).

**Blank means inherit, at both levels.** A blank `byType` entry is stored as the built-in default,
and a blank project override is dropped. That is deliberate: clearing a field *is* the reset, so
there is no separate reset action and no way to end up with a saved empty prompt that sends
nothing. `savePromptsHandler` runs its input back through `readPrompts` — the same function that
parses the settings file — so saving a cleared field and reloading it cannot disagree.

An override stores only the types it overrides, never a copy of the inherited value. Storing the
copy would freeze it, and the override would stop tracking a default the user later edits.

Resolution happens **on the client**, in `templateFor` + `renderTemplate`, because the launch dialog
opens with the prompt already in it: a round trip first would show an empty field and then rewrite
what the user may already be typing into. That is why `prompts` rides along on `board.load` the way
`hiddenRepositories` does — and why, unlike the filter, it is adopted on *every* load rather than
once: nothing edits it outside the settings view, and that view owns its own draft.

The settings view is a second view inside the same surface, toggled by `showSettings`, not a second
surface: `openSurface` exists only on a Command Center item's context, so a surface cannot route to
another one. It owns the GitHub login field too, which used to sit in the board header. It edits a
draft and persists on Save — writing per keystroke would save half-typed templates and cost a round
trip per character — and both its draft and its login field adopt a new prop only when the prop
actually changes, so neither fights what is being typed.

The match asks the daemon, through `paseo.projects.list()` — added to the plugin `PaseoApi` in
Paseo 0.5.2 ([getpaseo/paseo#3899](https://github.com/getpaseo/paseo/pull/3899)) for exactly this
reason. It replaced reading `$PASEO_HOME/projects/projects.json` off disk, which was the only way to
see a project before that call existed: the other candidate, deriving projects from
`paseo.workspaces.list()`, only sees repositories that already have a live workspace, which is a
minority of them. The descriptor is also where the project's `kind` comes from, which is what
decides whether the dialog can offer a worktree.

Going through the daemon buys three things the file read did not have: no dependency on a
daemon-internal file format, archived projects filtered out by the daemon rather than by this
plugin, and `projectDisplayName` already resolved through the project's custom name, so a renamed
project reads on a card the way it reads everywhere else in Paseo. The list is requested with no
`sync` cursor, so the answer is always the full list rather than a diff against a cursor this plugin
does not keep. It costs no reach: a handler already holds a daemon session, so a board that can load
at all can list projects. It does raise the floor to Paseo 0.5.2, and the SDK dependency to a version
that declares `paseo.projects`.

`projectKey` is `remote:<host>/<owner>/<name>`, lowercased by the daemon, which is exactly a card's
identity — so the lookup is an equality test on that key, not a guess at directory names. It is
optional on the wire; a project without one matches nothing by key and is reached, if at all, by its
git remotes. The host comes from the card's own URL rather than a hardcoded `github.com`, so an
Enterprise card cannot match a same-named repository on github.com.

**`projectKey` only records `origin`, so it cannot match work done from a fork.** A pull request
opened from `you/paseo` still *lives* in `getpaseo/paseo`, which is what the card names, so a fork
checkout misses on the key every time. When the key matches nothing, the search falls back to
`git -C <rootPath> remote -v` per live project and matches the card against every remote — which is
where the conventional `upstream` is found. Both stages normalise to the same `<host>/<owner>/<name>`
form, so the scp-like `git@host:owner/name.git` and the `https://` spelling compare equal.

The key stage runs first because it costs nothing beyond the list already fetched and it names the
repository Paseo itself considers the project's home; the remote scan costs one `git` subprocess per
project and only runs on a miss. A directory that is not a checkout, or has gone missing,
contributes no remotes rather than failing the search for every other project.

The launch outcome lands in a modal centred over the surface — the last child of the screen view, so
it paints above the columns by order and not only where `zIndex` is honoured. It is separate from
the board's `error`, because a card that matched no project says nothing about whether the board
loaded.

## Settings and caching

Settings persist to `$PASEO_HOME/plugins/github-board/settings.json`, defaulting to `~/.paseo`, and
hold `login`, the repository filter's `hiddenRepositories`, the `prompts`, the `launch` defaults
the dialog reopens on, and the detail panel's `detailWidthFraction`. Five handlers write that one file, so all of them go through
`updateSettings`, which read-modify-writes — a whole-file write from any would drop the others'
keys. Each reader defaults what it cannot parse, so a settings file written before a key existed is
read and upgraded in place rather than rejected.

A plugin surface unmounts whenever the user switches workspaces, so anything that should outlive
that (the repository filter, the launch defaults) belongs in settings, not component state. The same unmount is why both
halves cache the board for five minutes — module scope in `board.client.tsx` for an instant repaint,
and a keyed value in `board.server.ts` so a cold mount still skips the `gh` calls. `force` on
`board.load` is the Refresh button bypassing both. Keep `hiddenRepositories` out of the server's
cached value: settings are read per load, or a filter saved after that board was built comes back
stale on the next hit.

The client bundle's module scope surviving an unmount is an assumption about the host, not a
guarantee — the server cache is what makes the speedup hold if it turns out to be wrong. The board's
filter rides along in the `board.load` response and is adopted once, guarded by a ref: later
refreshes must not overwrite a selection the user is mid-way through changing.
