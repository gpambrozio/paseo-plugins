# Contributing

Thanks for taking a look. This repo holds three independent Paseo plugins, one per folder:
[`skills/`](skills), [`github-board/`](github-board), and [`launchd-jobs/`](launchd-jobs).

## There is no workspace root

Each folder is its own npm project with its own `package.json`, `node_modules`, `tsconfig.json`,
and `paseo-plugin.json`. Nothing is hoisted, and there is no root `package.json`. Every command
below runs from inside a plugin folder.

```bash
cd skills          # or github-board, launchd-jobs
npm install
npm run typecheck  # every plugin has this
npm test           # skills and launchd-jobs only — github-board defines no test script
```

Run a single test (vitest):

```bash
npm test -- resolve/frontmatter.test.ts     # one file
npm test -- -t "dedupes by name"            # one test by name
```

## Trying a change against a running daemon

`paseo plugin install` records the absolute directory it was given, so install from this clone and
reload after each change. The id comes from `paseo-plugin.json`, not the folder name — they happen
to match here.

```bash
paseo plugin reload skills
paseo plugin logs skills     # load errors and stderr
```

Two things worth knowing:

- **A failed reload stays failed.** Paseo does not restore the previous code. Check the logs.
- **Never restart the daemon** to pick up a change. It manages the user's running agents.

The daemon needs `"pluginsEnabled": true` in its `config.json`, and **Paseo 0.8.0 or newer** — the
app too, which checks the plugin's `requirements.paseo` against its own version.

## Client and server are separate bundles

Each plugin has up to two entries, `index.client.tsx` and `index.server.ts`, and at least one is
required. **Directories** decide which bundle your code lands in, and crossing the boundary fails
compilation:

| Directory | Owns |
| --- | --- |
| `client/` | React and UI. May import only the modules the host provides: `react`, `react-native`, `@tanstack/react-query`, `zod`, `@getpaseo/plugin`, `@getpaseo/plugin/client`, `@getpaseo/plugin/client/react-native`, `@getpaseo/plugin/client/ui`. |
| `server/` | Node built-ins, filesystem, subprocesses, RPC handlers. |
| `shared/` | zod RPC contracts (`defineRpc`) and settings documents (`defineSettings`), imported by both halves. No Node, no React. |

Filename suffixes mean nothing, and a code module at the plugin root is a compile error — only the
manifest, `package.json`, `tsconfig.json` and the entries live there. Client and server never share
a process; every crossing is a `defineRpc` contract.

## The rules a compiler won't catch

These have each broken a plugin at runtime. `CLAUDE.md` in the repo root has the full list; the ones
that bite most often:

- **No async arrow functions in client-bundle code.** The app `eval`s the client bundle, and on iOS
  and Android Hermes evaluates an async *arrow* to `undefined` instead of a function — no compile
  error, no load error, just "undefined is not a function" when something calls it. Use an async
  `function` expression. Desktop runs on V8 and won't show you this.
- **RPC wire names must match `/^[a-z][a-z0-9._-]*$/`.** camelCase load-fails the whole plugin. Use
  dotted namespacing: `board.load`, `skills.list`.
- **Colour comes from `theme.colors`, never a literal.** The tokens are `surface0`, `surface1`,
  `surface2`, `foreground`, `foregroundMuted`, `border`, `accent`, `accentForeground`,
  `statusSuccess`, `statusWarning`, `statusDanger`. Anything else renders undefined.
- **Browser globals live only in `client/web.ts`.** No `tsconfig` here has `DOM` in `lib`, so
  `document` and `window` are type errors by default; that one module declares what it uses and
  gates each export on `Platform.OS`.
- **Relative imports are extensionless** — `./frontmatter`, not `./frontmatter.js`.
- **A surface is unmounted when the user navigates away.** Anything that should survive the round
  trip lives in a module-scope variable the component reads on mount.

## Testing UI

There is no harness for plugin UI. A clean typecheck and a clean reload prove a `client/` change
compiles and loads — nothing more. Someone has to look at the panel. If your change touches
UI, say in the PR what you saw, and on which platform: desktop is the web export on V8, and mobile
is Hermes, so they fail differently.

## Pull requests

`main` requires a pull request and takes squash merges only, so your branch becomes one commit.
Before opening one:

- `npm run typecheck` passes in every plugin you touched
- `npm test` passes in `skills` and `launchd-jobs` if you touched them
- You reloaded the plugin against a real daemon and it loaded

If you added a host API call, note the minimum Paseo version it needs — older daemons must still
load the plugin with only that feature missing.
