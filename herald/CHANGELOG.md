# Changelog

Notable changes to `herald`. The other plugins in this repository version separately.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every version is published to npm
as `@gpambrozio/paseo-herald` and tagged here, so a version is something to install and a line to
read before you move.

## [Unreleased]

### Fixed

- **Herald notices an agent waiting for you within a moment again.** Since Paseo 0.9, Herald had
  stopped hearing Paseo's live agent updates, so it only found out on its regular check every ten
  seconds: announcements came up to ten seconds late, and the Herald panel was just as slow to add
  or clear an agent. Nothing was missed, only delayed. Herald now listens to Paseo's agent updates
  again, on both the announcements and the panel.

## [0.5.0] — 2026-09-23

### Changed

- **Herald no longer announces agents that another agent started.** A subagent, or a worker a
  FirstMate first mate sent off, reports to the agent that started it, and Paseo tells that agent
  when it finishes, fails or needs your permission. You now hear that agent's announcement, in its
  words, instead of both. These agents still appear in the Herald panel, without a spoken summary.
  To hear them as before, turn on *Agents started by another agent* in Herald's settings.
- **Some of those agents' news is not spoken by anyone.** Paseo tells the starting agent only about
  the task it handed over. So when you send a prompt yourself to an agent whose first task is done,
  or when an agent was started without asking to be told when it finishes, its questions and
  results stay in the Herald panel and are not spoken. Turn on *Agents started by another agent* if
  you would rather hear them.

## [0.4.0] — 2026-09-22

### Added

- **A one-line description of the plugin**, shown next to it in Paseo's plugins list, so it is
  clear what it does without opening it.

### Changed

- **Paseo 0.9 or newer is now required.** On 0.8 this version will not load. Staying on 0.8 means
  staying on the previous release, which keeps working.

## [0.3.0] — 2026-09-21

### Added

- **Summary helpers no longer pile up in your history.** Each summary is written by a short-lived
  helper agent, and every one of them used to stay behind as a session you never asked for. Herald
  now deletes each helper the moment its sentence is written, and clears any that were left over
  shortly after the daemon starts — including everything that accumulated before this release. A
  summary still being written is never touched.
- **A switch to keep them anyway**, under Settings › Plugins › Herald › Summaries. Turn *Delete the
  helper when it is done* off when a summary comes out wrong and you want to read what the helper
  was actually asked. It is on by default.

### Changed

- Herald now needs the `paseo` command on the daemon's `PATH`, which is where it normally is. It is
  used only to delete the helpers; without it they simply pile up as before, and nothing else
  changes.

## [0.2.4] — 2026-09-19

### Fixed

- **Installs from npm — verified this time.** 0.2.3 fixed one missing dependency and left a second
  one behind, so the install still failed the same way. Both are gone, and the published package was
  installed on a real daemon to prove it rather than reasoned about.

## [0.2.3] — 2026-09-19

### Fixed

- **Installs from npm.** The npm install added in 0.2.1 never actually worked for Herald: it
  failed while being built, complaining about a missing dependency, and the plugin did not
  install at all. Installing from the repository was unaffected, and so was every version
  already running.

## [0.2.2] — 2026-09-19

### Fixed

- **Loads on Paseo 0.8 again.** 0.8 rejects any manifest key it does not recognise, and the
  previous release added one, so the plugin refused to load there at all. On 0.9 and newer nothing
  was wrong and nothing changes now.

## [0.2.1] — 2026-09-19

### Added

- **Installs from npm.** On Paseo 0.9 and newer,
  `paseo plugin install npm:@gpambrozio/paseo-herald` fetches the plugin from the npm
  registry — no clone, no repository path to remember. Installing from this repository keeps
  working, and nothing about what the plugin does has changed.

## [0.2.0] — 2026-09-17

### Added

- **The summary prompt is yours to edit.** Settings › Plugins › Herald now opens the whole prompt the
  helper is given, so you can ask for shorter sentences, another language, or more detail about the
  things you care about. Herald fills in the agent, the event and what was said wherever you put
  them, and one press restores the original prompt.
- **A settings button in the panel header**, beside refresh, so the voice, the model and the prompt
  are one press away from the list rather than a trip through Settings.

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
