# Contributing

Thanks for taking a look. This repo holds four independent Paseo plugins, one per folder:
[`skills/`](skills), [`github-board/`](github-board), [`launchd-jobs/`](launchd-jobs), and
[`herald/`](herald).

## There is no workspace root

Each folder is its own npm project with its own `package.json`, `node_modules`, `tsconfig.json`,
and `paseo-plugin.json`. Nothing is hoisted, and there is no root `package.json`. Every command
below runs from inside a plugin folder.

```bash
cd skills          # or github-board, launchd-jobs, herald
npm install
npm run typecheck  # every plugin has this
npm test           # skills, launchd-jobs and herald — github-board defines no test script
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

The daemon needs `"pluginsEnabled": true` in its `config.json`, and **Paseo 0.9.0 or newer** — the
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

These have each broken a plugin at runtime. `AGENTS.md` in the repo root has the full list; the ones
that bite most often:

- **A closure inside a `for (let|const … of …)` body captures the loop's final value on iOS and
  Android.** The app `eval`s the client bundle, and Hermes does not give each iteration its own
  binding — no compile error, no load error, just the wrong element when the callback runs. Use
  `.map` when a callback must capture the element. Desktop runs on V8 and won't show you this.
  (Async arrows used to break the same way; the daemon has lowered them since Paseo 0.7.0.)
- **RPC wire names must match `/^[a-z][a-z0-9._-]*$/`.** camelCase load-fails the whole plugin. Use
  dotted namespacing: `board.load`, `skills.list`.
- **Colour comes from `theme.colors`, never a literal.** The tokens are `surface0`, `surface1`,
  `surface2`, `foreground`, `foregroundMuted`, `border`, `accent`, `accentForeground`,
  `statusSuccess`, `statusWarning`, `statusDanger`. Anything else renders undefined.
- **Browser globals live only in `client/web.ts`.** No `tsconfig` here has `DOM` in `lib`, so
  `document` and `window` are type errors by default; that one module declares what it uses and
  gates each export on `Platform.OS`. Opening a URL is not one of them — use `openExternalUrl` from
  `@getpaseo/plugin/client`, and `void` its promise rather than making the handler async.
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
- `npm test` passes in every plugin you touched
- If you changed a `package.json` — a version, a dependency, anything — you ran `npm install` in
  that folder so its `package-lock.json` moved with it. Editing one without the other passes
  `npm ci`, which only checks that the locked tree satisfies `package.json`, and reaches `main`.
- If you bumped a version, `CHANGELOG.md` has a `## [<version>]` section for it
- You reloaded the plugin against a real daemon and it loaded

The first four are also checked by `checks.yml` on the pull request, and `main` will not take a
merge until it passes. The fifth cannot be — there is no harness for plugin UI, and nothing in CI
can look at a panel.

If you added a host API call, note the minimum Paseo version it needs — older daemons must still
load the plugin with only that feature missing.
