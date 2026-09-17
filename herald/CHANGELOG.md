# Changelog

Notable changes to `herald`. The other plugins in this repository version separately.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Nothing here is published to a
registry: `paseo plugin add` follows a branch unless you pin `--ref <tag>`, so a version is a tag to
pin and a line to read before you move.

## [0.2.0] — 2026-09-17

### Added

- **The summary prompt is yours to edit.** Settings › Plugins › Herald now opens the whole prompt the
  helper is given, so you can ask for shorter sentences, another language, or more detail about the
  things you care about. Herald fills in the agent, the event and what was said wherever you put
  them, and one press restores the original prompt.

### Changed

- The model that writes the summaries is now picked from the list of your providers' models only. The
  box for typing one by hand is gone; a model you had typed in is kept and still shown.

## [0.1.0] — 2026-09-16

### Added

- **A Herald panel in the sidebar** listing every agent that is waiting on you — a question asked, a
  plan or a permission to approve, a turn finished, a turn failed — with a one-sentence summary of
  what it needs. Tap a row to open that session, or the speaker beside its title to hear it again.
- **Spoken announcements.** When one of those events happens, a small helper agent writes the
  sentence and the Paseo app on your desk speaks it — in the daemon Mac's own voice, which it renders
  and the app plays, or in the browser's voice when the daemon is not a Mac. The desktop app speaks
  on its own; a browser tab speaks once you have pressed *Test voice*; phones can vibrate instead,
  since a plugin cannot yet speak there.
- **A card in the agent's conversation.** The same sentence appears in the agent's own transcript,
  right after the turn or question it is about, with a play icon to hear it again.
- **Settings** for where to speak, which voice source and voice, how fast, which kinds of event to
  announce, and which model writes the summaries — Claude Haiku 4.5 unless you pick another.
