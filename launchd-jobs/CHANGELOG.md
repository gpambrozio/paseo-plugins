# Changelog

Notable changes to `launchd-jobs`. The other plugins in this repository version separately.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every version is published to npm
as `@gpambrozio/paseo-launchd-jobs` and tagged here, so a version is something to install and a line
to read before you move.

## [Unreleased]

### Changed

- **Removing the plugin no longer breaks your jobs or deletes their history.** The logs, the run
  history and the script every job runs through used to sit inside the folder Paseo installs the
  plugin into, which Paseo deletes when you remove the plugin — and with the script gone, every job
  failed. They now live in `~/.paseo/plugin-data/launchd-jobs/`, and the plugin moves them and points
  your existing jobs at the new place the first time it starts. A job that happens to be running at
  that moment is left to finish and keeps working; it is switched over on a later start, and the one
  run under way during the move may be missing from its history.

## [0.5.0] — 2026-09-22

### Added

- **A one-line description of the plugin**, shown next to it in Paseo's plugins list, so it is
  clear what it does without opening it.

### Changed

- **Paseo 0.9 or newer is now required.** On 0.8 this version will not load. Staying on 0.8 means
  staying on the previous release, which keeps working.

## [0.4.2] — 2026-09-19

### Fixed

- **Loads on Paseo 0.8 again.** 0.8 rejects any manifest key it does not recognise, and the
  previous release added one, so the plugin refused to load there at all. On 0.9 and newer nothing
  was wrong and nothing changes now.

## [0.4.1] — 2026-09-19

### Added

- **Installs from npm.** On Paseo 0.9 and newer,
  `paseo plugin install npm:@gpambrozio/paseo-launchd-jobs` fetches the plugin from the npm
  registry — no clone, no repository path to remember. Installing from this repository keeps
  working, and nothing about what the plugin does has changed.

## [0.4.0] — 2026-09-18

### Added

- **The sidebar tells you when a job is failing.** "Scheduled jobs" becomes "Scheduled jobs (2
  failing)" with a crossed-out calendar icon, so a job that broke overnight is visible without
  opening anything. A job counts as failing when its most recent run ended with a non-zero exit
  code.

  Opening the job clears it from the count; there is nothing to dismiss. The alert returns if the
  job fails again, and a job whose next run succeeds drops out on its own. The count is checked
  about once a minute, so the sidebar can be a minute behind a failure that has just happened.

  If you use Paseo with more than one host, the count belongs to whichever host the app lists
  first, and a host still on an older version of this plugin will keep the row showing the plain
  "Scheduled jobs" — update it everywhere.

## [0.3.0] — 2026-09-08

### Added

- **A Follow button on a job's log**, which shows output as the job writes it instead of only when
  you press Refresh. Useful for watching a job you have just started, or one that takes a while.
  Press it again to stop. Following ends on its own when you leave the job or close the surface, so
  nothing keeps running in the background.

  Following borrows one of your open workspaces to run in, and appears in that workspace's terminal
  list as `launchd: <job name>` while it lasts. It needs at least one workspace open; with none, the
  button reports that there is nothing to run in and the Refresh button still works as before.

## [0.2.0] — 2026-09-08

### Changed

- **Now requires Paseo 0.8.0 or newer**, on the computer running the daemon *and* on whatever you
  are viewing the surface on. Paseo 0.8 changed how plugins are built, and this is the version that
  follows it. On an older Paseo the plugin reports itself as incompatible rather than half working.
- **Confirmations appear as brief messages rather than a banner in the list.** Creating, saving,
  deleting or starting a job no longer pushes the list down to tell you it worked. Errors that need
  your attention — launchd not answering, a log that would not read — still stay on screen.

## [0.1.0] — 2026-09-04

### Added

- **A Scheduled jobs sidebar surface.** Create a job with a name, a command, an optional working
  directory, and a schedule, and it becomes a LaunchAgent on the daemon's Mac. launchd runs it from
  then on, whether or not Paseo is open, and runs a missed one when the Mac wakes from sleep.
- **Two ways to say when.** A five-field cron expression, shown in words as you type it — "At 09:00
  on Mon–Fri" — or a fixed interval in seconds, minutes, or hours.
- **What each job did.** The list shows whether a job is running, disabled, or failed, and when it
  last ran. Opening one shows its last twenty runs with how long each took and how it ended, and
  the tail of its log.
- **Run now, Enable, Disable, Edit, Delete**, each doing the launchd part for you. A disabled job
  stays disabled across reboots until enabled again.
- **Commands find your tools.** Each job runs with the same PATH as your terminal, captured when
  the job is saved, so anything from Homebrew or a version manager works the way it does at a
  prompt.
