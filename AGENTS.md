# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Plugins for [Paseo](https://paseo.sh), one self-contained folder per plugin: `skills/`,
`github-board/`, `launchd-jobs/`, `herald/`, `model-pricing/`, and `firstmate/`. Plugin code is trusted and
unsandboxed — the server half runs next to the daemon with its files, processes, and credentials;
the client half runs inside the Paseo app.

Each plugin has its own `AGENTS.md` for what only that plugin does — `skills/AGENTS.md` before
touching skill discovery, `github-board/AGENTS.md` before touching the `gh` queries or the board's
caching, `launchd-jobs/AGENTS.md` before touching anything that calls `launchctl` or writes a
plist, `herald/AGENTS.md` before touching the lifecycle hooks or the summary helper,
`model-pricing/AGENTS.md` before touching where a price comes from or how it is cached,
`firstmate/AGENTS.md` before touching the first mate's charter or how the board finds the crew. This
file is only what they share.

## There is no workspace root

Each folder is an independent npm project with its own `package.json`, `node_modules`,
`tsconfig.json`, and `paseo-plugin.json`. Nothing is hoisted, and there is no root `package.json`.
Every command below runs from inside a plugin folder, never from the repo root.

`paseo plugin install` records the absolute directory it was given and the daemon loads from that
path on every start, so moving this clone means reinstalling every plugin in it.

```bash
cd skills          # or github-board, launchd-jobs, herald, model-pricing, firstmate
npm install
npm run typecheck  # every plugin
npm test           # every plugin
```

Single test (vitest, every plugin):

```bash
npm test -- server/resolve/frontmatter.test.ts   # one file
npm test -- -t "dedupes by name"            # one test by name
```

## Dev loop against a running daemon

```bash
paseo plugin reload skills        # after any source change; id, not folder name
paseo plugin logs skills          # load errors and stderr
```

- The plugin id comes from `paseo-plugin.json`, which `paseo plugin init` seeds from the directory
  basename. The ids are `skills`, `github-board`, `launchd-jobs`, `herald`, `model-pricing`, and
  `firstmate`.
- **A failed reload stays failed.** Paseo does not restore the previous code.
- **Never restart the daemon** — it manages the user's running agents.
- The daemon needs `"pluginsEnabled": true` in its `config.json`, and **Paseo 0.9.0 or newer**. All
  six plugins declare `requirements.paseo: ">=0.9.0"`; on an older daemon they do not degrade,
  they refuse to load. There are no version fallbacks left in this repo — see *Versions* below for
  why the app-side check made them unnecessary.
- There is no harness for plugin UI. A clean typecheck and a clean reload prove a `client/` change
  compiles and loads, nothing more; a human has to look at the panel. Check a wide window *and* a
  compact one, and switch theme — unstyled text and hardcoded colours only show up in one of them.

## Plugin architecture

Every plugin is the same shape. Each has up to two entries, one per runtime, and at least one is
required. Both are wiring only — they bind RPC contracts to handlers and register contributions,
and return a cleanup function:

```ts
// index.server.ts — runs in a daemon subprocess
export default function contribute(server: PluginServerContext) {
  server.handle(loadBoard, loadBoardHandler);
  server.registerSettings(displaySettings);
  return () => {};
}
```

```tsx
// index.client.tsx — runs inside the Paseo app, once per connected client
export default function contribute(client: PluginClientContext) {
  client.addSurface("board", GitHubBoard);            // github-board: global sidebar surface
  client.addWorkspacePanel({ context: "agent", ... }); // skills: per-agent workspace tab
  client.addSettingsScreen({ ... });
  client.addCommandCenterItem({ ... });
  return () => {};
}
```

A top-level React call or `StyleSheet.create` in `index.server.ts` executes in the daemon bundle.
Keep it out.

**Directories decide which bundle code lands in**, and crossing the boundary fails compilation.
Filename suffixes mean nothing, and a code module at the plugin root is a compile error — only
`paseo-plugin.json`, `package.json`, `tsconfig.json` and the two entries live there.

| Directory | Owns |
| --- | --- |
| `client/` | React and UI. May import only the host-provided modules: `react`, `react-native`, `@tanstack/react-query`, `zod`, `@getpaseo/plugin`, `@getpaseo/plugin/client`, `@getpaseo/plugin/client/react-native`, `@getpaseo/plugin/client/ui`. |
| `server/` | Node built-ins, filesystem, subprocesses, RPC handlers. |
| `shared/` | zod RPC contracts (`defineRpc`), settings documents (`defineSettings`), and plain values imported by both halves. No Node, no React. |

Client and server never share a process. Every crossing is a `defineRpc` contract in `shared/`,
called from the client with `useRpc(contract)` and answered by `server.handle`. Handlers receive a
`PluginHandlerContext` carrying `paseo`, the host API — that is how `skills/server/skills.ts`
resolves an `agentId` to its provider and cwd.

### Which side owns a persisted value

Two stores, and the rule is which side has to *read* it:

- **A settings document** (`defineSettings` in `shared/`, `server.registerSettings` in the server
  entry, `useSettings` in a component) is host-scoped storage the **client** reads and writes. There
  is no server-side read API, so a handler cannot act on it.
- **The plugin's own file** under `$PASEO_HOME/plugins/<id>/` is whatever the **daemon** needs. It
  costs an RPC per read and write, which is the price of the handler being able to use the value.

`github-board` splits exactly on that line: the repository filter, the prompt templates and the
detail panel's width are drawn and nothing else, so they are settings documents; the `gh` login and
the launch defaults are what handlers run on, so they stay in the daemon's file.

### Constraints nothing catches at compile time

- **No async arrows in client-bundle code** (`client/`, `shared/`). The app `eval`s the client
  bundle, and on iOS/Android Hermes's eval compiler evaluates an async **arrow** to `undefined`
  instead of a function — no compile error, no load error; the surface renders until something
  calls the value and dies with "Plugin failed: undefined is not a function". Async `function`
  expressions work. For the same reason, a closure created inside a `for (let|const … of …)` body
  captures the loop binding's **final** value — reach for `.map` when a callback must capture the
  element. Desktop runs the web export on V8 and shows neither, so a working desktop surface proves
  nothing about mobile.
- **RPC wire names must match `/^[a-z][a-z0-9._-]*$/`.** camelCase names load-fail with "Invalid
  plugin RPC method" and the plugin never starts. Use Paseo's dotted namespacing: `board.load`,
  `skills.list`. The exported identifier is unrelated to the wire name.
- **Colour comes from `theme.colors`, never a literal.** The tokens are `surface0`, `surface1`,
  `surface2`, `foreground`, `foregroundMuted`, `border`, `accent`, `accentForeground`,
  `statusSuccess`, `statusWarning`, `statusDanger`. Any other name renders as undefined at runtime.
- **`icon` is any Lucide component name**, typed as a bare `string`. The host resolves it with
  `Reflect.get` over the Lucide barrel and throws `Unknown Lucide icon: <name>` at contribution
  time, so a typo load-fails the plugin. Brand icons are in there too — `Github`.
- **Relative imports are extensionless** — `./frontmatter`, not `./frontmatter.js`.
- **Browser globals live only in `client/web.ts`.** No `tsconfig` here has `"DOM"` in `lib`, so
  `document` and `window` are type errors everywhere by default. That one module declares the narrow
  shape of each global it uses, gates every export on `Platform.OS`, and gives native the
  alternative or a no-op — see `github-board/client/web.ts`, which owns the document-level pointer
  tracking the detail panel's resize handle needs on web.
- **Opening a URL is not one of those globals any more.** `openExternalUrl` from
  `@getpaseo/plugin/client` reaches the same platform opener Paseo's own links go through, on every
  platform. It used to be hand-rolled in two copies of `client/web.ts`, because `Linking.openURL` is
  `window.open` on the desktop renderer and lands in a bare child window; both are gone. It answers
  with a promise, so a press handler `void`s it rather than awaiting — never an async arrow. The
  in-app alternative is `navigation.openBrowser`, which opens a tab *inside* a workspace and is
  **Electron-only**: the host leaves it `undefined` on web, iOS and Android and does not fall back,
  so anything drawn for it has to disappear there. It takes a `workspaceId` and is the one piece of
  navigation a timeline item cannot reach — `PluginTimelineItemProps` carries no `navigation` at
  all, unlike surfaces and panels.
- **Plugin Command Center items are pinned below file results.** The host hardcodes their group
  rank, so single-word keywords get buried by filename matches.
- **A surface is unmounted when the user navigates away** — to a workspace, an agent, anywhere —
  and mounted fresh on the way back, so component state is gone. Anything that should survive the
  round trip and is *not* worth persisting (a loaded board, the open pane, a half-typed form) lives
  in module-scope variables the component reads on mount: `cachedBoard` in `github-board`,
  `cachedPane` and `cachedDraft` in `launchd-jobs`. Anything that *is* worth persisting belongs in a
  settings document, which the host restores on its own.
- **`useWorkspace` and `useAgent` work only inside workspace panels.** Called from a sidebar surface
  they throw "Plugin state hooks must run inside a workspace panel" on mount, and the surface renders
  that error instead of itself. A surface reads workspaces and agents through `usePaseo()` — see
  `herald/client/herald.tsx`, which maps workspace ids to titles from `workspaces.list()`.
- **`SettingsSelect`'s popover does not scroll.** It works for a handful of options and cannot be
  used for a long list — a Mac lists 185 `say` voices. Past about ten options, open a host `Modal`
  with `scrollable={false}` and put the host `FlatList` and a search `TextInput` inside it — see
  `herald/client/option-picker.tsx`.
- **Another host is reachable from the client, but only as Paseo.** `useHosts()` lists every host the
  app is configured with, and `getPaseoClient(serverId)` borrows the app's own connection to one as
  an ordinary `PaseoApi` — projects, workspaces, agents, providers, terminals — whether or not the
  plugin is installed there. It is **not** plugin RPC: `useRpc` and `client.rpc` still reach only
  the plugin's own daemon, and server handlers have no equivalent at all. Nor can it add a plugin
  timeline row: the daemon accepts `type: "plugin"` appends only from that plugin's own session.
  Borrow it per action, inside an async function — it throws for a host that is offline or whose
  connection was replaced — and pass the same `serverId` to `navigation.openAgent`,
  `openWorkspace` or `openBrowser` to follow the work across. `github-board`'s send dialog is the
  worked example.
- **A surface cannot open its own settings screen.** `PluginSurfaceProps` carries no
  `openSettings`; only `PluginClientContext` and a Command Center or slash-command callback have it.
  A surface that needs to reach one keeps its own in-surface editor, routes the user through ⌘K —
  see `github-board`, which does both — or is *lent* the capability by the entry:
  `herald/index.client.tsx` passes `client.openSettings` to a module-scope binding in
  `herald/client/herald.tsx`, which its header gear calls. Contribution runs before any surface
  mounts, so the binding is always set by the time one renders; it is cleared in the cleanup.

### Versions

`paseo-plugin.json` carries `requirements.paseo`, an npm semver range. **A missing
`requirements.paseo` means `<0.8.0`**, so 0.8 rejects the plugin outright with a link to the
migration guide — adding the field is part of migrating, not a substitute for it. All six plugins
here declare `>=0.9.0`.

**The manifest may only carry what the *oldest* declared version accepts.** `PluginManifestSchema`
is `.strict()` in every Paseo, so a key one version added is a load failure on every version before
it — not a warning, not an ignored field. 0.9 added `description`, which the app shows in its
plugins list; adding it here while `requirements.paseo` still said `>=0.8.0` broke all five on 0.8,
and paseo.cafe's admission scan is what caught it, because it allows the key for an npm source
(0.9-only by construction) and rejects it for a Git one. Either the key goes or the floor rises —
the key went first, and the floor rose later, when `openExternalUrl` and `navigation.openBrowser`
made 0.9 worth requiring; `description` came back in the same change. Check a new manifest key
against the tag named in `requirements.paseo` before adding it.

The daemon checks the range before installing or loading, and **each connected app checks it against
its own version** before evaluating client code. That second check is what retired this repo's
version-sniffing fallbacks: a client old enough to lack `props.navigation` is a client too old to
evaluate the bundle at all, so the prop is always there in practice even though it is typed
optional.

### npm packages

Every plugin here publishes to npm under the `@gpambrozio` scope as `@gpambrozio/paseo-<id>`, which is
how Paseo 0.9 installs them: the daemon writes a throwaway `package.json`, runs `npm install
--ignore-scripts --legacy-peer-deps --omit=dev`, and loads the plugin out of `node_modules`. **That
means `devDependencies` and `peerDependencies` are never installed on a user's machine, and npm
lifecycle scripts never run.** Everything these plugins import at runtime the host provides, so
every dependency is a devDependency and `dependencies` stays empty; anything moved into
`dependencies` is downloaded onto every user's daemon for nothing.

`files` in each `package.json` is what ships — the manifest, the two entries, `client/`, `server/`,
`shared/`, the changelog, minus `**/*.test.ts`. npm adds `README.md` and `LICENSE` on its own, which
is why each plugin folder carries its own copy of the repo's MIT `LICENSE`. **Run `npm pack
--dry-run` before publishing**; a new top-level directory is invisible to `files` and simply will
not be in the tarball, and the plugin fails to load with no clue why.

There is no build step. Paseo compiles the TypeScript itself, so the package is sources.

**Reachable code may import only what the host provides, and neither `@getpaseo/client` nor
`@getpaseo/protocol` is on that list.** The daemon's runtime-boundary plugin resolves every import
reachable from an entry, type imports included, and fails the *install* when one is missing:
`Could not resolve type dependency`. A directory or Git install never shows it, because
`npm install` in the folder has already put the whole SDK on disk and `--omit=dev` on an npm
install has not — `server/sdk-types.ts` imports `@getpaseo/client` in every plugin and is fine only
because nothing imports *it*.

When reachable code needs a Paseo type, project it out of `@getpaseo/plugin`, which re-declares
them structurally: `herald/server/host-types.ts` takes `PaseoApi` from `PluginHandlerContext` and
`AgentTimelineItem` and `AgentPermissionRequest` from `PluginLifecycleEvents`. Herald shipped
0.2.1, 0.2.2 and 0.2.3 broken this way and no typecheck, test or `npm pack` noticed — 0.2.3
because the build stops at the *first* unresolved import, so the second one only appeared once the
first was fixed. Fixing one and re-installing is the loop; do not assume one error means one bug.
`server/host-imports.test.ts` is the guard, duplicated in every plugin: it walks the graph from the
entry points and fails on any crossing that is not host-injected, a Node builtin, or a real runtime
`dependency`. It is why `github-board` has a test script at all. It cannot prove the install
works — only the daemon resolving the real tree does that — so **before publishing anything whose
imports moved, install the published package**, against a throwaway home so the user's own daemon
is untouched:

```bash
mkdir -p /tmp/paseo-check
printf '%s' '{"version":1,"daemon":{"listen":"127.0.0.1:6799"},"pluginsEnabled":true}' \
  > /tmp/paseo-check/config.json
paseo daemon run --home /tmp/paseo-check &          # never restart the real one
paseo plugin install npm:@gpambrozio/paseo-<id> --home /tmp/paseo-check
paseo plugin ls --home /tmp/paseo-check             # want: status running
```

Every plugin here is installed from a *directory* pointing at a working clone, so installing one
over itself on the real daemon would replace that with an npm copy. Use the throwaway home.

**Publishing is npm trusted publishing (OIDC), so there is no npm token anywhere** — not in the
repo, not in a secret. `.github/workflows/publish.yml` asks GitHub for a short-lived identity token
via `permissions: id-token: write`, and each package names *that file, by path* as its trusted
publisher on npmjs.com. Renaming or moving the workflow silently breaks every publish until
every package is reconfigured, so treat its filename as an interface. The same mechanism attaches
provenance to each release for free, because the repository and the packages are public.

**A package npm has never seen cannot be published this way.** A trusted publisher is configured on
an existing package's settings, so the first version of any *new* plugin has to go up by hand —
`npm publish --otp=<code>` from the folder, with the account's second factor — and the trusted
publisher is configured after it lands (`npm trust github <package> --workflow publish.yml`, or the
web UI). See [npm/cli#8544](https://github.com/npm/cli/issues/8544), still open. That is a one-time
cost per plugin, not per release.

### The SDK dependency

All six plugins now depend on the real published `@getpaseo/plugin`, pinned to the exact version
the daemon runs — `0.9.0` at the time of writing. Pin it *exactly*: `npm install --save-dev` writes
a caret, and a range here is the same bet on an unreleased shape that the prerelease trap below
describes. `skills` used to ship a hand-written
`paseo-plugin.d.ts` shim instead; it was deleted in the 0.8 migration, because every new host API
had to be hand-declared into it before it could be used.

`@getpaseo/plugin` peer-depends on the *exact* `@getpaseo/client` and `@getpaseo/protocol` it ships
against, so all three move together: `npm install @getpaseo/plugin@<v> @getpaseo/client@<v>
@getpaseo/protocol@<v>` in one command. Bumping one alone fails `ERESOLVE`. Track the daemon's
version — `paseo daemon status` prints it.

**A prerelease of the SDK is not the release, and nothing tells you when it stops matching.** The
semver range in `paseo-plugin.json` is satisfied either way, the daemon loads the plugin, and
`tsc` type-checks happily against whatever shape the pinned types happen to declare — so a
contribution the shipped app has since redefined compiles clean and is rejected at runtime, in the
app, where no log here shows it. `skills` sat on `0.8.0-beta.1` past the 0.8.0 release and lost its
composer pill exactly that way. When `paseo daemon status` prints a version, pin that version.

Because `skipLibCheck: true` is set everywhere, an unresolvable `@getpaseo/client` import is
swallowed silently and the entire Paseo API types as `any` — and `tsc` still exits 0, so a clean
typecheck does not prove the types resolved. **`server/sdk-types.ts` in each plugin is that check**,
standing where a throwaway file used to: it reads a nonexistent member off a `PaseoAgentHandle`
under a `@ts-expect-error`, so it fails in both directions — the access errors while the types are
real, and the directive itself reports TS2578 the moment they degrade to `any`. It is `import
type`-only and lands in no bundle. Do not delete it, and do not "fix" it by removing the directive.

`noImplicitAny` catches part of the same failure, but only where our own code destructures an SDK
value; a handler that just passes `paseo` through type-checks as happily against `any`. The usual
cause is a stale `node_modules` — the lockfiles pin the right version, so `npm install` in the
plugin folder is the fix.

Every `tsconfig.json` now includes `**/*.ts` and `**/*.tsx`; a `client/`, `server/` or `shared/`
subdirectory invisible to `tsc` is the failure mode that made that necessary.

## Releases

Each plugin versions on its own: a `version` in its `package.json`, a matching `## [x.y.z]` heading
in its `CHANGELOG.md`, a published npm package, and a tag. A release is three things to a user — a
version to install, a tag to pin, and an entry to read before they move.

**Tags are namespaced per plugin**: `skills/v0.1.0`, `github-board/v0.6.0`, `launchd-jobs/v0.3.0`,
`herald/v0.1.0`.
A tag names a repo-wide commit, so `github-board/v0.6.0` points at a tree where the other two
plugins sit at whatever in-between state they were in. That is harmless, because an install is
`(repo, ref, path)` and `--path` decides which folder the daemon loads — the other two are never
read. It is also why a bare `v0.6.0` would be a lie about the other two. Never cut one.

**Merging the version bump to `main` is the whole job.** `.github/workflows/publish.yml` runs on
every push to `main`, looks for a plugin whose `package.json` version has no `<plugin>/v<version>`
tag, and for each one typechecks, tests, publishes to npm and *then* cuts the release — notes built
from the plugin's own changelog, install line and all. Nothing is cut by hand any more.

**So the merge is the release.** Everything that used to happen between merging and releasing has
to happen before merging instead: the by-hand checks a plugin's own AGENTS.md lists, and a look at
the panel, because there is no harness for plugin UI and no chance to look afterwards. Merge the
bump when you are ready to ship it, not when the code is right.

Three properties worth knowing, all of them deliberate:

- **It keys on the tag, not on the diff.** A bump that merged while the workflow was broken is
  picked up by the next push to land, and re-running the same commit does nothing twice.
- **npm first, the release second.** A failed publish now leaves no release at all, rather than a
  release pointing at a version npm does not have — and paseo.cafe reads the npm version, so that
  used to fail the listing's validation until somebody noticed.
- **A missing changelog section fails the run.** A release is a version to install, a tag to pin
  and an entry to read; the first two are automatic now, so the third is checked rather than
  assumed.

**`checks.yml` is what a pull request has to pass**, and `main` requires it. It typechecks and
tests every plugin, and runs `.github/scripts/check-plugin-consistency.mjs`, which reads the
declarations inside each plugin that only a human keeps in step: the version in `package.json`
against both copies of it in `package-lock.json`, every declared dependency range against the
lockfile's, and the existence of a `## [<version>]` changelog section. Nothing else sees a plugin
whole — `tsc` does not read a lockfile, and **`npm ci` does not catch a stale one**, because it
only asks whether the locked tree *satisfies* `package.json`, which a resolved `0.9.0` does for an
exact `0.9.0`. #32 shipped five drifted lockfiles through every gate in this repository exactly
that way; #33 is both the fix and the check.

Branch protection requires one status, **`Checks passed`** — an aggregating job that fails if any
matrix job failed, was cancelled *or* was skipped. Requiring the per-plugin jobs directly would mean
editing the rule whenever a plugin is added, and a rule naming a job that no longer runs blocks
every merge until somebody works out why.

Run `npm run typecheck` and `npm test` in the plugin folder anyway — CI answering in two minutes is
not a reason to find out from CI. The publish run repeats both for the plugin it is releasing, which
is deliberate belt and braces: the PR check proves the branch was sound, the publish job proves the
commit it is about to ship still is.

Two ways in by hand remain. `workflow_dispatch` takes a plugin by name and publishes whatever
version its `package.json` declares, which is how a failed publish is re-run. And a release
published by hand still publishes, for a tag somebody cut themselves:

```bash
gh release create "<plugin>/v<version>" --target <merge-commit> \
  --title "<plugin> <version>" --notes-file <notes>
```

where the notes are the plugin's install line followed by its top changelog section verbatim —
exactly what the push path generates:

```bash
paseo plugin install npm:@gpambrozio/paseo-<plugin>@<version>
```

**`npm publish` cannot move out of `publish.yml`**, into a second workflow or a reusable one: each
package names that file *by path* as its trusted publisher, and npm matches on the filename. That
constraint is also why the push path cuts the release itself instead of leaving it to the `release`
trigger — **a release created with the default `GITHUB_TOKEN` does not start a workflow run**,
GitHub suppresses it so workflows cannot trigger themselves, so a workflow that only created the
release would publish nothing and say nothing about it.

Watch a merge with `gh run watch` until you trust it.

**What earns a version** is what a user of the plugin can observe, which is the same bar the
changelog entry has to clear. A dev-dependency bump earns neither: every dependency in every
plugin is a devDependency and reaches no bundle, so there is no line worth reading and nothing
changes for someone who re-pins.

**The "Latest" badge is repo-wide and arbitrary.** GitHub designates exactly one non-draft,
non-prerelease release as latest across the whole repository, and passing `--latest=false` to every
release does not clear it — it leaves the flag wherever GitHub put it, which is whichever release
was cut most recently. There is no per-directory latest. Ignore the badge rather than trying to
manage it, and do not bother correcting which release is wearing it.

## Listing on paseo.cafe

A new plugin here is listed in the community directory at [paseo.cafe](https://paseo.cafe) as well
as released. It is unofficial — not run by, endorsed by, or affiliated with Paseo. The listing is
*generated from this repo*: description, version, licence, screenshots and a limitations excerpt are
all read from the plugin's own folder, so submitting is one small file opened as a PR against
[`paseo-cafe/paseo-cafe`](https://github.com/paseo-cafe/paseo-cafe) and nothing here is written
twice. Every plugin but `firstmate` is listed, submitted as `gpambrozio`, and each entry declares
its `package` so that 0.9 installs it from npm; `firstmate` goes up once its first version is on npm — the registry's CI checks that the published package
carries the same plugin id *and the same version* as the folder here, which is the other reason to
publish before tagging.

**Read the current instructions before submitting, and do not follow a remembered shape — including
the shape of the entries already there.** The required fields, the validation and the CI behind them
move often enough that anything copied into this file would be wrong within months. Start at
<https://paseo.cafe/submit>, which has a prefilled "create this file on GitHub" button, and the
*Submitting a plugin* section of that repository's `README.md`. That repository's own
`registry:validate` script is what actually decides, so run it against the new entry before opening
the PR rather than trusting it to look right.

## skills

Discovers skills by scanning the filesystem — `~/.claude`, `~/.agents`, `~/.codex`, `/etc/codex`,
and every directory from the agent's cwd up to the repo root — because source and rendered body
need the `SKILL.md` itself. Entries bundled inside an agent binary live on no scannable path, so
they come from `agent.commands()` instead and get their own sections, carrying a name, a
description, and an argument hint but no path and no body. That method shipped in Paseo
`0.7.0-beta.2`; `server/resolve/reported.ts` feature-detects it, which is now belt and braces — the
manifest already requires 0.9 — but costs nothing and documents the dependency.
`server/skills.ts` dispatches on `agent.provider`; only `claude` and `codex` resolve, everything
else reports unsupported.

`SkillEntry` (`server/resolve/skill-entry.ts`) and `SkillEntrySchema` (`shared/skills.ts`) are
separate declarations of the same shape. A mismatch fails zod validation at runtime, not at compile
time.

`docs/design.md` records why discovery is shaped this way; its Limitations section exists because a
reviewer proved the code wrong about the real world. `docs/execution-ledger.md` records what each
decision costs if it turns out wrong.

To check discovery against reality rather than fixtures, write a throwaway `*.tmp.test.ts` that
runs a resolver against the real `~/.claude` and a real workspace, read what it prints, then delete
it. **Never write to `~/.claude`.**

## herald

Watches every agent through the server lifecycle hooks and has a short-lived helper agent write a
spoken sentence about what the agent needs; the app speaks it and a sidebar panel lists it. Three
constraints shape it, all in `herald/AGENTS.md`: a hook has 30 seconds and a summary does not fit, so
summaries are detached from the handler; the helper is a visible agent that fires this plugin's own
hooks, is recognised by title as well as id, and — since the plugin API has no hard delete — is
removed afterwards by shelling out to the `paseo` CLI; and the app cannot run `say`, so the daemon
renders the sentence with it and the client plays the bytes through the browser's audio element, with
the Web Speech API as the fallback — desktop and browser only, since nothing in the 0.8 plugin API plays audio
on a phone.

## model-pricing

A sidebar table of what every model costs, across Anthropic, OpenAI, Fireworks AI, Ollama Cloud and
OpenRouter, with a settings screen choosing which of them are fetched and shown. The shape is forced
by one fact, recorded in `model-pricing/AGENTS.md`: **nobody sells a pricing API**. Anthropic's,
OpenAI's and Fireworks' own `GET /v1/models` each want a key and return no prices, so four of the
five providers are read from the community `models.dev` catalog and only OpenRouter publishes its
own. Prices are normalized to `PriceRow` *before* anything is cached, because models.dev answers
with 4.7 MB and neither the cache file nor the RPC payload may carry that.

Two things there are worth knowing before touching it. `null` on a capability means the upstream did
not say, not "no", and the filters and the table both honour that. And the whole settings document is
client-read — "which providers to refresh" and "which to show" are one switch, because the surface
passes the enabled ids into the RPC rather than the daemon keeping a copy.

## firstmate

Talk to one "first mate" agent and it runs a crew of worker agents, each in its own Paseo worktree; a
sidebar surface puts the conversation beside a board of the crew. A Paseo-native port of the
[firstmate](https://github.com/kunchenguid/firstmate) agent distro, replacing
ABorakati's `paseo-firstmate`, which was a dashboard over that distro's bash scripts and tmux sessions.
Three things shape it, all in `firstmate/AGENTS.md`: **the plugin never dispatches a crewmate** — the
first mate does, with Paseo's own MCP tools, following a charter (`server/charter.ts`) written into its
home as `AGENTS.md`; **supervision is Paseo's** — the MCP `create_agent` call's `notifyOnFinish` wakes the
first mate when a crewmate finishes, errors or asks for permission, so there is no watcher, and those
tools are off by default in Paseo (`daemon.mcp.injectIntoAgents`), which the board offers to turn on;
and **the crew is found by label**, `firstmate.role=crew`, which the charter and the board read from the
same constant.
