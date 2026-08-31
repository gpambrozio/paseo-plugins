# paseo-skills

A Paseo plugin that lists the agent skills available to an agent session, shows where each one
comes from, renders its `SKILL.md`, and invokes it.

Works with every provider. Claude and Codex additionally get their skill files scanned off disk,
which is what gives a skill a source, a path, and a rendered body; every other provider shows what
its running session reports.

## Install

Requires the [Paseo](https://paseo.sh) CLI and a running daemon.

```bash
paseo plugin add gpambrozio/paseo-plugins --path skills
```

This repository holds two plugins, hence `--path`. The daemon clones it under `$PASEO_HOME/plugins`
and runs no package manager — the plugin is source only, and everything it imports at runtime the
host provides. Pin a release with `--ref <tag>`; later, `paseo plugin status` and
`paseo plugin update skills` follow the branch.

To hack on it instead, install from a clone of your own:

```bash
git clone https://github.com/gpambrozio/paseo-plugins.git
cd paseo-plugins/skills
npm install
npm run typecheck && npm test
paseo plugin install "$PWD"
```

`install` records the directory, so keep that clone where it is — the daemon loads the plugin from
that path every time it starts. `npm install` is for the typecheck and the tests; installing needs
none of it.

The daemon needs `"pluginsEnabled": true` in its `config.json`. Run `paseo reload` after changing
it. Plugin code is trusted and unsandboxed: the server half reads the daemon machine's filesystem
and the client half runs inside the Paseo app. Read the source before installing this or any other
plugin.

## Use

Press the **Skills** pill above an agent's composer — its badge counts what the panel will list.
The Command Center reaches the same panel: focus a workspace tab holding an agent, press ⌘K, and
pick **Skills**.

## Demo



https://github.com/user-attachments/assets/cbb0166e-d981-4367-a5b4-5b12d2e7c14c



## Develop

```bash
npm test                     # vitest, resolvers only
npm run typecheck
paseo plugin reload skills   # after any source change
paseo plugin logs skills     # load errors and stderr
```

A failed reload stays failed; Paseo does not restore the previous code.

## Layout

| File                            | Owns                                                     |
| ------------------------------- | -------------------------------------------------------- |
| `index.ts`                      | Contribution wiring only.                                 |
| `skills.shared.ts`              | zod RPC contracts, imported by both runtimes.             |
| `skills.server.ts`              | RPC handlers; resolves the agent, dispatches by provider. |
| `resolve/claude.server.ts`      | Claude project, repository, personal, and plugin skills.   |
| `resolve/codex.server.ts`       | Codex project, repository, personal, and admin skills.     |
| `resolve/repo-root.server.ts`   | Walks up for `.git`, and lists the directories in between. |
| `resolve/skill-directory.server.ts` | Scans one `skills` directory, and a whole search path. |
| `resolve/skill-entry.ts`        | Entry types, skill id construction, first-wins dedupe.     |
| `resolve/frontmatter.ts`        | `SKILL.md` frontmatter parsing.                            |
| `resolve/reported.ts`           | Splits session-reported entries discovery did not find.    |
| `panel.client.tsx`              | The panel: list, search, detail, invoke.                  |
| `pill.client.tsx`               | The composer pill and the client entrypoint that owns it.  |
| `skills-query.client.tsx`       | The `skills.list` query the panel and the pill share.      |

`docs/design.md` records why it is shaped this way. Read it before changing discovery.

## License

MIT — see [LICENSE](LICENSE).
