# CLAUDE.md

A Paseo plugin that lists the agent skills available to an agent session. It runs as trusted,
unsandboxed code: the server half reads the daemon machine's filesystem, the client half runs
inside the Paseo app.

This repo is standalone. It is not part of the Paseo monorepo at `~/Development/paseo` — read that
checkout to understand the host, never edit it from here.

## Orientation

| Doc                        | What's in it                                                              |
| -------------------------- | ------------------------------------------------------------------------- |
| `README.md`                | Install, the dev loop, and what each file owns.                           |
| `docs/design.md`           | Why it is shaped this way, and what it deliberately does not do.          |
| `docs/execution-ledger.md` | Every decision taken while building it, and what each costs if it's wrong. |

Read `docs/design.md` before changing discovery. Its Limitations section is load-bearing — three
entries there exist because a reviewer proved the code was wrong about the real world.

## Rules nothing enforces

Break these and you get a runtime failure, not a compile error.

- **File suffixes decide which bundle code lands in.** `*.client.tsx` owns React and UI.
  `*.server.ts` owns Node APIs and filesystem access. `*.shared.ts` owns zod contracts used by
  both. Importing a `*.server` module from a client module, or vice versa, fails compilation.
- **Node built-ins belong only in `*.server.ts` and tests.** `resolve/skill-entry.ts` is
  deliberately not a `.server.ts` file; keep it free of imports.
- **Client code may import only** `react`, `react-native`, `@tanstack/react-query`, `zod`,
  `@getpaseo/plugin`, `@getpaseo/plugin/server`. There is no clipboard package and no icon package.
- **Six theme tokens exist**: `surface0`, `foreground`, `foregroundMuted`, `accent`,
  `accentForeground`, `statusDanger`. Any other name renders as undefined at runtime. Never
  hardcode a colour.
- **Relative imports are extensionless.** `./frontmatter`, not `./frontmatter.js`.
- **`index.ts` is wiring only.** A top-level React call or `StyleSheet.create` there executes in
  the server bundle.
- **Changing `SkillEntry` means changing `SkillEntrySchema` too.** They live in different files
  (`resolve/skill-entry.ts` and `skills.shared.ts`) and a mismatch fails zod validation at runtime,
  not at compile time.

## Working on it

`npm test` and `npm run typecheck` are both fast — run them freely.

After any source change the daemon needs `paseo plugin reload skills`, then check
`paseo plugin logs skills`. A failed reload **stays failed**; Paseo does not restore the previous
code. Never restart the daemon itself — it manages the user's running agents.

`panel.client.tsx` has no automated tests and cannot get any; no harness for plugin UI exists. A
clean typecheck and a clean reload prove it compiles and loads, nothing more. Changes there need a
human to look at the panel.

To check discovery against reality rather than fixtures, write a throwaway `*.tmp.test.ts` that
runs a resolver against the real `~/.claude` and a real workspace path, read what it prints, then
delete it. That trick caught two bugs the fixtures agreed with. Never write to `~/.claude`.

## Gotchas

- **`paseo plugin init` takes the plugin id from the directory basename.** This plugin's id is
  `skills`, not `paseo-skills`. Every CLI command uses `skills`.
- **`@getpaseo/client` must stay at `^0.5.0-beta.3` or newer.** Earlier versions export no
  `PaseoApi`, and because `tsconfig.json` sets `skipLibCheck: true`, the unresolvable import is
  swallowed and the entire Paseo API silently types as `any`.
- **Claude plugin scoping keys on `projectPath`, not on `scope`.** Real manifests carry
  `scope: "local"` entries that are per-project. An entry with a `projectPath` applies only inside
  it; one without applies everywhere.
- **Do not apply `unquote()` to block-scalar continuation lines** in `resolve/frontmatter.ts`.
  Block scalar content is literal YAML, quotes included; stripping them corrupts real skills.
- **The Command Center item is the only way to open the panel.** `addWorkspacePanel` registers the
  tab type; nothing in Paseo enumerates registered panels, so removing the Command Center item
  makes the panel unreachable.
- **Plugin Command Center items are pinned below file results.** The host hardcodes their group
  rank, so a query matching filenames buries the item. Multi-word keywords avoid the collision.
