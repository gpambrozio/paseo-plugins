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

The daemon needs `"pluginsEnabled": true` in its `config.json`.

## Client and server are separate bundles

File suffixes decide which bundle your code lands in, and crossing the boundary fails compilation:

| Suffix | Owns |
| --- | --- |
| `*.client.tsx` | React and UI. May import only `react`, `react-native`, `@tanstack/react-query`, `zod`, `@getpaseo/plugin`. |
| `*.server.ts` | Node built-ins, filesystem, subprocesses. |
| `*.shared.ts` | zod RPC contracts (`defineRpc`), imported by both halves. |

A plain `.ts` file with no suffix lands in **both** bundles, so it has to stay free of Node imports.
Client and server never share a process; every crossing is a `defineRpc` contract.

## The rules a compiler won't catch

These have each broken a plugin at runtime. `CLAUDE.md` in the repo root has the full list; the ones
that bite most often:

- **No async arrow functions in client-bundle code.** The app `eval`s the client bundle, and on iOS
  and Android Hermes evaluates an async *arrow* to `undefined` instead of a function — no compile
  error, no load error, just "undefined is not a function" when something calls it. Use an async
  `function` expression. Desktop runs on V8 and won't show you this.
- **RPC wire names must match `/^[a-z][a-z0-9._-]*$/`.** camelCase load-fails the whole plugin. Use
  dotted namespacing: `board.load`, `skills.list`.
- **Only six theme tokens exist**: `surface0`, `foreground`, `foregroundMuted`, `accent`,
  `accentForeground`, `statusDanger`. Anything else renders undefined. Never hardcode a colour.
- **Relative imports are extensionless** — `./frontmatter`, not `./frontmatter.js`.
- **A surface is unmounted when the user navigates away.** Anything that should survive the round
  trip lives in a module-scope variable the component reads on mount.

## Testing UI

There is no harness for plugin UI. A clean typecheck and a clean reload prove a `*.client.tsx`
change compiles and loads — nothing more. Someone has to look at the panel. If your change touches
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
