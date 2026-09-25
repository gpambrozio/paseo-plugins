# Changelog

Notable changes to `firstmate`. The other plugins in this repository version separately.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every version is published to npm
as `@gpambrozio/paseo-firstmate` and tagged here, so a version is something to install and a line to
read before you move.

## [Unreleased]

### Added

- **The first mate hears about your pull requests within minutes.** When a pull request on its backlog
  is merged or closed on GitHub, gets a review or a comment from someone else, or its checks go red or
  green, the first mate is now told within about five minutes, instead of at its next half-hourly check
  or when you mention it. That covers pull requests to other people's projects too, so a maintainer's
  review reaches the worker without you passing it on. It needs the `gh` command, logged in.

  This is the first of FirstMate's **watches**: small scripts in a `watches/` folder in the first mate's
  home that run on a schedule while Paseo is running, and tell the first mate whatever they print —
  saying nothing costs nothing. You can add your own. A new **Watches** card, after the board's columns
  (at the bottom of the Crew tab on a phone), lists each one with when it last ran and what it last said,
  and switches any of them off or on. Press a watch's name to open its script in the Files view. The
  card appears only when there are watches.

- **Suggested next steps, one press away.** When the first mate reports something you will probably
  act on — a pull request ready to land, a review to run, a decision to make — it now also offers it as
  a button. On a wide screen the buttons sit in a Suggestions card before the board's columns; on a
  phone they have a tab of their own, right after First mate. Pressing one sends that request to the
  first mate straight away, as if you had typed it and pressed Send, and shows you the chat; whatever
  you were typing is left in the message box. The card and the tab appear only when there is something
  to suggest. The first mate keeps the list in `data/suggestions.md` in its home, which you can edit too.

- **Images and files can go with a message to the first mate.** The chat has an attach button beside
  the message box, and you can also paste a screenshot or drop files onto the chat. What you attach
  shows above the box, where you can remove it before sending, and it stays there if Paseo loses its
  connection while you are still writing. The first mate sees images as images, and gets other files
  the same way it would from Paseo's own message box. This works in the Mac app and in a browser,
  phone browsers included; in the iPhone and Android apps the button does not appear yet, because
  Paseo does not let plugins open the photo library or the file picker there.

### Changed

- **Removing the plugin no longer deletes the first mate's files.** Its settings, and its home when you
  have not chosen one, used to sit inside the folder Paseo installs the plugin into, which Paseo deletes
  when you remove the plugin. They now live in `~/.paseo/plugin-data/firstmate/`, and the plugin moves
  them there the first time it starts. A home you picked yourself stays where it is. The old home also
  stays put, and is still used, while a first mate is aboard in it — it moves on the first start after
  you release it — or while it holds projects the first mate cloned for you, because Paseo knows those
  by their location; the plugin's log says which. Once the home has moved, the project Paseo still lists
  for its old location can be removed.

- **The board hides columns with nobody in them.** Only the columns that have workers show, and on a
  wide screen they fill the space: up to three sit side by side, and more than three take two rows, with
  the extra one in the second row. On a phone the list simply skips the empty ones. When there is no crew
  at all, the board says so. The arrows that move a column skip over hidden ones, and a hidden column
  comes back in the place you gave it.
- **A worker that has finished waits in Idle, not Done.** When a worker reports it is done, its card now
  moves to the Idle column until the first mate lands the work and records it as done; only then does it
  reach Done. The card still shows what the worker said and anything waiting on your call. Before, a
  finished worker's card sat in Done beside work that had really landed, even while it was still waiting
  on a review or on you.
- **The first mate's instructions close a few gaps that let work stall or land badly.**
  - A worker no longer stops on "still working": it keeps going until it is done or really waiting on
    something, and one that stops anyway is nudged to carry on.
  - Before merging a pull request — even under a standing order such as merging green dependency
    updates — the first mate checks it again: it will not merge while a required check is still running,
    missing or failing, or when the pull request has changed since it showed it to you — then it shows
    you the new version instead — and it confirms the merge went through. It notes the pull request's
    address on the work, and which version it showed you, so it can tell.
  - Its regular check-in now looks at every pull request it is tracking. One you merge on GitHub is
    cleaned up and the work waiting on it starts; one you close without merging still holds work that
    never landed, so it asks you what to do with it rather than throwing it away. It also notices a worker
    that has stopped making progress in the middle of a task.
  - Each worker starts from the latest version of the project rather than a local copy that may be days
    behind.
  - It picks how hard each worker thinks for its task: less for clear, well-understood work, more for
    investigation or design, and never the maximum unless you ask for it.

  A home whose charter you have not edited picks this up on its own; if you have edited yours, the board
  offers the new one to compare.

### Fixed

- **Changing a FirstMate setting no longer lets go of the first mate.** Saving one setting — the crew's
  model, say — quietly reset the others, including which agent is the first mate and where its home is,
  so the board could lose track of a first mate that was still running. A save now changes only the
  setting you changed.
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
