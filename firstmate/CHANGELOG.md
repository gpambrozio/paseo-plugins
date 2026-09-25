# Changelog

Notable changes to `firstmate`. The other plugins in this repository version separately.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every version is published to npm
as `@gpambrozio/paseo-firstmate` and tagged here, so a version is something to install and a line to
read before you move.

## [Unreleased]

### Changed

- **A worker that has finished waits in Idle, not Done.** When a worker reports it is done, its card now
  moves to the Idle column until the first mate lands the work and records it as done; only then does it
  reach Done. The card still shows what the worker said and anything waiting on your call. Before, a
  finished worker's card sat in Done beside work that had really landed, even while it was still waiting
  on a review or on you.

### Fixed

- **A message you were typing to the first mate is still there when you come back.** Leaving Paseo for
  another app, putting the phone down, or letting the Mac sleep could clear the box, so a half-written
  message was gone by the time you returned. It now stays until you send it, for as long as Paseo is
  open.
- **Finished workers no longer pile up in Paseo's "Ready to review".** Every worker the first mate ran
  stayed in that part of Paseo's sidebar after it finished, as if you still had to look at it, even
  though the first mate had already read what it said. Once the first mate has read that a worker
  finished, the worker now moves to the Done section of Paseo's sidebar, as it would if you had opened
  it yourself. A worker that needs your permission or has failed still shows up for you as before, and
  your own agents are never touched.

## [0.1.1] — 2026-09-23

### Added

- **Your own first words to the first mate.** What a new first mate is told when you launch or restart
  it is now a file in its home, `data/opening.md`, beside your standing orders — change the wording,
  the language, or what it should do first. It starts as the message FirstMate has always sent, and
  your version is never overwritten.
- **The first mate's charter is yours to edit.** The instructions it works by now come from a file in its
  home, beside your standing orders. Leave it alone and it keeps up with FirstMate's own; change it and
  your version is kept. When FirstMate's charter changes after you have edited yours, the board tells you
  and opens the new one for you to compare, so you can bring over what you want.

### Changed

- **A clearer sign of work under way.** The Working column now shows a hammer, and steps still running in
  the chat and in Watch show a spinner that actually turns — the old sign was a spinner drawn standing
  still, which looked stuck.

### Fixed

- **Task titles on the board stay as you asked for them.** While finished work waited for your go-ahead,
  the first mate wrote its status into the title ("…, ready in branch …, awaiting approval to land"), and
  the card grew with it. The title now stays put, and what the first mate needs from you shows on the
  card as your call.
- **A card you opened closes again when its work moves on.** A worker finishing or starting again used to
  carry its card into the new column still open, with its buttons showing. Now it arrives closed — unless
  you were in the middle of something in it, like a message half-typed to the worker, which is kept.

## [0.1.0] — 2026-09-22

### Added

- **A first mate that runs a crew of agents for you.** Launch it from the new FirstMate panel in the
  sidebar and tell it what you need; it hands each task to a worker agent in its own git worktree,
  supervises it to the end, and brings you pull requests, findings, and only the decisions that are
  yours. Workers are ordinary Paseo agents you can open and read like any other.
- **A board of the crew** beside the conversation: queued, working, blocked, parked, done, failed and
  idle, with each worker's last word and its pull request. Steer a worker, interrupt it, end it, or
  have the first mate relaunch it, from its card.
- **`/fm`, `/bearings` and `/ahoy`** in any composer: talk to the first mate from anywhere, get a
  four-part catch-up on where everything stands, or a recap of what happened with every open decision.
- **See how full the first mate's memory is, and do something about it.** A meter beside the chat
  shows how much of its context window is used, as Paseo's own chat does. Compact it to free room, or
  restart it from scratch with the same settings; its records carry over, and the old conversation stays
  in Paseo's history.
- **Watch a worker without leaving FirstMate.** A worker's card opens beside its live activity — its
  brief, reasoning, every command and file edit with what came back, its plan and its replies — in
  place of the board, with the chat still beside it. Answer its questions and permissions right there.
- **A FirstMate tab** beside a worker's workspace and session, showing its card.
- **Answer the first mate's questions in the panel.** When it asks you to choose, or needs your
  permission or a plan approved, the question appears in the chat and you answer it there, without
  opening the first mate itself.
- **The first mate's files, in the panel.** Browse its home, read any file — its instructions, your
  standing orders, the backlog, each worker's brief and report — and edit and save it there. If the
  first mate changed a file while you were editing it, you choose which version to keep.
- **The first mate's home is easy to spot in Paseo's sidebar**: it is called FirstMate, with a ship
  for its icon, rather than "home" under a folder. A name or icon you give it yourself is kept.
- **Opening the panel marks the first mate as seen**, so its workspace in the sidebar reads as done
  rather than waiting for you, just as if you had opened the first mate itself.
- **Standing orders you write yourself**, in the first mate's home, which it reads every session and
  follows ahead of its own charter.
