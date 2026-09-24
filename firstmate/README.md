# FirstMate

A [Paseo](https://paseo.sh) plugin: talk to one agent, ship with a crew.

You talk to a single agent — the **first mate** — and it runs the crew for you. Every task goes to a
**worker**: its own Paseo agent, in its own git worktree, so parallel work on one repository never
collides. The first mate writes each worker's instructions, supervises it to the end, and brings you
finished pull requests, investigation findings, and only the decisions that are really yours. You are
the captain.

A **FirstMate** panel in the sidebar puts the conversation with the first mate beside a board of its
crew — Queued, Working, Blocked, Parked, Done, Failed and Idle — with each worker's last word on what
it is doing and a link to its pull request.

![A 30-second loop of FirstMate at work, zooming in on each step: one message to the first mate asks
for a dark mode toggle and a speed-conversion fix in a small web app; two cards appear in Queued and
move to Working, each worker in its own worktree; one worker is watched live, its commands and edits
scrolling past; each card reaches Done with "Captain's call: land branch …" beside the first mate's
report; the message "land both" sends them to main, and the first mate's Bearings report, with both
cards marked landed, closes it out.](docs/demo.webp)

This is a Paseo-native take on [firstmate](https://github.com/kunchenguid/firstmate) by Kun Chen, by
way of [ABorakati/paseo-firstmate](https://github.com/ABorakati/paseo-firstmate). Where those run the
crew in terminal sessions and supervise it with shell scripts, this one uses nothing but Paseo: the
workers are ordinary Paseo agents you can open, read and type into like any other, in worktrees Paseo
manages, and Paseo itself tells the first mate when a worker finishes, fails or asks for permission.
There is nothing else to install.

## What you need

- Paseo **0.9.0 or newer**, on the daemon and on the device running the app.
- **Paseo's agent tools turned on.** They are how the first mate starts its workers and hears back from
  them, and Paseo ships with them off. The panel says so and turns them on with one press; it is the
  *Agent tools* switch in the FirstMate settings too.
- A capable model for the first mate. It spends its day reading records and deciding who does what,
  and a small model gets the tools wrong. Claude Sonnet or better, or a comparable Codex model, works.
- The `paseo` command on the daemon machine, which a Paseo install puts there. It is used to find the
  plugin's own files, to interrupt a worker from the board, and to name the first mate's project in
  Paseo's sidebar.

## Install

```bash
paseo plugin install npm:@gpambrozio/paseo-firstmate
```

To hack on it, clone the repository and run `paseo plugin install "$PWD"` from this folder after
`npm install` and `npm run typecheck`. Everything the plugin writes into the first mate's home — its
charter, the records it starts with, the home's icon — is in `templates/`, as the files it becomes;
`paseo plugin reload firstmate` puts a change to work.

## Getting started

1. Open **FirstMate** in the sidebar, pick the first mate's model, and press **Launch the first mate**.
   If you already started an agent for the job, adopt it from the list below the button instead.
2. Tell it about a project: "the web app is at ~/code/web — ship through pull requests". It keeps a
   registry, so you only say this once.
3. Ask for work: "fix the flaky login test and add dark mode". Two workers appear on the board, each in
   its own worktree. Minutes later:

   > PR ready for review, captain: https://github.com/you/web/pull/42 (fix the flaky login test - risk: low - CI green)

4. "Merge it." The first mate never merges without your word, unless you have told it a project may.

## Talking to the first mate

- The chat in the panel — Enter sends and Shift+Enter starts a new line, as in Paseo — or open the
  first mate in Paseo for the whole session, every tool call and its output. The chat follows new
  messages while you are at the bottom; scroll up to read, and the round button at the bottom brings
  you back.
- **How full its memory is** — the ring at the end of the chat's buttons shows how much of the first
  mate's context window is used, the way Paseo's own chat does: amber from 70%, red past 90%. Hover
  over it, or tap it on a phone, for the share and the token counts.
  **Compact** has it summarise its conversation to free room, as `/compact` does in Paseo. **Restart**
  starts a new first mate from scratch, with the same model and settings, after asking you. Both wait
  until the first mate is between turns. On a restart its records carry over, the old conversation stays in
  Paseo's history, and workers already running keep going — the new first mate checks on them
  regularly, since Paseo tells only the agent that started a worker when it finishes.
- **Questions it asks you** — which option, whether to go ahead, a plan to approve — appear in the
  chat as a form you answer there, the same as in the first mate's own tab.
- **`/fm <message>`** in any composer sends the message to the first mate, from wherever you are.
- **`/bearings`** — where everything stands, in four sections: what needs your call, what landed,
  what is under way, and what is next. `/bearings file` also writes it to a dated report in the first
  mate's home; `/bearings include PRs` checks the live pull requests too.
- **`/ahoy`** — what happened since you last spoke, then every open decision, one at a time, with a
  recommendation.
- *Bearings* and *Ahoy* are also buttons above the chat, and *FirstMate: bearings* is in ⌘K.

![After the voyage: the first mate's Bearings report in the chat — Captain's Call: nothing needs your
action; Recently Landed: the knots fix and the dark mode toggle, both landed on main; Underway and
Charted Next: nothing — beside the board, where both cards sit in Done marked "landed".](docs/landed.png)

## The board

![The FirstMate panel mid-voyage: the first mate's chat on the left explaining the two workers it sent
off; on the right the board, with "Add a dark mode toggle to the header" in Working, its card open on
Watch, Steer, Interrupt, Relaunch and End, and "Fix knots-to-km/h conversion and add a test" in Done,
reading "Done: ready in branch fm/fix-knots-kmh" and "Captain's call: land branch
fm/fix-knots-kmh".](docs/board.png)

Each card is a worker, a backlog item, or both. Press one for its actions:

- **Watch** — the worker's card beside everything it is doing, live, in place of the board: the brief
  it was given, its reasoning, each command and file it touched (press one for what it ran and what
  came back), its plan, and its replies. Anything it is waiting on — a question, a permission — is
  answered there. The chat with the first mate stays beside it; **Crew** takes you back to the board,
  and **Open in Paseo** shows the worker's whole session.
- **Steer** — a word straight to the worker. It counts as coming from you, and the first mate is told
  what you said and what the worker answered.
- **Interrupt** — stops the worker's current turn.
- **Relaunch** — asks the first mate for a fresh worker in the same worktree, with your note. The work
  on disk carries over; the conversation does not.
- **End** — archives the worker. Its workspace and worktree are left exactly as they are.

![Watching a worker: the chat with the first mate stays on the left; in the board's place, the worker's
card with its actions beside its live transcript — the brief it was given, then Read, Edit and Shell
rows for each step (npm test among them), its notes between them, and a spinner on the step under
way.](docs/watch.png)

Columns fold to a strip and move with the arrows in their headers, and the split between chat and board
drags. The layout is remembered.

Opening the panel counts as looking at the first mate: when it has finished a turn, its workspace in
Paseo's sidebar turns to done, as it would if you had opened the first mate itself. One waiting on
your permission stays flagged until you answer.

A worker's workspace and session also get a **FirstMate** tab showing its card, with a box for telling
the first mate something about it.

## The first mate's home

The **Files** view — next to the crew board, or its own tab on a phone — shows everything in the home
and opens any text file for editing, with a preview for Markdown. Cmd/Ctrl+S saves on a desktop. The
first mate writes these files too, so a save never silently replaces its newer version: you are told
it changed, and choose to load theirs or overwrite it with yours.

The first mate lives in a directory of its own — by default inside Paseo's plugin data, or anywhere you
choose in the settings. It writes there and nowhere else; your projects are read-only to it, and every
change is a worker's job.

In Paseo's sidebar the first mate's project and workspace are called **FirstMate** rather than after
the folder, and the project shows FirstMate's ship, from `icon.svg` in the home — Paseo picks up a
project's icon from its folder. Rename either, replace the file, or upload an icon in the project's
settings, and your choice is kept.

- `AGENTS.md` — its charter: how it takes requests, briefs and supervises workers, and talks to you.
  Written from `data/charter.md` every time the plugin starts or the first mate is launched, so do not
  edit it here.
- `data/charter.md` — **the charter itself, yours to change.** It starts as FirstMate's own charter, and
  while you leave it alone, a new version of the plugin brings its improvements. Once you edit it, your
  version is kept; if FirstMate's charter changes after that, the board tells you, **Compare** opens the
  new one beside yours (`data/charter.new.md`) and **Done** marks yours up to date. Saving it in the panel
  rewrites `AGENTS.md` at once; the first mate reads it at its next session, or when you ask it to re-read
  its charter. The note at the top lists the `{{placeholders}}` filled in for you, notes between `<!--`
  and `-->` are left out, and an empty file goes back to FirstMate's charter.
- `data/captain.md` — **your standing orders.** Anything you write here outranks the charter (except
  its hard rules: it never writes to a project, never merges without your word, never throws away
  unlanded work). Never overwritten.
- `data/opening.md` — **the first thing a new first mate is told**, when you launch it and when you
  restart it. Change the words, the language, or what it should do before anything else; keep asking
  it to read `AGENTS.md` and take the helm, which is what makes it a first mate. Notes between `<!--`
  and `-->` are left out, a restart adds a note of its own after yours about the first mate before, and
  an empty file means FirstMate's own wording. Never overwritten.
- `data/projects.md` — the project registry, and how each one ships:
  - `direct-PR` — the worker opens a pull request ready for review;
  - `reviewed-PR` — the worker also reviews its own diff, runs the full test suite and waits for CI;
  - `local-only` — no remote; the worker leaves a clean branch, and the first mate lands it when you say.
  - `+yolo` after the mode lets the first mate merge green work on that project without asking.
- `data/backlog.md` — every task, in flight, queued and done. The board reads it.
- `data/<task>/brief.md`, `data/<task>/report.md` — each worker's instructions, and an investigation's
  findings.

Because all of it is on disk, a restart is a non-event: the first mate reads its records, checks them
against the live crew, and carries on.

## Settings

**Settings › Plugins › FirstMate** — or the gear in the panel's header, or *FirstMate settings* in ⌘K.

- **First mate** — which agent it is, and *Release* to forget it (the agent keeps running).
- **Home directory** — where the first mate lives. It can be moved only while no first mate is aboard.
- **Crew model and mode** — what every worker runs, unless you tell the first mate otherwise for a
  task. "Let the first mate choose" gives workers its own model.
- **Agent tools** — Paseo's switch, described above.
- **Refresh every** — how often the board polls.

## Limitations

- **Nothing is merged or thrown away without you.** Workers push their own branches and open pull
  requests, but merging needs your word (or `+yolo` on that project), and a worker's worktree is only
  cleaned up after its work has landed.
- **A worker you prompt by hand** in its own tab is not watched by anyone until the first mate next
  reviews the fleet (it keeps a half-hourly check while work is under way). Steer from the board
  instead, and the first mate hears about it.
- **The first mate's model, thinking and mode** are changed from its own tab in Paseo, not from the
  board.
- **Attachments** — images, files — go to the first mate from its own tab, not from the panel's chat.
- **Watch shows a worker's latest activity**, not its whole history; a long-running worker's earlier
  work is in its own session in Paseo.
- It does not reproduce firstmate's second mates, relay to X and Discord, away mode, or the
  `no-mistakes` pipeline (`reviewed-PR` stands in for the last).
- The panel has not yet been checked on a phone.

## License

MIT — see [LICENSE](LICENSE).
