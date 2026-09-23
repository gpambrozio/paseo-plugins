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
| `server/send.ts`              | Sending to an agent without interrupting its turn where the provider allows (`"steer"`).   |
| `server/cli.ts`               | `paseo stop`, for the interrupt the SDK does not have.                                     |
| `server/daemon-session.ts`    | One raw session request over the plugin's channel: clearing the first mate's attention.    |
| `server/config.ts`            | `$PASEO_HOME/plugins/firstmate/config.json`, read on every call.                           |
| `server/host-types.ts`        | Paseo types projected out of `@getpaseo/plugin`; see the root AGENTS.md.                    |
| `client/fleet.tsx`            | The surface: header, banners, chat/board split, compact tabs, the shared fleet query.      |
| `client/chat.tsx`             | The first mate's conversation, folded to the words, and the composer.                      |
| `shared/files.ts`, `server/files.ts` | The home as files: list, read, write — confined to the home, saved against the version opened. |
| `client/files.tsx`            | The Files view: the home's folders, a text editor, a Markdown preview.                     |
| `client/permission-card.tsx`  | What an agent is waiting on — a question, a permission, a plan — answered in the chat or in Watch. |
| `client/questions.ts`         | The question form's rules, ported from Paseo's own card. Pure.                             |
| `client/keyboard.ts`          | How far the on-screen keyboard covers a view, measured in window coordinates.              |
| `client/keys.ts`              | Enter sends, Shift+Enter is a new line — web and wide layouts only, as in Paseo. Pure.     |
| `client/transcript-rows.ts`   | Timeline entries → chat rows. Pure.                                                        |
| `client/board.tsx`, `card.tsx`| The columns, and one card with its actions.                                                |
| `client/crewmate.tsx`         | Watch: one crewmate's card beside its live transcript, in the board's place.               |
| `client/activity-rows.ts`     | Timeline entries → Watch rows, machinery kept: reasoning, tool detail, the latest plan. Pure. |
| `client/mate-controls.tsx`    | The context meter, Compact and Restart (with its confirmation), at the end of the chat's buttons. |
| `client/context-meter.tsx`    | How full the first mate's context is: a bar, the share, the tokens — Paseo's thresholds.    |
| `client/follow-end.ts`        | A streaming transcript that follows its end, brings a new request into view, jumps back.   |
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
errors, is closed or asks for a permission — with the child's last message, delivered with the same
`activeTurnBehavior: "steer"` described under *Sending without interrupting*. The charter tells the first
mate to keep it on and to read the crewmate's **status line**, the last line of that message.

Two gaps, and what fills them:

- **A turn the captain started from the board** was prompted by nobody Paseo knows to notify.
  `registerSteerRelay` remembers each steer (`CaptainSteers`, in memory, an hour at most) and sends
  the first mate a `<firstmate-board>` note with what was said and answered — on the first
  `agent.turn_ended` whose timeline **contains** the steer as a user message, and never on a cancelled
  one. The first turn to end is not always the answer: the one that was running may end first, and a
  provider that cannot steer cancels it. A steer whose send failed is taken back, so it is never
  relayed as said.
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

"Steer" is only as gentle as the provider. The message joins the running turn where the provider
can take one mid-turn; where it cannot, the daemon's `steerOrReplaceActiveTurn` **cancels** the turn
and starts a new one from the message. That is the same path Paseo's own finish notifications take,
so it is no worse than what the first mate already lives with, but it is not a guarantee — and it is
why the steer relay above cannot assume the first `turn_ended` after a steer is the answer to it.

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

## The first mate is told it lives in Paseo

Charter §0 says what the first mate cannot work out for itself: that it runs inside Paseo, and that
Paseo — not its memory or its records — is where the captain's projects, workspaces, agents,
providers and schedules are. It names both ways in: the MCP tools for acting on the crew, and the
`paseo` CLI for looking things up, with the exact commands. Without it a first mate asked "which
projects do you know?" answered from `data/projects.md` alone. So the registry now holds only each
project's delivery mode; which projects exist is `paseo project ls`.

The crew is listed with `paseo ls -g --label firstmate.role=crew`, not the MCP `list_agents`:
that tool defaults to the last 48 hours and 50 agents, and a crewmate older than that would silently
drop out of the first mate's view. Agents get `PASEO_CLI`, `PASEO_HOME` and their own
`PASEO_AGENT_ID` in their environment (seen on 0.9.1), which is what the charter points at.

## The home

`server/home.ts` writes `AGENTS.md` (the charter, **rewritten on every launch, every settings save and
every plugin start** — it names the crew's model, and a charter change should reach a home in use
without a relaunch; a running first mate still has to be asked to re-read it) and creates `data/captain.md`, `projects.md`, `backlog.md` and
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

## Questions and permissions are answered in the chat

When the first mate asks the captain something (Claude's `AskUserQuestion`) or needs a permission, it
stops on a pending permission request. The chat draws each one at the end of the conversation and
answers it with `respondToPermission` from the client — the same call and payload the agent's own tab
sends, so nothing server-side is involved:

- **A question** (`kind: "question"`) is a form: one tab per question, options as radio buttons or
  checkboxes, a free-text box where the daemon added `allowOther`, and Dismiss / Next / Submit.
  `client/questions.ts` is a port of Paseo's `question-form-card-core.ts`, and the payload must stay
  identical to it: `allow` with `{ ...request.input, answers }` keyed by each question's **header**
  (the daemon re-keys them by question text for Claude), or `deny` with "Dismissed by user".
- **Anything else** is a card with the request's own `actions` as buttons, or Allow and Deny.

The request reaches the chat through the timeline: every timeline page carries the agent's snapshot,
pending requests included, and the request is itself a stream event, so it shows up with the next
re-read. The board's poll of the first mate (`updatedAt` and the pending count) is a second trigger for
a re-read, for a request the stream did not announce. The "waiting for your answer" banner now shows
only when the chat is out of sight — folded, or behind the Crew tab — with a button that brings it back.

Checked on a throwaway 0.9.1 daemon: a Claude agent's AskUserQuestion arrived in the timeline page's
snapshot with `allowOther` set, and answering it with `buildAnswers` got "I picked Blue." back.

## Watching a crewmate

A card's **Watch** shows that crewmate in the board's place — the right-hand pane, or the Crew tab on a
phone — so the chat with the first mate stays beside it: its card, with the board's actions, and its
live transcript. Pressing *Crew* again, or the view's own back button, returns to the board; the
crewmate being watched is kept in module scope like the open tab. *Open in Paseo* is in the view's
bar, not on the card — the card's first action is the caller's (`CardOpener`), so the board says
Watch and the workspace panels, already beside the agent, say Open.

The transcript is `useAgentTimeline` on the crewmate, the tail of 200 projected entries, turned into
rows by `activityRows`. Where the chat folds the first mate's machinery away, this keeps it: reasoning,
every tool call with an expandable detail (a shell command's output from its end, an edit's diff, a
file's content from its start, all clipped to 40 lines), and only the **latest** plan, because each
update restates the whole list. Claude's task tools reach the timeline as that plan
(`claude/task-state.ts` in Paseo); Codex, OpenCode and ACP providers send it directly. `hasOlder` on
the page says when the tail is not the whole story, and the view points at Paseo for the rest.

Rows — here and in the chat — are keyed by their entry's `seqStart` (`rowKey`). The entry's end grows
while a tool call runs or a reply streams, and its position in the page shifts by one with every new
entry once the tail is full; a key built from either remounts the row, which closes an open tool
detail just as its output arrives.

A crewmate's pending questions and permissions are answered here exactly as the first mate's are in
the chat — `usePendingRequests` and `PermissionCard`, shared — and the transcript follows its end the
same way (`useFollowEnd`, also shared).

"At the end" (`isAtEnd`) is judged against the **shorter** of the live content height and the one
`onContentSizeChange` last reported. On the web that report waits for a ResizeObserver and a
`setTimeout`, while react-native-web's scroll-end event, 100 ms after a scroll settles, reads the live
height — so an event landing in between saw a reply that had grown but not yet been followed, decided
the captain had scrolled up, and the chat stopped following until they scrolled down by hand. Jumps
are instant for the same reason: mid-animation, every scroll event reads as away from the end. A round
button over the transcript's foot, as in Paseo's own agent view, goes back to the end while the reader
is away from it.

Checked on a throwaway 0.9.1 daemon: a Sonnet agent's projected timeline came through as prompt, shell
calls with their output, and replies, and the compiled client bundle carried the view.

## The home's files, in the panel

A Files view — beside the crew board on a wide layout, a third tab on a phone — lists the home folder by
folder and opens any text file in an editor, with a Markdown preview for `.md`. Three calls in
`shared/files.ts`, handled in `server/files.ts`:

- **Confined to the home, twice over.** A path is normalized and refused if it is absolute or climbs
  above the home; then it is resolved through symlinks and refused if it lands outside the home's real
  path — for a file about to be created, through its nearest existing ancestor. A clone under
  `projects/` can contain links to anywhere, and the panel must not follow them out.
- **Saved against the version opened.** The first mate writes these same files, so a save carries the
  modification time the editor opened the file at and is refused if the file has changed since; the
  editor then offers *Overwrite*, which sends `force`. A file that changes on disk while open and
  unedited is reloaded quietly, off the list's ten-second poll. A save is a temporary file renamed over
  the old one, so the first mate never reads half of it.
- **Text only, up to a megabyte.** A NUL byte in the first 8 KB marks a file binary; either kind is
  listed but not opened.

`AGENTS.md` opens with a note that the plugin rewrites it on every start, pointing at
`data/captain.md` for anything that should last. The open folder, the open file and its unsaved text
are kept in module scope, like the chat's draft, so a remount does not lose an edit in progress.

Errors from any RPC reach the app wrapped as `Request failed: … requestType=… code=…`;
`errorText` (`client/format.ts`) strips that, so the panel shows the handler's own sentence.

## Context, Compact and Restart

The chat's button row ends with how full the first mate's context window is, the way Paseo's composer
shows it: `lastUsage.contextWindowUsedTokens` over `contextWindowMaxTokens`, read from the agent snapshot
every timeline page carries (so it moves with the stream, and the board's poll re-reads it too), coloured
at Paseo's thresholds — a warning from 70%, danger past 90%. Paseo draws an SVG ring; `react-native-svg`
is not a module a plugin may import, so this is a bar. No usage yet — before the first turn ends — draws
nothing, as Paseo's does.

- **Compact** (`firstmate.mate.compact`) sends `/compact`, the command Paseo's own composer sends; Claude
  Code (a root-only command there, and the first mate is a root agent), Codex and OpenCode each compact on
  it. It is a plain send and refused while a turn runs: a slash command must be a turn of its own, where a
  send would interrupt the running turn and a steer would bury the command inside it. The compaction's
  two timeline entries — started, finished — fold into one line (`pushCompaction`).
- **Restart** (`firstmate.mate.restart`) archives the first mate and launches a new one in the home with
  the live agent's model, mode and thinking — not the config's, since they can be changed in its tab and
  an adopted first mate has none there — and `RESTART_PROMPT`, which tells it it is taking over. Archived
  *first*, under the same lock as a launch, so two first mates never hold the helm at once; a launch that
  then fails leaves none, and says so. Archiving stops its turn and retires its heartbeat, because Paseo
  completes a schedule whose agent is archived; the conversation stays readable in Paseo's history.

What a restart costs: **crewmates the old first mate started no longer wake anyone.** Paseo's finish
notification goes to the agent that created or prompted the crewmate and is dropped when that agent is
archived (`setupFinishNotification` in Paseo returns early for an archived caller), and archiving a first
mate also takes the parent label off its cross-workspace children — which is why Herald 0.5 announces
them from then on. `RESTART_PROMPT` and charter §7 tell the new first mate to keep a heartbeat while any
are in flight, which is how it finds out.

Checked on a throwaway 0.9.1 daemon with a Haiku first mate: 33,969 of 200,000 tokens after launch,
4,949 after Compact, and Restart archived it and brought up the same model and mode, with the config
pointing at the new one.

## Opening the panel marks the first mate seen

While the surface is mounted, a first mate flagged "finished" or "error" is cleared the way opening
it in Paseo clears it, so its workspace reads as done in the sidebar (`deriveAgentStateBucket`: an
idle agent without `requiresAttention` is `done`). The effect is keyed by the agent's `updatedAt`, so
a turn that ends while the panel is open is cleared too, and a failed clear is not retried until
something changes. A first mate waiting on a permission keeps its flag — Paseo's own "mark as read"
(`workspace.clear_attention`) skips those too, because the flag is the prompt to answer it.

The SDK has no call for it, so `server/daemon-session.ts` writes a `clear_agent_attention` session
message on the plugin's own IPC channel — the frame envelope the plugin's `DaemonClient` already
uses — and waits for the response carrying its own `requestId`. That is the protocol, not an
interface: a daemon that changes the message answers with a timeout, which is logged and costs
nothing. Only complete, valid session messages go this way; a malformed frame is a protocol
violation, and the daemon closes the socket every other call from the plugin rides on.

## Phones: the home indicator and the keyboard

The host pads a surface's top, under its header, and nothing else: not the home indicator, and not
the keyboard — Paseo moves its own composer with `react-native-keyboard-controller` and
`react-native-safe-area-context`, and neither is a module a plugin may import. So the chat does both
itself, with what `react-native` offers:

- **The home indicator.** The composer is wrapped in `SafeAreaView` (deprecated in React Native
  0.81, still present). It replaces the padding in its own style, which is why the composer's padding
  is on the view inside it. It does nothing on Android.
- **The keyboard.** `useKeyboardOverlap` (`client/keyboard.ts`) measures the chat pane with
  `measureInWindow` — the space the keyboard's frame is reported in — and the pane pads its bottom
  by the overlap. `KeyboardAvoidingView` is not used because it measures against its parent, which
  inside the host's screen needs an offset nobody here knows. Lifted above the keyboard, the composer
  no longer overlaps the home indicator, so its safe-area padding drops to zero instead of stacking.
- **The lists with text boxes in them** — the compact board, the panels, the launch screen,
  settings — use `automaticallyAdjustKeyboardInsets`, iOS-only, which insets a `ScrollView` and
  scrolls the focused box into view.

All of it was written against a screenshot and has to be checked on a device.

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
