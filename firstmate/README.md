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
- The `paseo` command on the daemon machine, which a Paseo install puts there. It is used only to
  interrupt a worker from the board.

## Install

```bash
paseo plugin install npm:@gpambrozio/paseo-firstmate
```

To hack on it, clone the repository and run `paseo plugin install "$PWD"` from this folder after
`npm install` and `npm run typecheck`.

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
  first mate in Paseo for the whole session, every tool call and its output.
- **Questions it asks you** — which option, whether to go ahead, a plan to approve — appear in the
  chat as a form you answer there, the same as in the first mate's own tab.
- **`/fm <message>`** in any composer sends the message to the first mate, from wherever you are.
- **`/bearings`** — where everything stands, in four sections: what needs your call, what landed,
  what is under way, and what is next. `/bearings file` also writes it to a dated report in the first
  mate's home; `/bearings include PRs` checks the live pull requests too.
- **`/ahoy`** — what happened since you last spoke, then every open decision, one at a time, with a
  recommendation.
- *Bearings* and *Ahoy* are also buttons above the chat, and *FirstMate: bearings* is in ⌘K.

## The board

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

- `AGENTS.md` — its charter: how it takes requests, briefs and supervises workers, and talks to you.
  Rewritten every time it is launched, so it follows the plugin as it changes.
- `data/captain.md` — **your standing orders.** Anything you write here outranks the charter (except
  its hard rules: it never writes to a project, never merges without your word, never throws away
  unlanded work). Never overwritten.
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
