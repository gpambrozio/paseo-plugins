# paseo-plugins

Plugins for [Paseo](https://paseo.sh). One folder per plugin, each self-contained.

| Plugin | ID | What it does |
| --- | --- | --- |
| [`skills/`](skills) | `skills` | Lists the agent skills available to a session, shows where each comes from, renders its `SKILL.md`, and invokes it. |
| [`github-board/`](github-board) | `github-board` | A sidebar board of open issues, draft PRs, open PRs, and discussions — yours, plus whatever is open on the repos you own — in four columns. |

## Install

Plugins install individually — there is no repo-wide install. Follow the README
in the folder you want.

```bash
git clone https://github.com/gpambrozio/paseo-plugins.git
cd paseo-plugins/<plugin>
npm install
npm run typecheck
paseo plugin install "$PWD"
```

`paseo plugin install` records the directory, so keep the clone where it is —
the daemon loads each plugin from that path every time it starts. Moving this
repo means reinstalling every plugin in it.

The daemon needs `"pluginsEnabled": true` in its `config.json`, and Paseo
**0.5.0-beta or newer**; earlier versions have no `paseo plugin` command.

## Layout

Each folder is an independent npm project with its own `package.json`,
`node_modules`, and `paseo-plugin.json`. There is no workspace root on purpose:
`paseo plugin install` points the daemon at a single directory, and hoisting
dependencies above that directory has not been verified against the plugin
loader.

Plugin code is trusted and unsandboxed. The server half runs next to the daemon
with its files, processes, and credentials; the client half runs inside the
Paseo app. Read the source before installing anything here.

## License

MIT — see [LICENSE](LICENSE).
