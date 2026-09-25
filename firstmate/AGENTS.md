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
| `templates/`                  | **Every file the plugin writes into the home**, as Markdown laid out as it lands there, and the parts that go inside them. The first mate's behaviour is `templates/data/charter.md`. |
| `server/templates.ts`         | Finds `templates/` — through `paseo plugin ls`, since the compiled plugin cannot say where it lives — and reads it. |
| `server/charter.ts`           | Renders `AGENTS.md`: the charter's placeholders filled, under its heading note.            |
| `server/charter-file.ts`      | `data/charter.md`, the captain's copy it is rendered from: follows the plugin until edited. |
| `server/home.ts`              | The home directory: writes the charter and records, reads the backlog and project registry. |
| `server/backlog.ts`           | `data/backlog.md` → `BacklogItem[]`. Lenient, because an agent writes the file.            |
| `server/suggestions.ts`       | `data/suggestions.md` → `Suggestion[]`, the board's next-step buttons. Lenient, likewise.   |
| `server/crew-report.ts`       | A crewmate's closing status line (`done: PR …`) → state and text.                          |
| `server/fleet.ts`             | The board: first mate, crew by label, backlog, status lines → cards in columns.            |
| `server/mate.ts`              | Launching, adopting and releasing the first mate; carrying the captain's words to it.      |
| `server/crew.ts`              | Steer, interrupt, end, relaunch one crewmate; the relay that tells the first mate about a steer. |
| `server/crew-seen.ts`         | Clears a crewmate's "finished" flag once a later first-mate turn has completed.            |
| `server/send.ts`              | Sending to an agent without interrupting its turn where the provider allows (`"steer"`).   |
| `shared/attachments.ts`       | What the captain can attach: the message's shape, image-or-file by Paseo's rules, the size cap. |
| `server/uploads.ts`           | An attached file written to `$PASEO_HOME/uploads/`, described as Paseo's `uploaded_file`.     |
| `server/cli.ts`               | `paseo stop` and `paseo project rename`, for what the SDK does not have.                   |
| `server/home-name.ts`         | Names the home's project and workspace "FirstMate" instead of the folder's "home".         |
| `server/daemon-session.ts`    | One raw session request over the plugin's channel: clearing an agent's attention.          |
| `server/config.ts`            | `$PASEO_HOME/plugin-data/firstmate/config.json`, read on every call; the default home.     |
| `server/data-dir.ts`          | `$PASEO_HOME/plugin-data/firstmate/`, and moving the plugin's files out of `plugins/`.     |
| `server/serialize.ts`         | Runs the config update and each home file's save one at a time, per file.                  |
| `server/host-types.ts`        | Paseo types projected out of `@getpaseo/plugin`; see the root AGENTS.md.                    |
| `client/fleet.tsx`            | The surface: header, banners, chat/board split, compact tabs, the shared fleet query.      |
| `client/chat.tsx`             | The first mate's conversation, folded to the words, and the composer.                      |
| `client/draft.ts`, `attachments.ts` | The unsent message and what is attached to it, kept on `globalThis` across reloads.  |
| `shared/files.ts`, `server/files.ts` | The home as files: list, read, write — confined to the home, saved against the version opened. |
| `client/files.tsx`            | The Files view: the home's folders, a text editor, a Markdown preview.                     |
| `client/open-file.ts`         | The file open in the Files view, and what a save changes about it. Pure.                   |
| `client/permission-card.tsx`  | What an agent is waiting on — a question, a permission, a plan — answered in the chat or in Watch. |
| `client/questions.ts`         | The question form's rules, ported from Paseo's own card. Pure.                             |
| `client/keyboard.ts`          | How far the on-screen keyboard covers a view, measured in window coordinates.              |
| `client/keys.ts`              | Enter sends, Shift+Enter is a new line — web and wide layouts only, as in Paseo. Pure.     |
| `client/transcript-rows.ts`   | Timeline entries → chat rows. Pure.                                                        |
| `client/board.tsx`, `card.tsx`| The columns, and one card with its actions.                                                |
| `client/suggestions.tsx`      | The first mate's suggestions as buttons: a card on the wide board, a tab on a phone.       |
| `client/mate-send.ts`         | Sending to the first mate — Send, Bearings, Ahoy, a suggestion — one message at a time.    |
| `client/crewmate.tsx`         | Watch: one crewmate's card beside its live transcript, in the board's place.               |
| `client/activity-rows.ts`     | Timeline entries → Watch rows, machinery kept: reasoning, tool detail, the latest plan. Pure. |
| `client/mate-controls.tsx`    | The context meter, Compact and Restart (with its confirmation), at the end of the chat's buttons. |
| `client/context-meter.tsx`    | How full the first mate's context is: Paseo's ring, built from views; the numbers in a tooltip. |
| `client/follow-end.ts`        | A streaming transcript that follows its end, brings a new request into view, jumps back.   |
| `client/launch.tsx`           | What shows before there is a first mate: launch one, or adopt a running agent.             |
| `client/panels.tsx`           | The workspace and agent panels: the crewmate's card beside its own tab.                    |
| `client/settings-screen.tsx`  | Settings › Plugins › FirstMate.                                                            |
| `client/markdown.tsx`         | A trimmed copy of `github-board`'s renderer, for the first mate's replies.                 |
| `client/option-picker.tsx`    | A copy of `herald`'s searchable picker, for the model lists.                               |
| `client/web.ts`, `resize-handle.tsx` | The chat/board split's drag (a copy of `github-board`'s); the chat's file picker, paste and drop. |

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
turn has ended the status line decides; an ended turn with no status line is **Idle**. So is a
`done:` or `resolved:` one: **Done** is for work the backlog records as Done, and a crewmate that has
reported done is still alive and In flight until the first mate lands it and moves the item. Its card
keeps the status line and the item's hold, so "Done: PR …" still reads on it from the Idle column.

The board draws only columns with a card in them, folded or not (`board.tsx`); the wide layout puts
the shown ones in `boardRows` — one row up to three, two past that, the extra in the second — after
the suggestions card when there is one (`boardItems`), which counts as a column there but never folds
or moves. The saved
`columnOrder` still holds all seven. A header's arrows reorder the *shown* columns (`moveColumn` with
`shown`): the moved column hops past any hidden neighbour to land beside the next shown one, and the
hidden ones keep their place relative to each other, so a press always moves something on screen and
no column's slot is lost while it is empty.

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

## The templates

**No text the plugin writes into the home, or says to the first mate, lives in code.** `templates/`
holds, in three places:

- **The home's files**, laid out as they land there — `AGENTS.md`, `icon.svg`, `data/captain.md` and the
  other records, `data/charter.md` with its note, `data/charter.new.md`.
- **`parts/`** — the sentences that fill `{{crewProviderRule}}` and `{{crewModeRule}}` in the charter, one
  for a setting left open and one for a setting chosen.
- **`messages/`** — everything the plugin sends the first mate: the note a restart adds after the opening,
  the Relaunch request, the note relaying a Steer (with the words for an answer that was too long or
  never came), and Bearings and Ahoy, each with a second form for words typed after `/bearings` or
  `/ahoy`. A template cannot branch, so a message that reads differently when something is missing is
  two files. Bearings and Ahoy are worded on the daemon — the app cannot read the plugin's files — so
  the buttons, ⌘K and the slash commands send `firstmate.mate.command` with the command's name and what
  followed it, and `commandText` picks the template.

`TEMPLATES` in `server/templates.ts` names every one, and `templates.test.ts` fails if the folder and that
list disagree, or if `package.json` stops shipping the folder (`files` names it; a top-level directory it
does not name is silently left out of the npm package).

HTML comments in a template are notes for whoever edits it. Where a template becomes a message or a part
of another file, `withoutNotes` leaves them out, so each part and message starts with a note saying where
it goes and what its placeholders are;
where a template is copied into the home as a file, its notes go with it and speak to the captain.
Placeholders are `{{name}}` throughout, filled by `fill` in a single pass, which leaves any name it was
not given alone and never reads a filled-in value for placeholders — a crewmate's answer relayed through
a Steer can say `{{title}}` and arrives as written.

**Finding the folder is the one hard part.** Paseo compiles the server half into one CommonJS script and
evaluates it from memory: `import.meta` is an empty object in it (esbuild's CommonJS output), the process
runs in the daemon's directory, and nothing in the plugin API names the plugin's. The daemon knows, and
`paseo plugin ls --json` says — the folder of a directory install, and for an npm install the package
itself, inside the daemon's `node_modules` — so `templatesDirectory` asks it, once per process, through the
same CLI lookup as `paseo stop`. In the tests, where the code runs from its own files, `import.meta.url` is
real and the folder beside it is used. A failed lookup is not kept; the next call tries again.

Templates are read once per process, so a changed template reaches a home in use on the next reload, and
only as far as the home takes it: the charter is re-rendered, an untouched `data/charter.md` follows, and a
record the home already has is never rewritten.

Checked on a throwaway 0.9.1 daemon from the packed tarball, unpacked and installed as a directory: a home
got every file, `AGENTS.md` with no placeholder left; and on the real daemon a reload rendered the same
`AGENTS.md`, byte for byte, as the charter held in code before the move. An npm install of 0.1.0 lists its
`path` as the package folder in the daemon's `node_modules`, where `templates/` ships from 0.1.1.

## The home

`server/home.ts` writes `AGENTS.md` (the charter, **rendered from `data/charter.md` on every launch,
every settings save, every plugin start and every save of that file in the panel** — it names the crew's
model, and a charter change should reach a home in use without a relaunch; a running first mate still
has to be asked to re-read it) and creates `data/captain.md`, `projects.md`, `backlog.md`,
`suggestions.md`, `learnings.md` and `opening.md` only when missing, so a relaunch never loses a record. `data/captain.md` is the
captain's to edit and outranks the charter below its hard rules; that is where customisation that
should survive an upgrade goes.

**The default home is `$PASEO_HOME/plugin-data/firstmate/home`**, and it used to be
`$PASEO_HOME/plugins/firstmate/home` — Paseo's install root, deleted by `paseo plugin remove` (see the root
AGENTS.md). `migrateLegacyFiles` (`server/config.ts`) moves the config on start, and the old default home
only when nothing knows it by path: not while a first mate is aboard in it, since the agent keeps working
in the directory it was launched in, and not while `projects/` holds clones, which are Paseo projects and
registry entries by absolute path (and the roots of their crewmates' worktrees). Nor when the settings
name that very directory as the home. A home that has to stay is used where it is — `defaultHome()`
prefers it while `plugin-data/` has none — and the reason is logged on every start. A home the config
names elsewhere is never touched. The config and the home move in one call, so a failure leaves both on
the old side together. Once the old home has moved, the Paseo project
still registered at its old path is left for the captain to remove.

There is **no `CLAUDE.md`**. Claude Code and Codex both read `AGENTS.md`, and a `CLAUDE.md` importing
it risks the charter twice in every turn. The opening asks the agent to read the file if it is not
already in its instructions, for a harness that reads neither.

**The opening is the captain's.** A new first mate's first message — what it is told at launch and at
restart, before the captain has said anything — is `data/opening.md`, written once with the plugin's own
wording (`templates/data/opening.md`) and read at every launch by `readOpening`. It is a file
in the home rather than a setting because it sits with the captain's other records, is edited in the Files
view, and survives an upgrade. HTML comments are notes to the captain and are left out, which is where the
file explains itself; a file with nothing else in it — emptied, or deleted and not yet rewritten — gives
the template's wording, so a first mate is never started with nothing to act on. A restart appends its
note (`templates/messages/restart-note.md`) after it: the heartbeat that note asks for is not optional, so it does not depend on
what the captain wrote. The charter's records table marks the file as the captain's, so the first mate
leaves it alone. An existing home gets the file on the next plugin start, like any missing record.

**The charter is the captain's to edit, too.** `AGENTS.md` is rendered, so an edit there is lost at the
next reload; it is rendered from `data/charter.md`, which starts as `templates/data/charter.md` — the
plugin's charter under a note — and is the file to edit. The note lists the placeholders and records a fingerprint of the
plugin charter the copy was taken from, and that fingerprint is how `syncCharter` (`server/charter-file.ts`)
tells the two cases apart when a new plugin version changes the charter:

- **Untouched** — the copy still matches its fingerprint, so the captain never edited it. It is replaced
  with the new charter: a home nobody customised keeps getting the plugin's improvements.
- **Edited** — the captain's text is kept and rendered. If the plugin's charter has changed since the
  version the edit started from, the new one is written beside it as `data/charter.new.md` and the board
  shows a notice with **Compare**, which opens that file in the Files view (`firstmate.charter.compare`
  writes it first, so it is there even for a copy the sync has not seen yet), and **Done**, which moves the
  fingerprint on and removes the file (`firstmate.charter.acknowledge`). Done restores the note if the
  captain deleted it; a copy without one counts as edited from nothing, so every plugin charter is news
  to it.

An emptied or deleted copy goes back to the plugin's charter. HTML comments are notes, left out of both
`AGENTS.md` and the comparison, so the fingerprint is of the words alone and a note of the captain's own
does not count as an edit. The board reads the state on every poll (`readCharterState`, one small file);
only a sync or the two calls write. The charter's records table tells the first mate that both files are
the captain's.

The backlog format is the contract between an agent and `server/backlog.ts`. Changing one means
changing both, and the parser stays lenient: unknown groups are ignored, a line it cannot read is
skipped, and `(since …)` is accepted without the colon because that is how the charter spells it.

**A title never changes** (charter §2). In the demo dry run a first mate waiting for the word to land
two local branches wrote "…, ready in branch fm/…, awaiting captain's approval to land" into both titles,
and the cards grew with them. The charter now says where status lives — the section, the crewmate's
status line, and `(hold: …)` for anything waiting on the captain, which the card already shows as
"Captain's call".

## Suggestions are the first mate's, and a press sends one

`data/suggestions.md` is what the captain might do next — `- <label> :: <prompt>`, one per line — and
the first mate rewrites it whenever that changes (charter §2 and §9). The board reads it with the fleet
on every poll (`parseSuggestions`): notes are left out, a line without a label and a prompt either side
of the first `::` is skipped, and at most `MAX_SUGGESTIONS` are kept. Nothing in code writes a
suggestion; an empty or missing file draws no card and no tab.

A button sends its prompt to the first mate at once, and brings the chat into view to show it go out:
the First mate tab on a phone, the chat unfolded on a wide layout. The draft is not touched. The send is
the chat's own: `useMateSender` (`client/mate-send.ts`) is what Send, Bearings and Ahoy go through too,
so a suggestion is the same `firstmate.mate.ask` with the same failure toast, the transcript echoes it
like a typed message, and a first mate mid-turn gets it the way `server/send.ts` delivers any message.
The sender's gate — one message on its way at a time — is per first mate in module scope, not in the
chat's state, because the surface's buttons and the chat both read it, and a phone switching tabs
unmounts the chat mid-send; the buttons are disabled while it is shut, and a double press that gets in
before the re-render is refused by it. A phone left on the Suggestions tab when the list empties shows,
and then switches to, First mate.

## The home is called FirstMate in the sidebar, with a ship for its icon

Paseo names a project and its workspace after their directory, and the default home is
`…/plugin-data/firstmate/home`, so the sidebar said "home" twice under a generic folder icon. `nameHome`
(`server/home-name.ts`) calls both "FirstMate" — the workspace through the SDK's `setTitle`, the project
through `paseo project rename`, since the SDK has no call for it. It runs on every launch and restart,
and — for a first mate launched before this existed — once per plugin process from the board's first
`firstmate.fleet.load`, only when the first mate works in its home (an adopted agent's workspace
elsewhere is not the plugin's to name).
A title or project name the captain set is kept, and the project is renamed only when its root is the
home itself: a home chosen inside another project keeps that project's name. A failure is logged and
never fails the launch or the board.

**The icon is a file, not a call.** Paseo looks for an icon in every project's own folder — `favicon.svg`,
`favicon.png`, `icon.svg`, `icon.png` and more, in `public/`, `assets/` and the like first and then the
root, square and 32 KB at most, an SVG taken as square (`project-icon.ts` in Paseo) — and shows it unless
an icon was uploaded in the project's settings. So `prepareHome` writes `icon.svg` into the home when it is
missing: the plugin's own sidebar ship, white on blue, 640 bytes (`templates/icon.svg`). The captain can
replace it, in the Files view or on disk, or upload one in Paseo, which wins. An earlier build set the icon
with the daemon's internal `project.icon.set.request` instead; a project it reached keeps that upload until
it is reset to automatic in the project's settings.

Checked on a throwaway 0.9.1 daemon: a launch made both "FirstMate", Paseo served the home's `icon.svg` as
the project's icon with no custom icon set, and with the project reset to its directory name, a plugin
reload and one board load named it again.

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
at Paseo's thresholds — a warning from 70%, danger past 90%. Paseo draws its ring in SVG, and
`react-native-svg` is not a module a plugin may import, so `ProgressRing` builds the same ring from views:
each half of the circle is an `overflow: hidden` clip holding a ring whose border is coloured on two
adjacent sides only — a rounded border splits its sides at the diagonals, so that is exactly half a ring —
rotated so the coloured half slides into view clockwise from the top. At 0% the fill is not drawn at all,
since its edge showed as a hairline on the seam. Rendered through react-native-web in Chromium at 0–100%
and at 14 points to check the angles; iOS and Android draw per-side border colours on a rounded view the
same way, but have not been looked at. No usage yet — before the first turn ends — draws nothing, as
Paseo's does.

The ring is all the row shows, as in Paseo; the numbers — the share, the tokens — are in a tooltip above
it. It opens on hover (`Pressable`'s `onHoverIn`/`onHoverOut`, the web renderer's) and toggles on a tap
where there is no pointer, a phone; a tap under a hovering pointer is ignored, or clicking the ring would
hide the tooltip being pointed at. The box has a fixed width because an absolutely positioned view is
measured against its parent, the 28-point ring, and would wrap to it. Checked in Chromium through
react-native-web, hover, click and leave.

- **Compact** (`firstmate.mate.compact`) sends `/compact`, the command Paseo's own composer sends; Claude
  Code (a root-only command there, and the first mate is a root agent), Codex and OpenCode each compact on
  it. It is a plain send and refused while a turn runs — the button is disabled then, and the daemon
  refuses too: a slash command must be a turn of its own, where a send would interrupt the running turn
  and a steer would bury the command inside it. The compaction's
  two timeline entries — started, finished — fold into one line (`pushCompaction`).
- **Restart** (`firstmate.mate.restart`) archives the first mate and launches a new one in the home with
  the live agent's model, mode and thinking — not the config's, since they can be changed in its tab and
  an adopted first mate has none there — and the opening followed by the restart note, which tells it it is
  taking over. Archived
  *first*, under the same lock as a launch, so two first mates never hold the helm at once; a launch that
  then fails leaves none, and says so. Archiving retires its heartbeat, because Paseo completes a schedule
  whose agent is archived; the conversation stays readable in Paseo's history. Refused mid-turn, like
  Compact, button and daemon both: a turn cut off halfway through a dispatch can leave a crewmate the
  records never heard of.

What a restart costs: **crewmates the old first mate started no longer wake anyone.** Paseo's finish
notification goes to the agent that created or prompted the crewmate and is dropped when that agent is
archived (`setupFinishNotification` in Paseo returns early for an archived caller), and archiving a first
mate also takes the parent label off its cross-workspace children — which is why Herald 0.5 announces
them from then on. The restart note and charter §7 tell the new first mate to keep a heartbeat while any
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

## A crewmate the first mate has read about leaves "Ready to review"

Paseo's sidebar puts a workspace in "Ready to review" while one of its agents has `requiresAttention`
set, which the daemon does on every running → idle transition (`attentionReason: "finished"`), and
leaves it there until someone looks at the agent. Nobody looks at a crewmate in Paseo — the first mate
reads about it in the `<paseo-system>` finish note — so without help every crewmate the first mate
ever ran piled up there.

**The note is not in any timeline a plugin can read.** The daemon drops every user message that is a
whole `<paseo-system>` envelope (`isSystemInjectedEnvelope` in Paseo's agent manager) before recording
it, so neither `turn_ended`'s `timeline` nor `paseo logs` ever shows one, even though the provider's
own session holds every note. The first version parsed the notes out of the hook's timeline and so
never cleared anything. Checked on the live 0.9.1 daemon: the first mate's Claude session held 23 notes,
its Paseo timeline none.

So `server/crew-seen.ts` goes by time. It hooks **the first mate's** `agent.turn_started` and
`agent.turn_ended`: when a first-mate turn *completes*, every crewmate the first mate created
(`firstmate.role=crew` and Paseo's own `paseo.parent-agent-id` set to the first mate — the note goes to
the creator) whose `attentionTimestamp` is no later than that turn's start is cleared, the same way
`markMateSeen` clears the first mate. The daemon sets the flag before it sends the note, and the note
either starts a turn or is steered into a running one, so a finish from before a turn started has
reached the first mate by the time that turn completes. A finish during a turn waits for the next one.
The first-mate hooks rather than the crewmate's own `turn_ended`, because that fires from the
crewmate's stream and can run before the daemon sets the flag. A cancelled or failed turn leaves the
work for the next completed one, and a turn whose start the plugin did not see — one running across a
reload — is skipped. Each clear logs `cleared N crewmates` to `paseo plugin logs firstmate`.

Only a crewmate of this first mate whose flag is still `"finished"`, with no pending permission, not
running and not in error, is cleared. A permission or an error still reaches the captain, and Paseo
ranks both above the flag regardless. The first mate itself does nothing, so the charter is unchanged.

**This relies on Paseo's internal message format, like `markMateSeen`**: `clear_agent_attention` over
`server/daemon-session.ts`, because neither `PaseoApi`, the MCP tools nor the CLI can clear attention
in 0.9. A daemon that changes the message answers with a timeout, which is logged, and crewmates go
back to waiting in "Ready to review". The follow-up is an upstream API — an `agents.clearAttention`
(or `workspaces.clearAttention`) on `PaseoApi` — and moving both callers onto it.

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

## Attachments go the way Paseo's composer sends them

Paseo 0.9 gives a plugin no composer to embed: composer pills and attachment sources contribute *to*
Paseo's own composer, and `@getpaseo/plugin/client/*` exports no input, picker or chip. So the chat
has its own, and sends what Paseo's composer sends (read in the 0.9.0 app and daemon):

- **An image** goes in the send's `images`, base64 with its type — raster types only, by Paseo's list;
  an SVG is a file.
- **Any other file** is written to `$PASEO_HOME/uploads/upload_<uuid>/<safe name>` and goes in
  `attachments` as `{ type: "uploaded_file", id, fileName, mimeType, size, path }`; the provider tells
  the agent the path. Paseo's app uploads over a binary channel a plugin cannot reach, so the bytes
  ride the `firstmate.mate.ask` RPC as base64 and `server/uploads.ts` writes them in Paseo's layout —
  only once the first mate is known to exist. Paseo caps one file at 50 MB and nothing else, since each
  upload is its own stream; here one RPC carries the whole message in one WebSocket frame, and the
  daemon's socket takes `ws`'s default 100 MiB. So the contract holds images and files alike to 50 MB
  each, 20 per message and 64 MB together (about 85 MiB as base64), and the client checks the same
  before it reads a byte.

Picking, pasting and dropping are all `client/web.ts`, and **all of it is web-only**. Paseo's native
app picks with Expo's image and document pickers and pastes through a third-party text input; none
of those is a host module, so on iOS and Android the attach button is not drawn and the chat takes
words only. A phone *browser* gets the button, and its picker offers the photo library and camera.
Paste takes images only, as Paseo's does, so pasting text or a copied file still pastes text.

The pending attachments live beside the draft on `globalThis` (`client/attachments.ts`), bytes and
all, so a lost connection keeps them; a failed send puts them back unless something new was attached.

## What was left out

From FirstMate the distro: the session backends (tmux, Herdr, cmux, Zellij, Orca), treehouse, the
watcher and its wake queue, secondmates, Relay, `/afk`, calm mode and self-update — each is either
plumbing Paseo replaces or a feature for another day. `no-mistakes` is an external tool; its place is
taken by a `reviewed-PR` mode the crewmate carries out itself.

From ABorakati's plugin: changing the first mate's model, thinking or mode from the board (0.9's SDK
cannot; ABorakati's plugin sent raw daemon frames over the plugin's IPC channel, which is not an
interface — Paseo's own agent view does it), and dragging columns (arrows instead). Attachments came
later, web-only — see *Attachments go the way Paseo's composer sends them*.

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
