# AGENTS.md

A Paseo plugin that lists the agent skills available to an agent session, shows where each one
comes from, renders its `SKILL.md`, and invokes it.

The repo root `AGENTS.md` covers what every plugin here shares: the per-folder npm layout, the
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
  zod enum (`shared/skills.ts`), and `SOURCE_ORDER` (`client/browser.tsx`). The first two disagreeing
  fails validation at runtime; a kind missing from the third sorts to the top of the panel, since
  `indexOf` returns `-1`.
- **Claude plugin scoping keys on `projectPath`, not on `scope`.** Real manifests carry
  `scope: "local"` entries that are per-project. An entry with a `projectPath` applies only inside
  it; one without applies everywhere.
- **Do not apply `unquote()` to block-scalar continuation lines** in `server/resolve/frontmatter.ts`.
  Block scalar content is literal YAML, quotes included; stripping them corrupts real skills.
- **`agent.commands()` is detected structurally, not trusted from the types.** The `paseo` object
  comes from the daemon's bundled client, not this folder's `node_modules`, so what the types
  declare and what the object has are two different questions. `requirements.paseo: ">=0.9.0"` now
  guarantees a daemon well past the `0.7.0-beta.2` that added the method, so `supportsCommands()` in
  `server/resolve/reported.ts` is belt and braces rather than load-bearing — but it costs one
  `typeof` and it documents that the boundary is a runtime one. Keep it.
- **Nothing in Paseo enumerates registered panels.** `addWorkspacePanel` registers the tab type
  only; the panel is reachable because the Command Center item and the pill's popover (its **Open
  tab** button) both call `openPanel`. Remove both and the panel exists but cannot be opened.
- **The panel and the pill's popover are one browser.** `client/browser.tsx` owns the list, the
  search, both detail screens and the invoke; `SkillsPanel` and the popover only frame it and say
  what happens after a send — the panel moves to the agent's tab, the popover calls `close()`. The
  popover is a host surface that already scrolls and pads (`maxHeight` 440, 280–420 wide), so
  `frame="popover"` draws a plain `View`; a `ScrollView` inside it would fight the host's for the
  gesture. Content props carry `close()` but no `openPanel`, so `contributePills` hands the popover
  the call its **Open tab** button makes. Updating the pill's `label` leaves an open popover open;
  changing `behavior`, hiding or disabling it closes it.
- **The pill's registration loop *is* the client entry.** Before 0.8 it was a callback handed to
  `addClientSide`; now `index.client.tsx` runs in the app directly and calls `contributePills`,
  returning its cleanup as the entry's. The `paseo-plugin.d.ts` shim that used to type all of this
  by hand is gone — `@getpaseo/plugin` is a real dependency, so a new host API needs no declaration
  written first.
- **A composer pill is a description, not a component.** `addComposerPill` takes
  `{ id, workspaceId, agentId, button }`, where `button` is a `title`, an `icon`, an optional
  `label` and a `behavior` — and it returns `{ update, remove }`, not a cleanup function. The
  0.8.0-beta.1 SDK typed the older `{ title, Component, onPress }` shape instead, which the released
  0.8.0 app rejects, so the pill silently never registered. **Track the daemon's exact version**;
  a beta of the SDK is not the release.
- **The count reaches the label through the icon.** A declarative button has no render to hang a
  query on, so `client/pill.tsx` makes `button.icon` a component, runs `useSkillsQuery` there, and
  calls `update({ label })` from an effect. That is what keeps the badge's `skills.list` call
  bounded to visible agents: `contributePills` registers a pill for every agent on the host, but
  the host mounts one only when that agent's composer is on screen. Fetching the count at
  registration instead would scan for every agent that exists.
- **`button.id` must match `/^[a-z][a-z0-9-]*$/`**, which is stricter than the RPC name pattern —
  no dots. Registering the same id twice for one agent throws `Duplicate plugin button`, which is
  the other reason `addPill` returns early rather than re-registering.
- **On Paseo 0.9, `agents.subscribe()` requests nothing.** It only adds a local listener to
  observations this API instance opened with `agents.list({ subscribe: {} })`; a bare
  `subscribe()` plus a one-shot `list()` seed misses every agent created afterwards. The pill
  therefore opens its own observation through `client/agents.ts` and rebuilds from its snapshots,
  which arrive on first connect and after every reconnect. A 0.8 client must not send `subscribe`
  at all — the daemon keeps one agents subscription slot per legacy connection, last query wins,
  so the plugin would evict the app's own subscription. `canObserveAgents()` picks the path before
  any request by feature-detecting `observeEvents`, which shipped with observations in
  `0.9.0-beta.1`.
