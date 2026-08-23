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

**Claude's built-in and bundled skills are invisible.** Filesystem discovery only sees skills that
live in a scannable directory. Skills bundled inside Claude Code itself — roughly eighteen on a
normal install — never appear. This is the real cost of the no-upstream-changes constraint, and it
is what the `listCommands` future seam would fix.

**The Codex mirror follows a fallback path.** `listCodexSkills` is what Paseo uses only when
Codex's own `skills/list` RPC fails; normally the composer lists what Codex reports, including an
`enabled` flag we cannot see. A disabled Codex skill will appear in our panel.

## Constraints that shaped this

**No upstream changes.** `PaseoAgentHandle` (`packages/client/src/index.ts:248`) does not expose
`listCommands`, so the live session's own command list is unreachable from plugin code. Adding it
would be a change to the Paseo repo, which needs a maintainer. Everything here lives in the plugin.

**The filesystem is required regardless.** The live list carries only name, description, and
argument hint — no path, no source, no body. Two of the three goals need the files themselves, so
filesystem discovery is the primary source, not a fallback.

**Plugin code is trusted and unsandboxed.** The server half reads `~/.claude`, `~/.codex`, and the
workspace; the client half runs inside the Paseo app. The target daemon needs `pluginsEnabled: true`.

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
  resolve/skill-directory.server.ts    scans one skills directory
  resolve/repo-root.server.ts          walks up for .git
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
  kind: z.enum(["project", "personal", "plugin", "codex-home", "codex-repo"]),
  label: z.string(),   // "Project", "Personal", "superpowers", "Codex home"
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

Mirror Paseo's own `listCodexSkills` (`packages/server/src/server/agent/providers/codex-app-server-agent.ts:696`)
so the panel agrees with the composer. Candidate directories, in precedence order:

1. `<cwd>/.codex/skills`
2. `<parent of cwd>/.codex/skills` and `<repo root>/.codex/skills`, when `cwd` is in a repo
3. `<CODEX_HOME or ~/.codex>/skills`

Each direct child directory (or symlink) is a skill; read its `SKILL.md`. First `name` wins.
Entries whose frontmatter lacks `name` or `description` are skipped, matching Paseo — otherwise
the panel would list skills the agent cannot see.

The plugin has no `WorkspaceGitService`. Resolve the repo root by walking up for `.git`.

### Claude

In precedence order:

1. `<cwd>/.claude/skills/<name>/SKILL.md` — source `project`
2. `~/.claude/skills/<name>/SKILL.md` — source `personal`
3. Plugin skills — read `~/.claude/plugins/installed_plugins.json` (`version: 2`). For each
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

`~/.agents/skills`. Paseo's orchestration sync writes the same skills into `~/.claude/skills` and
`~/.codex/skills` (`packages/server/src/server/orchestration-skills/internal/paths.ts`), where they
already surface as `personal`. Reading `.agents` too would double every Paseo skill.

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

- precedence order, per provider
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
- **Open on host.** An RPC spawning `code -g <path>` on the daemon machine would make the mobile
  path usable. Rejected for v1 to keep the plugin free of process spawning.
- **More providers.** Each is one `resolve/<provider>.server.ts` module plus a registry entry.
