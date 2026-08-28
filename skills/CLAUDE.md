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
- **A source kind lives in three files.** `SkillSourceKind` (`resolve/skill-entry.ts`), the zod
  enum (`skills.shared.ts`), and `SOURCE_ORDER` (`panel.client.tsx`). The first two disagreeing
  fails validation at runtime; a kind missing from the third sorts to the top of the panel, since
  `indexOf` returns `-1`.
- **Claude plugin scoping keys on `projectPath`, not on `scope`.** Real manifests carry
  `scope: "local"` entries that are per-project. An entry with a `projectPath` applies only inside
  it; one without applies everywhere.
- **Do not apply `unquote()` to block-scalar continuation lines** in `resolve/frontmatter.ts`.
  Block scalar content is literal YAML, quotes included; stripping them corrupts real skills.
- **`agent.commands()` may be missing at runtime however the types read.** It shipped in Paseo
  `0.7.0-beta.2`, and `@getpaseo/client` declares it required — but the `paseo` object comes from
  the daemon's bundled client, not this folder's `node_modules`, so an older daemon has no such
  method. `supportsCommands()` in `resolve/reported.ts` is a real guard, not a leftover; deleting it
  because the type says the method exists breaks the panel on every daemon below that version.
- **Nothing in Paseo enumerates registered panels.** `addWorkspacePanel` registers the tab type
  only; the panel is reachable because the Command Center item and the composer pill both call
  `openPanel`. Remove both and the panel exists but cannot be opened.
- **The composer pill needs `addClientSide`, which the shim had to grow.** `skills` types
  `@getpaseo/plugin` from its own hand-written `paseo-plugin.d.ts`, so `addClientSide`, `Icon`, and
  the `PluginClientContext` / `PluginComposerPillProps` types are declared there, not imported. Any
  further host API the pill needs has to be added to that file first.
- **A pill's registration is not its render.** `contributeClient` registers a pill for every agent
  on the host, but the component only mounts when that agent's composer is on screen — which is
  what keeps the badge's `skills.list` call bounded to visible agents rather than to every agent
  that exists.
