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
| `index.ts`         | Wiring only — binds the six RPC contracts and registers the sidebar surface. |
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

Three calls per refresh, not four: both PR columns split one search result by `isDraft`. Every
search is `gh api graphql` rather than `gh search`, because `closingIssuesReferences` — the link
from a pull request to the issues it closes — has no `gh search` field, and because two searches
can share one request as aliases (below).

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

There is still no plugin navigation API, so `selectWorkspaceInApp` uses what the platform gives it:

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

The button is hover-gated only when `layout.platform === "web"`; a touch platform never hovers and
would hide the action forever. It is absolutely positioned so revealing it neither reflows the card
nor nudges the cards below it, which means it sits over the footer's trailing labels — hence the
opaque accent fill rather than a tint.

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

The match reads `$PASEO_HOME/projects/projects.json` directly, because the plugin `PaseoApi` exposes
workspaces, agents, providers, and config, but not projects. The alternative — deriving projects
from `paseo.workspaces.list()` — only sees repositories that already have a live workspace, which is
a minority of them. That same record is where the project's `kind` comes from, which is what decides
whether the dialog can offer a worktree. The cost is a dependency on a daemon-internal file format:
if that file moves or its `projectKey` changes shape, every card reports "no Paseo project is
checked out from …".

`projectKey` is `remote:<host>/<owner>/<name>`, lowercased by the daemon, which is exactly a card's
identity — so the lookup is an equality test on that key, not a guess at directory names. The host
comes from the card's own URL rather than a hardcoded `github.com`, so an Enterprise card cannot
match a same-named repository on github.com. Archived projects are skipped.

**`projectKey` only records `origin`, so it cannot match work done from a fork.** A pull request
opened from `you/paseo` still *lives* in `getpaseo/paseo`, which is what the card names, so a fork
checkout misses on the key every time. When the key matches nothing, the search falls back to
`git -C <rootPath> remote -v` per live project and matches the card against every remote — which is
where the conventional `upstream` is found. Both stages normalise to the same `<host>/<owner>/<name>`
form, so the scp-like `git@host:owner/name.git` and the `https://` spelling compare equal.

The key stage runs first because it is a single file read and it names the repository Paseo itself
considers the project's home; the remote scan costs one `git` subprocess per project and only runs on
a miss. A directory that is not a checkout, or has gone missing, contributes no remotes rather than
failing the search for every other project.

The launch outcome lands in a modal centred over the surface — the last child of the screen view, so
it paints above the columns by order and not only where `zIndex` is honoured. It is separate from
the board's `error`, because a card that matched no project says nothing about whether the board
loaded.

## Settings and caching

Settings persist to `$PASEO_HOME/plugins/github-board/settings.json`, defaulting to `~/.paseo`, and
hold `login`, the repository filter's `hiddenRepositories`, the `prompts`, and the `launch` defaults
the dialog reopens on. Four handlers write that one file, so all of them go through
`updateSettings`, which read-modify-writes — a whole-file write from any would drop the others'
keys. Each reader defaults what it cannot parse, so a settings file written before a key existed is
read and upgraded in place rather than rejected.

A plugin surface unmounts whenever the user switches workspaces, so anything that should outlive
that (the repository filter, the launch defaults) belongs in settings, not component state. The same unmount is why both
halves cache the board for five minutes — module scope in `board.client.tsx` for an instant repaint,
and a keyed value in `board.server.ts` so a cold mount still skips the three `gh` calls. `force` on
`board.load` is the Refresh button bypassing both. Keep `hiddenRepositories` out of the server's
cached value: settings are read per load, or a filter saved after that board was built comes back
stale on the next hit.

The client bundle's module scope surviving an unmount is an assumption about the host, not a
guarantee — the server cache is what makes the speedup hold if it turns out to be wrong. The board's
filter rides along in the `board.load` response and is adopted once, guarded by a ref: later
refreshes must not overwrite a selection the user is mid-way through changing.
