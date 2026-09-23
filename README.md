# paseo-plugins

Plugins for [Paseo](https://paseo.sh). One folder per plugin, each self-contained.

| Plugin | ID | What it does |
| --- | --- | --- |
| [`skills/`](skills) | `skills` | Lists the agent skills available to a session, shows where each comes from, renders its `SKILL.md`, and invokes it. |
| [`github-board/`](github-board) | `github-board` | A sidebar board of open issues, draft PRs, open PRs, and discussions — yours, plus whatever is open on the repos you own — in four columns. |
| [`launchd-jobs/`](launchd-jobs) | `launchd-jobs` | Schedules shell commands through launchd on the daemon's Mac — a cron expression or an interval, run whether or not Paseo is open, with run history and logs. macOS only. |
| [`herald/`](herald) | `herald` | A sidebar panel of every agent waiting on you — a question, a permission, a finished turn — each with a one-sentence summary a helper agent wrote, and the Paseo app speaks that sentence when it happens. |
| [`model-pricing/`](model-pricing) | `model-pricing` | One sidebar table of what every model costs, across Anthropic, OpenAI, Fireworks AI, Ollama Cloud and OpenRouter, with the context window and capabilities beside each price. |
| [`firstmate/`](firstmate) | `firstmate` | Talk to one first mate agent and it runs a crew of worker agents, each in its own git worktree, with a sidebar board of the crew beside the conversation. A Paseo-native take on [firstmate](https://github.com/kunchenguid/firstmate). |

## Install

Plugins install individually — there is no repo-wide install. On **Paseo 0.9 or
newer**, each one is an npm package:

```bash
paseo plugin install npm:@gpambrozio/paseo-skills
paseo plugin install npm:@gpambrozio/paseo-github-board
paseo plugin install npm:@gpambrozio/paseo-launchd-jobs
paseo plugin install npm:@gpambrozio/paseo-herald
paseo plugin install npm:@gpambrozio/paseo-model-pricing
paseo plugin install npm:@gpambrozio/paseo-firstmate
```

Add `@<version>` to install an exact one. npm is only how the daemon fetches the
files; nothing else about the plugin changes.

On Paseo 0.8, install the last release that supported it from this repository instead:

```bash
paseo plugin add gpambrozio/paseo-plugins --path skills
paseo plugin add gpambrozio/paseo-plugins --path github-board
paseo plugin add gpambrozio/paseo-plugins --path launchd-jobs
paseo plugin add gpambrozio/paseo-plugins --path herald
paseo plugin add gpambrozio/paseo-plugins --path model-pricing
```

The daemon clones this repo under `$PASEO_HOME/plugins` and runs no package
manager; every plugin is source only, and everything they import at runtime the
host provides. Pin a release with `--ref <tag>`, or follow the branch with
`paseo plugin status` and `paseo plugin update --all`.

To hack on one, install from a clone of your own instead:

```bash
git clone https://github.com/gpambrozio/paseo-plugins.git
cd paseo-plugins/<plugin>
npm install
npm run typecheck
paseo plugin install "$PWD"
```

`paseo plugin install` records the directory, so keep that clone where it is —
the daemon loads each plugin from that path every time it starts. Moving this
repo means reinstalling every plugin you installed from it.

The daemon needs `"pluginsEnabled": true` in its `config.json`, and Paseo
**0.9.0 or newer** — every plugin here declares that, and an older daemon
refuses to load them rather than degrading.

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
