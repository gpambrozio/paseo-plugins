# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Plugins for [Paseo](https://paseo.sh), one self-contained folder per plugin: `skills/` and
`github-board/`. Plugin code is trusted and unsandboxed — the server half runs next to the daemon
with its files, processes, and credentials; the client half runs inside the Paseo app.

Each plugin has its own `CLAUDE.md` for what only that plugin does — `skills/CLAUDE.md` before
touching skill discovery, `github-board/CLAUDE.md` before touching the `gh` queries or the board's
caching. This file is only what they share.

## There is no workspace root

Each folder is an independent npm project with its own `package.json`, `node_modules`,
`tsconfig.json`, and `paseo-plugin.json`. Nothing is hoisted, and there is no root `package.json`.
Every command below runs from inside a plugin folder, never from the repo root.

`paseo plugin install` records the absolute directory it was given and the daemon loads from that
path on every start, so moving this clone means reinstalling every plugin in it.

```bash
cd skills          # or github-board
npm install
npm run typecheck  # both plugins
npm test           # skills only — github-board defines no test script
```

Single test (skills, vitest):

```bash
npm test -- resolve/frontmatter.test.ts     # one file
npm test -- -t "dedupes by name"            # one test by name
```

## Dev loop against a running daemon

```bash
paseo plugin reload skills        # after any source change; id, not folder name
paseo plugin logs skills          # load errors and stderr
```

- The plugin id comes from `paseo-plugin.json`, which `paseo plugin init` seeds from the directory
  basename. The ids are `skills` and `github-board`.
- **A failed reload stays failed.** Paseo does not restore the previous code.
- **Never restart the daemon** — it manages the user's running agents.
- The daemon needs `"pluginsEnabled": true` in its `config.json`, and Paseo 0.5.0-beta or newer.
- There is no harness for plugin UI. A clean typecheck and a clean reload prove a `*.client.tsx`
  change compiles and loads, nothing more; a human has to look at the panel.

## Plugin architecture

Both plugins are the same shape. `index.ts` is wiring only — it binds RPC contracts to handlers and
registers UI contributions, and returns a cleanup function:

```ts
export default function contribute(plugin: PluginContext) {
  plugin.handle(loadBoard, loadBoardHandler);
  plugin.addSurface("board", GitHubBoard);      // github-board: global sidebar surface
  plugin.addWorkspacePanel({ context: "agent", ... });  // skills: per-agent workspace tab
  plugin.addCommandCenterItem({ ... });
  return () => {};
}
```

A top-level React call or `StyleSheet.create` in `index.ts` executes in the server bundle. Keep it
out.

**File suffixes decide which bundle code lands in**, and crossing the boundary fails compilation:

| Suffix | Owns |
| --- | --- |
| `*.client.tsx` | React and UI. May import only `react`, `react-native`, `@tanstack/react-query`, `zod`, `@getpaseo/plugin`. |
| `*.server.ts` | Node built-ins, filesystem, subprocesses. |
| `*.shared.ts` | zod RPC contracts (`defineRpc`), imported by both halves. |

A plain `.ts` file with no suffix (e.g. `skills/resolve/skill-entry.ts`) lands in both bundles, so
it must stay free of Node imports.

Client and server never share a process. Every crossing is a `defineRpc` contract in `*.shared.ts`,
called from the client with `useRpc(contract)` and answered by `plugin.handle`. Handlers receive a
`PluginHandlerContext` carrying `paseo`, the host API — that is how `skills.server.ts` resolves an
`agentId` to its provider and cwd.

### Constraints nothing catches at compile time

- **RPC wire names must match `/^[a-z][a-z0-9._-]*$/`.** camelCase names load-fail with "Invalid
  plugin RPC method" and the plugin never starts. Use Paseo's dotted namespacing: `board.load`,
  `skills.list`. The exported identifier is unrelated to the wire name.
- **Six theme tokens exist**: `surface0`, `foreground`, `foregroundMuted`, `accent`,
  `accentForeground`, `statusDanger`. Any other name renders as undefined at runtime. Never
  hardcode a colour.
- **`icon` is any Lucide component name**, typed as a bare `string`. The host resolves it with
  `Reflect.get` over the Lucide barrel and throws `Unknown Lucide icon: <name>` at contribution
  time, so a typo load-fails the plugin. Brand icons are in there too — `Github`.
- **Relative imports are extensionless** — `./frontmatter`, not `./frontmatter.js`.
- **`Linking.openURL` is `window.open` on the desktop renderer**, which opens a bare child window
  because the Electron window installs no window-open handler. Route external URLs through
  `globalThis.paseoDesktop?.opener?.openUrl` and fall back to `Linking` for mobile and web — see
  `openExternalUrl` in `github-board/board.client.tsx`.
- **Plugin Command Center items are pinned below file results.** The host hardcodes their group
  rank, so single-word keywords get buried by filename matches.

### The two plugins resolve `@getpaseo/plugin` differently

`github-board` depends on the real published `@getpaseo/plugin` package. `skills` does not — it
ships a hand-written `paseo-plugin.d.ts` declaring both `@getpaseo/plugin` and
`@getpaseo/plugin/server`, with only `@getpaseo/client` installed. Adding a host API to `skills`
means adding it to that shim first.

Because `skipLibCheck: true` is set in both, an unresolvable `@getpaseo/client` import is swallowed
silently and the entire Paseo API types as `any`. Keep that dependency at `^0.5.0-beta.3` or newer.

The tsconfigs also differ: `skills` includes `**/*`, `github-board` includes only `*.ts`/`*.tsx` at
its root, so a new subdirectory there is invisible to `tsc` until the `include` is widened.

## skills

Discovers skills by scanning the filesystem — `~/.claude`, `~/.agents`, `~/.codex`, `/etc/codex`,
and every directory from the agent's cwd up to the repo root — because the live session's command
list is unreachable from plugin code. Consequence: Claude's bundled skills never appear. `skills.server.ts` dispatches on `agent.provider`; only `claude` and `codex`
resolve, everything else reports unsupported.

`SkillEntry` (`resolve/skill-entry.ts`) and `SkillEntrySchema` (`skills.shared.ts`) are separate
declarations of the same shape. A mismatch fails zod validation at runtime, not at compile time.

`docs/design.md` records why discovery is shaped this way; its Limitations section exists because a
reviewer proved the code wrong about the real world. `docs/execution-ledger.md` records what each
decision costs if it turns out wrong.

To check discovery against reality rather than fixtures, write a throwaway `*.tmp.test.ts` that
runs a resolver against the real `~/.claude` and a real workspace, read what it prints, then delete
it. **Never write to `~/.claude`.**
