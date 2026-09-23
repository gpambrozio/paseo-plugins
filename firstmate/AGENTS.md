# AGENTS.md

A Paseo plugin that adds a **FirstMate** sidebar surface: a conversation with one "first mate" agent
beside a board of the "crew" of agents it runs, each in its own git worktree. A Paseo-native port of
[kunchenguid/firstmate](https://github.com/kunchenguid/firstmate) — the agent distro — by way of
[ABorakati/paseo-firstmate](https://github.com/ABorakati/paseo-firstmate), which was a dashboard over
that distro's bash scripts and does not install on Paseo 0.9.

The repo root `AGENTS.md` covers what every plugin here shares: the per-folder npm layout, the
typecheck/reload loop, the client/server bundle split, and the constraints nothing catches at
compile time. This file covers only what is specific to `firstmate`.

## Orientation

| File                          | What it owns                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `index.server.ts`             | Wiring — the RPCs, the display settings document, the steer relay hook.                    |
| `index.client.tsx`            | Wiring — the surface, sidebar item, two panels, settings screen, ⌘K items, `/fm` `/bearings` `/ahoy`. |
| `shared/fleet.ts`             | Every RPC contract, the card/fleet shapes, the daemon config shape, and `CREW_LABELS`.     |
| `shared/settings.ts`          | The host settings document: column order and folds, the chat's width, the poll interval.   |
| `server/charter.ts`           | **The first mate's charter** — the `AGENTS.md` written into its home. The behaviour lives here. |
| `server/home.ts`              | The home directory: writes the charter and records, reads the backlog and project registry. |
| `server/backlog.ts`           | `data/backlog.md` → `BacklogItem[]`. Lenient, because an agent writes the file.            |
| `server/crew-report.ts`       | A crewmate's closing status line (`done: PR …`) → state and text.                          |
| `server/fleet.ts`             | The board: first mate, crew by label, backlog, status lines → cards in columns.            |
| `server/mate.ts`              | Launching, adopting and releasing the first mate; carrying the captain's words to it.      |
| `server/crew.ts`              | Steer, interrupt, end, relaunch one crewmate; the relay that tells the first mate about a steer. |
| `server/send.ts`              | Sending to an agent without interrupting its turn (`activeTurnBehavior: "steer"`).         |
| `server/cli.ts`               | `paseo stop`, for the interrupt the SDK does not have.                                     |
| `server/config.ts`            | `$PASEO_HOME/plugins/firstmate/config.json`, read on every call.                           |
| `server/host-types.ts`        | Paseo types projected out of `@getpaseo/plugin`; see the root AGENTS.md.                    |
| `client/fleet.tsx`            | The surface: header, banners, chat/board split, compact tabs, the shared fleet query.      |
| `client/chat.tsx`             | The first mate's conversation, folded to the words, and the composer.                      |
| `client/transcript-rows.ts`   | Timeline entries → chat rows. Pure.                                                        |
| `client/board.tsx`, `card.tsx`| The columns, and one card with its actions.                                                |
| `client/launch.tsx`           | What shows before there is a first mate: launch one, or adopt a running agent.             |
| `client/panels.tsx`           | The workspace and agent panels: the crewmate's card beside its own tab.                    |
| `client/settings-screen.tsx`  | Settings › Plugins › FirstMate.                                                            |
| `client/markdown.tsx`         | A trimmed copy of `github-board`'s renderer, for the first mate's replies.                 |
| `client/option-picker.tsx`    | A copy of `herald`'s searchable picker, for the model lists.                               |
| `client/web.ts`, `resize-handle.tsx` | The chat/board split's drag; the document-level tracking is a copy of `github-board`'s. |

## The plugin never dispatches a crewmate

The first mate does, with **Paseo's own MCP tools** — `create_workspace` for the worktree,
`create_agent` for the crewmate, `send_agent_prompt` to steer, `archive_agent` to clean up. The plugin
gives it a home and a charter, starts it, carries the captain's words to it, and draws the result.
That was ABorakati's rule too ("the plugin deliberately does NOT dispatch crewmates itself"), and it
keeps authority in one place: the first mate owns intake, the brief and the backlog.

What that costs:

- **Paseo's agent tools must be on** — `daemon.mcp.injectIntoAgents`, **off by default** in Paseo. The
  board reads it through `paseo.config.get()` and offers a button that patches it on. A session gets
  its tool set when it starts or resumes, so a first mate launched before the switch needs a reload.
- **The charter is a contract with a model, not with code.** A weaker model can misuse the tools — a
  Haiku first mate on the test daemon tried to run `mcp__paseo__list_agents` as a shell command — which
  is why the charter names the tools and says outright that they are never shell commands.

## Supervision is Paseo's, not ours

FirstMate's "zero-token supervision" was a bash watcher sleeping on status files. Paseo already has it:
when an agent creates or prompts another through the MCP tools with `notifyOnFinish` (on by default
for agent-scoped calls), the daemon sends the creator a `<paseo-system>` note when the child finishes,
errors, is closed or asks for a permission — with the child's last message, and with
`activeTurnBehavior: "steer"`, so it never interrupts the creator's turn. The charter tells the first
mate to keep it on and to read the crewmate's **status line**, the last line of that message.

Two gaps, and what fills them:

- **A turn the captain started from the board** was prompted by nobody Paseo knows to notify.
  `registerSteerRelay` remembers each steer (`CaptainSteers`, in memory) and, on that crewmate's next
  `agent.turn_ended`, sends the first mate a `<firstmate-board>` note with what was said and answered.
- **Nothing wakes a first mate whose crew went quiet.** The charter has it keep one `create_heartbeat`
  while work is under way.

The notification watches once per prompt. A crewmate prompted by hand in its own tab is not watched
by anyone; the heartbeat is what catches it.

## Sending without interrupting

`PaseoAgentHandle.send` **interrupts a running turn by default.** For the first mate that is wrong — it
may be halfway through a dispatch — so `server/send.ts` sets `activeTurnBehavior: "steer"`, which the
SDK's options type does not declare but the handle passes through to the daemon (read in the 0.9.0 and
0.9.1 client). Everything the plugin sends goes through it. If a later SDK drops the field, the message
still arrives, as an interruption.

## The crew is found by label

The charter tells the first mate to create every crewmate with the labels in `CREW_LABELS`
(`firstmate.role=crew`, `firstmate.task`, `firstmate.kind`, `firstmate.project`), and the board lists
`agents.list({ filter: { labels: { "firstmate.role": "crew" } } })`. The charter imports the same
object, so the two cannot drift. A crewmate created without them is invisible to the board, which is
the first thing to check when the board is empty and the first mate says otherwise.

A card joins a crewmate to its backlog line by the task label, or by the `(agent: …)` the line records;
whatever is left on either side is a card of its own.

**The first mate itself is found only by `config.mateAgentId`.** It is labelled
`firstmate.role=first-mate` at launch, for `paseo ls --label`, but the label is not consulted: the SDK
cannot take a label off, so falling back to it would bring a released first mate straight back.

## Status lines are read on the daemon, cached by `updatedAt`

`ReportCache` fetches a crewmate's timeline tail only when its `updatedAt` has moved and it is not
mid-turn, so a poll every few seconds costs one agent listing and nothing else while the crew is
quiet. `closingText` joins the assistant messages at the very end — a streamed reply arrives in pieces
that split anywhere, even mid-word — and `parseCrewReport` looks for the status line only in the last
few lines, so "the build is done: …" earlier in a message is not a report.

Columns: a pending permission, an error or a running turn win (blocked, failed, working); once the
turn has ended the status line decides; an ended turn with no status line is **Idle**.

## The home

`server/home.ts` writes `AGENTS.md` (the charter, **rewritten on every launch and on every settings
save** — it names the crew's model) and creates `data/captain.md`, `projects.md`, `backlog.md` and
`learnings.md` only when missing, so a relaunch never loses a record. `data/captain.md` is the
captain's to edit and outranks the charter below its hard rules; that is where customisation that
should survive an upgrade goes.

There is **no `CLAUDE.md`**. Claude Code and Codex both read `AGENTS.md`, and a `CLAUDE.md` importing
it risks the charter twice in every turn. `LAUNCH_PROMPT` asks the agent to read the file if it is not
already in its instructions, for a harness that reads neither.

The backlog format is the contract between an agent and `server/backlog.ts`. Changing one means
changing both, and the parser stays lenient: unknown groups are ignored, a line it cannot read is
skipped, and `(since …)` is accepted without the colon because that is how the charter spells it.

## Interrupting needs the CLI

The handle has no cancel. `server/cli.ts` runs `paseo stop <id> --home $PASEO_HOME`, preferring
`PASEO_CLI` — the daemon hands its plugins the path of the CLI it shipped with (seen on 0.9.1) — and
falling back to `PATH` and the usual install directories.

## What was left out

From FirstMate the distro: the session backends (tmux, Herdr, cmux, Zellij, Orca), treehouse, the
watcher and its wake queue, secondmates, Relay, `/afk`, calm mode and self-update — each is either
plumbing Paseo replaces or a feature for another day. `no-mistakes` is an external tool; its place is
taken by a `reviewed-PR` mode the crewmate carries out itself.

From ABorakati's plugin: changing the first mate's model, thinking or mode from the board (0.9's SDK
cannot; ABorakati's plugin sent raw daemon frames over the plugin's IPC channel, which is not an
interface — Paseo's own agent view does it), file attachments in the composer (open the first mate in
Paseo for those), and dragging columns (arrows instead).

## Checking it

`npm test` covers the parsers, the column rules, the card join, the charter's placeholders, the home's
write-once records, the relay text, the transcript rows and the column order. What it cannot cover,
check against a **throwaway daemon** (see the root AGENTS.md — never the real one, whose agents are
the user's):

1. `paseo plugin install "$PWD" --home /tmp/paseo-check`, then `paseo plugin ls --home /tmp/paseo-check`:
   `running`. The daemon sets `PASEO_HOME` for its plugins, so the plugin's files land under the
   throwaway home even when the shell's `PASEO_HOME` names the real one.
2. A throwaway `*.tmp.test.ts` can drive every RPC the way the app does:
   `new DaemonClient({ url: "ws://127.0.0.1:6799/ws", clientType: "cli", … })` from
   `@getpaseo/client/internal/daemon-client`, then `client.invokePluginRpc("firstmate", "<wire name>",
   input)`. Delete it afterwards.
3. The loop worth watching once per charter change: launch a first mate with a capable model, register
   a scratch `local-only` repository in `data/projects.md`, ask for a one-line change, and watch a
   crewmate appear on the board in its own worktree, report `done: ready in branch fm/<id>`, and the
   first mate relay it.
4. Then look at the surface, wide and compact, in two themes — there is no harness for plugin UI.
