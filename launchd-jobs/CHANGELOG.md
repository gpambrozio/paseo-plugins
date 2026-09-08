# Changelog

Notable changes to `launchd-jobs`. The other plugins in this repository version separately.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Nothing here is published to a
registry: `paseo plugin add` follows a branch unless you pin `--ref <tag>`, so a version is a tag to
pin and a line to read before you move.

## [Unreleased]

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
