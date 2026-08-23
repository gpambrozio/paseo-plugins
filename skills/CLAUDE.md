# CLAUDE.md

A Paseo plugin that lists the agent skills available to an agent session, shows where each one
comes from, renders its `SKILL.md`, and invokes it.

The repo root `CLAUDE.md` covers what every plugin here shares: the per-folder npm layout, the
typecheck/test/reload loop, the client/server bundle split, and the constraints nothing catches at
compile time. This file covers only what is specific to `skills`.

The plugin never changes the Paseo host. `PaseoAgentHandle` exposes no `listCommands`, so the live
session's own command list is unreachable and discovery reads the filesystem instead — that
constraint is why the design looks the way it does. Read the host's checkout to understand it,
never edit it from here.

## Orientation

| Doc                        | What's in it                                                              |
| -------------------------- | ------------------------------------------------------------------------- |
| `README.md`                | Install, the dev loop, and what each file owns.                           |
| `docs/design.md`           | Why it is shaped this way, and what it deliberately does not do.          |
| `docs/execution-ledger.md` | Every decision taken while building it, and what each costs if it's wrong. |

Read `docs/design.md` before changing discovery. Its Limitations section is load-bearing — three
entries there exist because a reviewer proved the code was wrong about the real world.

## Gotchas

- **The plugin id is `skills`, not `paseo-skills`.** `paseo plugin init` took it from the directory
  basename, and the folder was renamed when this moved into `paseo-plugins`. Every CLI command uses
  `skills`.
- **Claude plugin scoping keys on `projectPath`, not on `scope`.** Real manifests carry
  `scope: "local"` entries that are per-project. An entry with a `projectPath` applies only inside
  it; one without applies everywhere.
- **Do not apply `unquote()` to block-scalar continuation lines** in `resolve/frontmatter.ts`.
  Block scalar content is literal YAML, quotes included; stripping them corrupts real skills.
- **The Command Center item is the only way to open the panel.** `addWorkspacePanel` registers the
  tab type; nothing in Paseo enumerates registered panels, so removing the Command Center item
  makes the panel unreachable.
