# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Plugins for [Paseo](https://paseo.sh), one self-contained folder per plugin: `skills/`,
`github-board/`, and `launchd-jobs/`. Plugin code is trusted and unsandboxed — the server half runs
next to the daemon with its files, processes, and credentials; the client half runs inside the
Paseo app.

Each plugin has its own `CLAUDE.md` for what only that plugin does — `skills/CLAUDE.md` before
touching skill discovery, `github-board/CLAUDE.md` before touching the `gh` queries or the board's
caching, `launchd-jobs/CLAUDE.md` before touching anything that calls `launchctl` or writes a
plist. This file is only what they share.

## There is no workspace root

Each folder is an independent npm project with its own `package.json`, `node_modules`,
`tsconfig.json`, and `paseo-plugin.json`. Nothing is hoisted, and there is no root `package.json`.
Every command below runs from inside a plugin folder, never from the repo root.

`paseo plugin install` records the absolute directory it was given and the daemon loads from that
path on every start, so moving this clone means reinstalling every plugin in it.

```bash
cd skills          # or github-board, launchd-jobs
npm install
npm run typecheck  # every plugin
npm test           # skills and launchd-jobs — github-board defines no test script
```

Single test (skills and launchd-jobs, vitest):

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
  basename. The ids are `skills`, `github-board`, and `launchd-jobs`.
- **A failed reload stays failed.** Paseo does not restore the previous code.
- **Never restart the daemon** — it manages the user's running agents.
- The daemon needs `"pluginsEnabled": true` in its `config.json`, and **Paseo 0.8.0 or newer**. All
  three plugins declare `requirements.paseo: ">=0.8.0"`; on an older daemon they do not degrade,
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
  alternative or a no-op — see `github-board/client/web.ts`, which owns both the desktop URL opener
  (`Linking.openURL` is `window.open` on the desktop renderer, which opens a bare child window) and
  the document-level pointer tracking the detail panel's resize handle needs on web.
- **Plugin Command Center items are pinned below file results.** The host hardcodes their group
  rank, so single-word keywords get buried by filename matches.
- **A surface is unmounted when the user navigates away** — to a workspace, an agent, anywhere —
  and mounted fresh on the way back, so component state is gone. Anything that should survive the
  round trip and is *not* worth persisting (a loaded board, the open pane, a half-typed form) lives
  in module-scope variables the component reads on mount: `cachedBoard` in `github-board`,
  `cachedPane` and `cachedDraft` in `launchd-jobs`. Anything that *is* worth persisting belongs in a
  settings document, which the host restores on its own.
- **A surface cannot open its own settings screen.** `PluginSurfaceProps` carries no
  `openSettings`; only `PluginClientContext` and a Command Center or slash-command callback have it.
  A surface that needs to reach one has to keep its own in-surface editor or route the user through
  ⌘K — see `github-board`, which does both.

### Versions

`paseo-plugin.json` carries `requirements.paseo`, an npm semver range. **A missing
`requirements.paseo` means `<0.8.0`**, so 0.8 rejects the plugin outright with a link to the
migration guide — adding the field is part of migrating, not a substitute for it. All three plugins
here declare `>=0.8.0`.

The daemon checks the range before installing or loading, and **each connected app checks it against
its own version** before evaluating client code. That second check is what retired this repo's
version-sniffing fallbacks: a client old enough to lack `props.navigation` is a client too old to
evaluate the bundle at all, so the prop is always there in practice even though it is typed
optional.

### The SDK dependency

All three plugins now depend on the real published `@getpaseo/plugin`, pinned to the exact version
the daemon runs — `0.8.0-beta.1` at the time of writing. `skills` used to ship a hand-written
`paseo-plugin.d.ts` shim instead; it was deleted in the 0.8 migration, because every new host API
had to be hand-declared into it before it could be used.

`@getpaseo/plugin` peer-depends on the *exact* `@getpaseo/client` and `@getpaseo/protocol` it ships
against, so all three move together: `npm install @getpaseo/plugin@<v> @getpaseo/client@<v>
@getpaseo/protocol@<v>` in one command. Bumping one alone fails `ERESOLVE`. Track the daemon's
version — `paseo daemon status` prints it.

Because `skipLibCheck: true` is set everywhere, an unresolvable `@getpaseo/client` import is
swallowed silently and the entire Paseo API types as `any` — and `tsc` still exits 0, so a clean
typecheck does not prove the types resolved. To check, add a throwaway file that reads a nonexistent
member off a `PaseoAgentHandle` and confirm `tsc` rejects it.

Every `tsconfig.json` now includes `**/*.ts` and `**/*.tsx`; a `client/`, `server/` or `shared/`
subdirectory invisible to `tsc` is the failure mode that made that necessary.

## skills

Discovers skills by scanning the filesystem — `~/.claude`, `~/.agents`, `~/.codex`, `/etc/codex`,
and every directory from the agent's cwd up to the repo root — because source and rendered body
need the `SKILL.md` itself. Entries bundled inside an agent binary live on no scannable path, so
they come from `agent.commands()` instead and get their own sections, carrying a name, a
description, and an argument hint but no path and no body. That method shipped in Paseo
`0.7.0-beta.2`; `server/resolve/reported.ts` feature-detects it, which is now belt and braces — the
manifest already requires 0.8 — but costs nothing and documents the dependency.
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
