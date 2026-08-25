# Agent skills panel — design

A Paseo plugin that lists the agent skills available to a given agent session, shows where
each one comes from, renders its full `SKILL.md`, and invokes it.

Status: approved design, not yet implemented.

## Problem

Paseo's composer already lists skills when you type `/`, but it shows only name, description,
and argument hint. It cannot tell you which directory a skill came from, which copy won a name
collision, or what the skill actually instructs the agent to do. Reading a skill today means
leaving Paseo and finding the file by hand.

## Goals

- Show every skill available to one agent session, grouped by where it came from.
- Show the absolute `SKILL.md` path for each skill.
- Render a skill's full body without leaving the app.
- Invoke a skill in that agent, with optional arguments.
- Reach the panel from the workspace tab bar and from the Command Center.

## Non-goals

- Editing, creating, installing, or deleting skills.
- Providers other than Claude and Codex. Copilot, OpenCode, and Pi report "not supported".
- Displaying shadowed duplicate copies of a name. Collisions resolve first-wins, silently.
- Verifying against the live session what it actually loaded. See "Future seams".
- Any change to the Paseo repository.

## Limitations

**Built-in and bundled skills are invisible.** Filesystem discovery only sees skills that live in a
scannable directory. Skills bundled inside Claude Code itself — roughly eighteen on a normal
install — and Codex's SYSTEM scope, which its own docs describe as "bundled with Codex" with no
local path, never appear. This is the real cost of the no-upstream-changes constraint, and it is
what the `listCommands` future seam would fix.

**Disabled Codex skills appear.** Codex disables a skill without deleting it through
`[[skills.config]]` in `~/.codex/config.toml`, and its `skills/list` RPC reports the resulting
`enabled` flag. Paseo's composer honours it; a directory scan cannot see it. Reading that TOML is
the cheapest way to close this and is not done yet.

**Shadowed copies are hidden, but Codex does not hide them.** Codex's docs are explicit: "If two
skills share the same `name`, Codex doesn't merge them; both can appear in skill selectors." This
panel resolves collisions first-wins and shows one row. Across five scopes that silently drops
real rows — see "Future seams".

## Constraints that shaped this

**No upstream changes.** `PaseoAgentHandle` (`packages/client/src/index.ts:248`) does not expose
`listCommands`, so the live session's own command list is unreachable from plugin code. Adding it
would be a change to the Paseo repo, which needs a maintainer. Everything here lives in the plugin.

**The filesystem is required regardless.** The live list carries only name, description, and
argument hint — no path, no source, no body. Two of the three goals need the files themselves, so
filesystem discovery is the primary source, not a fallback.

**Plugin code is trusted and unsandboxed.** The server half reads `~/.claude`, `~/.agents`,
`~/.codex`, `/etc/codex`, and the workspace; the client half runs inside the Paseo app. The target daemon needs `pluginsEnabled: true`.

**`paseo plugin init` requires an empty directory** (`packages/cli/src/commands/plugin/scaffold.ts:292`).
Scaffold before adding any file, including this document.

## Project layout

The plugin lives outside the Paseo repo and installs as a directory source.

```
paseo-skills/
  paseo-plugin.json                    { "id": "skills" }
  index.ts                             contribution wiring only
  skills.shared.ts                     zod RPC contracts
  skills.server.ts                     RPC handlers, provider dispatch
  resolve/claude.server.ts             Claude discovery
  resolve/codex.server.ts              Codex discovery
  resolve/skill-directory.server.ts    scans one skills directory, and a whole search path
  resolve/repo-root.server.ts          walks up for .git, lists the dirs in between
  resolve/skill-entry.ts               entry types, id, dedupe
  resolve/frontmatter.ts               SKILL.md parsing, pure
  panel.client.tsx                     the panel
```

The `*.client.tsx` / `*.server.ts` / `*.shared.ts` suffixes are load-bearing: the compiler strips
client registrations from the server bundle and server registrations from the client bundle, and
importing across the boundary fails compilation.

```bash
paseo plugin init ~/Development/paseo-skills
cd ~/Development/paseo-skills && npm install && npm run typecheck
paseo plugin install ~/Development/paseo-skills
```

## Contributions

```ts
export default function contribute(plugin: PluginContext) {
  plugin.handle(listSkills, handleListSkills);
  plugin.handle(readSkill, handleReadSkill);
  plugin.addWorkspacePanel({
    id: "skills", title: "Skills", icon: "Sparkles",
    context: "agent", Component: SkillsPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-skills", title: "Skills", icon: "Sparkles",
    keywords: ["skill", "skills"], context: "agent",
    onSelect: ({ openPanel }) => openPanel("skills"),
  });
  return () => {};
}
```

An agent-context panel receives `PluginAgentPanelProps`: `agentId`, `workspaceId`, `theme`,
`layout`, `host`. An agent-context Command Center item appears only when the focused workspace tab
is an agent or an agent-context plugin panel.

## RPC contracts

Neither call accepts a filesystem path from the client.

```ts
const SkillSource = z.object({
  // scopes, not directories: several directories feed each scope
  kind: z.enum(["project", "repo", "personal", "admin", "plugin"]),
  label: z.string(),   // "Project", "Repository", "Personal", "Admin", "superpowers"
  dir: z.string(),
});

const SkillEntry = z.object({
  id: z.string(),            // stable: `${source.kind}:${dir}:${name}`
  name: z.string(),          // invocation name; `plugin:skill` for plugin skills
  description: z.string(),
  source: SkillSource,
  path: z.string(),          // absolute SKILL.md path
  status: z.enum(["discovered"]),
});

export const listSkills = defineRpc({
  name: "skills.list",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    provider: z.string(),
    supported: z.boolean(),
    cwd: z.string().nullable(),
    skills: z.array(SkillEntry),
  }),
});

export const readSkill = defineRpc({
  name: "skills.read",
  input: z.object({ agentId: z.string(), skillId: z.string() }),
  output: z.object({
    name: z.string(), description: z.string(),
    path: z.string(), body: z.string(),
  }),
});
```

`skills.list` takes only an agent id. The handler resolves `cwd` and `provider` itself through
`paseo.agents.ref(agentId)` rather than trusting client-supplied values.

`skills.read` re-runs discovery and looks `skillId` up in the result. The client never names a
path, so an arbitrary-file-read RPC never exists. Bodies load on demand — some `SKILL.md` files
run to thousands of words, and shipping every body to render a list is waste.

`status` is `"discovered"` in v1. It is the seam where a later "loaded in this session" check
plugs in without reshaping the DTO.

## Discovery

### Codex

Follow the search path Codex documents (developers.openai.com/codex/skills), not Paseo's
`listCodexSkills` (`packages/server/src/server/agent/providers/codex-app-server-agent.ts:696`).
Those disagree: Paseo's function scans `.codex/skills`, and Codex scans `.agents/skills`. It is a
fallback Paseo uses only when Codex's own `skills/list` RPC fails, so the composer is normally
right and the fallback is stale. Mirroring it is what made the panel show seven skills to a user
with a hundred and thirteen.

Candidate directories, in precedence order:

1. `<dir>/.agents/skills` then `<dir>/.codex/skills`, for every `<dir>` from `cwd` up to the
   repository root — `cwd` itself is scope `project`, every ancestor is scope `repo`
2. `~/.agents/skills` then `<CODEX_HOME or ~/.codex>/skills` — scope `personal`
3. `/etc/codex/skills` — scope `admin`

`.codex/skills` is not in Codex's documented set. It stays in the list one rank below its
`.agents` sibling because Paseo's own orchestration sync writes there
(`orchestration-skills/internal/paths.ts` targets all three of `.agents`, `.claude`, `.codex`) and
because older Codex builds read it. Dropping it would hide skills from anyone whose install still
uses it; ranking it second means the documented copy wins when a name lives in both.

Each direct child directory (or symlink) is a skill; read its `SKILL.md`. Codex follows symlinked
skill folders too. First `name` wins. Entries whose frontmatter lacks `name` or `description` are
skipped, matching Paseo — otherwise the panel would list skills the agent cannot see.

The plugin has no `WorkspaceGitService`. Resolve the repo root by walking up for `.git`. Outside a
repository the walk has no stopping point, so it yields `cwd` alone rather than climbing to `/`.

### Claude

In precedence order:

1. `<cwd>/.claude/skills/<name>/SKILL.md` — source `project`
2. `<dir>/.claude/skills/<name>/SKILL.md` for every `<dir>` between `cwd` and the repository
   root — source `repo`. Claude loads project skills from every parent of `cwd` up to the repo
   root, not from `cwd` alone, so an agent started in a subdirectory still sees what the
   repository checked in.
3. `~/.claude/skills/<name>/SKILL.md` — source `personal`
4. Plugin skills — read `~/.claude/plugins/installed_plugins.json` (`version: 2`). For each
   installed entry take `installPath`, scan `installPath/skills/*/SKILL.md`, and name the skill
   `<plugin>:<skill>`. Scope by `projectPath`, not by the `scope` string: an entry with a
   `projectPath` applies only when the agent's `cwd` is inside it, and an entry with no
   `projectPath` applies everywhere. Real manifests carry `scope: "local"` entries that are
   per-project — `scope` alone is not a reliable signal.

The manifest is what makes the plugin list trustworthy. The cache holds every version ever
fetched — three `superpowers` versions on the author's machine — and only the installed one is
live. A naive `cache/**/skills` scan lists each skill once per stale version.

Paseo launches Claude with `settingSources: ["user", "project", "local"]` and does not set the
SDK's `skills` filter (`packages/server/src/server/agent/providers/claude/agent.ts:145,3276`), so
every discovered skill is loaded. Filesystem discovery and session availability agree.

### Deliberately not read

`.agents/skills` for a Claude agent. Claude Code documents `.claude/skills` and plugin skills; it
does not scan `.agents`. The cross-agent installers that use `~/.agents/skills` as their store
symlink into `~/.claude/skills`, and the scan follows symlinks, so those skills arrive by the
documented path.

`~/.codex/skills/.system`, where OpenAI is reported to ship a couple of global skills. The
directory holds skills one level deeper than every other candidate, and the only evidence for it
is third-party. Not worth a special case until someone with the directory confirms it.

An earlier version of this document excluded `~/.agents/skills` outright, on the grounds that
Paseo's orchestration sync writes the same skills into `~/.claude/skills` and `~/.codex/skills`
and reading `.agents` too "would double every Paseo skill". Both halves were wrong. `dedupeByName`
collapses same-named entries, so nothing doubles — verified against the real directories, which
hold byte-identical copies of the same seven skills. And the sync only mirrors the skills Paseo
ships; anything else in `~/.agents/skills` is mirrored nowhere and was invisible.

### Unsupported providers

Return `supported: false` with an empty list. The panel says the provider has no skill support,
rather than showing an empty list that reads as "you have no skills".

## The panel

One component, two states, held in local state. No router involvement.

**List.** A search field filtering on name and description. Rows grouped under source headers —
`Project`, `Personal`, one per plugin, `Codex home`. Each row is a name and a one-line description.

**Detail.** Pressing a row calls `skills.read` and shows the absolute path, the full body in a
`ScrollView` as monospace text, an optional arguments field, and an **Invoke** button.

**Invoke** sends the invocation through the agent handle:

```ts
await paseo.agents.ref(agentId).send(args ? `/${name} ${args}` : `/${name}`);
```

Then it returns to the list. Both providers resolve a leading slash in an ordinary prompt into a real
command invocation — Codex's `startTurn` turns it into a `{ type: "skill", path }` block
(`codex-app-server-agent.ts:3891`) — so this is a genuine invocation, not literal text in the
transcript.

Colors come from `theme.colors.foreground` and `theme.colors.foregroundMuted`; padding tightens on
`layout.compact`. Request state uses the host-provided `@tanstack/react-query`, with the agent's
`cwd` in the query key so the list refetches if the agent moves.

### Copy path

Plugin client code may import only `react`, `react-native`, `@tanstack/react-query`, `zod`,
`@getpaseo/plugin`, and `@getpaseo/plugin/server`. No clipboard module is available: React Native
dropped `Clipboard` from core and `@react-native-clipboard/clipboard` is not in the allowed set.

On web and desktop, copy with `navigator.clipboard.writeText` behind a `typeof navigator` check.
On native, render the path as `selectable` `Text` for long-press copy. This is a real degradation
on mobile and is accepted for v1.

## Error handling

- Unreadable directory — treat as absent, list the rest. A missing `.claude/skills` is normal.
- Unparseable `SKILL.md` frontmatter — skip the entry, matching provider behavior.
- Missing or malformed `installed_plugins.json` — return no plugin skills, keep project and
  personal skills.
- Agent not found, or no `cwd` — surface the error in the panel; do not render an empty list.
- `skills.read` for an id no longer in discovery (deleted between calls) — return a clear error
  and refetch the list.

Fail loudly where the user would otherwise be misled, quietly where absence is the normal case.

## Testing

Resolvers are pure functions over an injected root directory, tested with vitest against temp-dir
fixtures in the plugin project:

- precedence order, per provider, across `.agents` and `.codex` within one directory
- the walk covers every directory from `cwd` to the repository root, and stops there
- outside a repository the walk does not climb past `cwd`
- a directory named by two scopes at once (a repo rooted at `$HOME`) is read once
- first-wins on a name collision across directories
- entries missing `name` or `description` are skipped
- absent directories do not fail the scan
- stale plugin-cache versions are excluded by the manifest
- a plugin entry with a `projectPath` is excluded for an unrelated `cwd`, included for a matching
  one, regardless of its `scope` string; an entry with no `projectPath` is included everywhere
- `CODEX_HOME` is honored
- repo-root walk-up finds `.git` and stops at the filesystem root

The panel is verified by hand in the app; there is no test harness for plugin UI.

## Future seams

- **Live cross-check.** If `listCommands` is ever added to `PaseoAgentHandle`, compare discovery
  against the session's real command list and move `status` to `"loaded" | "on-disk"`. This is the
  only part that needs an upstream change, and it is additive.
- **Show shadowed copies.** Every entry already carries the directory it came from, so rendering
  the losers of a name collision greyed out is a panel change, not a discovery change. It matches
  Codex, which does not merge same-named skills.
- **Read `~/.codex/config.toml`.** Its `[[skills.config]]` entries are how Codex disables a skill
  without deleting it — the one piece of state `enabled` carries that a directory scan misses.
- **Open on host.** An RPC spawning `code -g <path>` on the daemon machine would make the mobile
  path usable. Rejected for v1 to keep the plugin free of process spawning.
- **More providers.** Each is one `resolve/<provider>.server.ts` module plus a registry entry.
