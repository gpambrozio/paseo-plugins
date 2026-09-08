# CLAUDE.md

A Paseo plugin that lists the agent skills available to an agent session, shows where each one
comes from, renders its `SKILL.md`, and invokes it.

The repo root `CLAUDE.md` covers what every plugin here shares: the per-folder npm layout, the
typecheck/test/reload loop, the client/server bundle split, and the constraints nothing catches at
compile time. This file covers only what is specific to `skills`.

Discovery reads the filesystem, and that is why the design looks the way it does: two of the three
goals — source and rendered body — need the `SKILL.md` itself, which the live session cannot supply.
`agent.commands()` asks the session what it loaded and is used additively, for the built-in and
bundled entries that live on no scannable path. It carries only a name, a description, and an
argument hint. It answers for every provider, which is why the panel has no "unsupported provider"
state: `scanned` records whether discovery walked a directory, and nothing more.

Do not edit the Paseo host from here. Adding `agent.commands()` upstream (getpaseo/paseo#3719) was a
deliberate exception, taken because no plugin-side workaround exists for skills compiled into an
agent binary. Read the host's checkout to understand it; treat another change to it as a decision to
argue for, not a step to take.

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
- **Codex scans `.agents/skills`, not `.codex/skills`.** Its documented search path is
  `<dir>/.agents/skills` for every dir from cwd to the repo root, then `~/.agents/skills`, then
  `/etc/codex/skills`. `.codex/skills` is read one rank lower only because Paseo's orchestration
  sync writes there and older builds read it. Paseo's own `listCodexSkills` is stale on this; do
  not "fix" the resolver back to matching it.
- **A source kind lives in three files.** `SkillSourceKind` (`server/resolve/skill-entry.ts`), the
  zod enum (`shared/skills.ts`), and `SOURCE_ORDER` (`client/panel.tsx`). The first two disagreeing
  fails validation at runtime; a kind missing from the third sorts to the top of the panel, since
  `indexOf` returns `-1`.
- **Claude plugin scoping keys on `projectPath`, not on `scope`.** Real manifests carry
  `scope: "local"` entries that are per-project. An entry with a `projectPath` applies only inside
  it; one without applies everywhere.
- **Do not apply `unquote()` to block-scalar continuation lines** in `server/resolve/frontmatter.ts`.
  Block scalar content is literal YAML, quotes included; stripping them corrupts real skills.
- **`agent.commands()` is detected structurally, not trusted from the types.** The `paseo` object
  comes from the daemon's bundled client, not this folder's `node_modules`, so what the types
  declare and what the object has are two different questions. `requirements.paseo: ">=0.8.0"` now
  guarantees a daemon well past the `0.7.0-beta.2` that added the method, so `supportsCommands()` in
  `server/resolve/reported.ts` is belt and braces rather than load-bearing — but it costs one
  `typeof` and it documents that the boundary is a runtime one. Keep it.
- **Nothing in Paseo enumerates registered panels.** `addWorkspacePanel` registers the tab type
  only; the panel is reachable because the Command Center item and the composer pill both call
  `openPanel`. Remove both and the panel exists but cannot be opened.
- **The pill's registration loop *is* the client entry.** Before 0.8 it was a callback handed to
  `addClientSide`; now `index.client.tsx` runs in the app directly and calls `contributePills`,
  returning its cleanup as the entry's. The `paseo-plugin.d.ts` shim that used to type all of this
  by hand is gone — `@getpaseo/plugin` is a real dependency, so a new host API needs no declaration
  written first.
- **A pill's registration is not its render.** `contributePills` registers a pill for every agent
  on the host, but the component only mounts when that agent's composer is on screen — which is
  what keeps the badge's `skills.list` call bounded to visible agents rather than to every agent
  that exists.
