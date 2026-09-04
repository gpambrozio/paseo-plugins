# launchd-jobs

A Paseo plugin that schedules shell commands on your Mac through launchd. It adds a **Scheduled
jobs** sidebar surface where you create a job — a name, a command, a working directory, and either
a cron expression or a fixed interval — and the plugin writes it as a LaunchAgent. From then on
launchd runs it, whether or not Paseo is open. The surface shows what launchd knows about each job,
the last twenty runs with their exit codes, and the tail of its log.

It is a front for launchd, not a scheduler of its own. Nothing here has to stay running: the plugin
holds no timers and keeps no job database. The plists in `~/Library/LaunchAgents` are the source of
truth, and the surface reads them back on every refresh.

## Install

```bash
paseo plugin add gpambrozio/paseo-plugins --path launchd-jobs
```

Or from a clone:

```bash
cd paseo-plugins/launchd-jobs
npm install
npm run typecheck
paseo plugin install "$PWD"
```

The **daemon** has to be running on macOS, because that is where the agents live and where the
commands run. A daemon on Linux loads the plugin and the surface says so instead of showing a list.
The Paseo app can be anywhere.

## What a job is

Each job is one file, `~/Library/LaunchAgents/com.paseo-plugins.launchd-jobs.<name>.plist`. The
plugin only ever lists, writes, and removes files whose label starts with that prefix, so your other
LaunchAgents are never touched. A plist you write by hand under the prefix shows up too.

The command runs through `/bin/zsh -lc`, so it can be anything you would type at a prompt, and
with the PATH your interactive shell reports — launchd's own PATH is `/usr/bin:/bin:/usr/sbin:/sbin`
and nothing from Homebrew or a version manager, which is the usual reason a LaunchAgent works in
the terminal and fails when scheduled. The PATH is captured when the job is saved, so if you change
it, save the job again.

The working directory is optional and may start with `~/`. Without one, launchd starts the command
in your home directory.

### Schedules

**Cron expression**, five fields: minute, hour, day of month, month, weekday. Lists (`1,15`),
ranges (`9-17`), steps (`*/15`, `9-17/2`), and three-letter names (`mon`, `jan`) all work. The form
shows the schedule in words as you type — "At 09:00 on Mon–Fri" — and how many launchd entries it
becomes, because launchd has no expression language: every combination of the values you list is
its own entry. `0,30 9-17 * * 1-5` is ninety of them. The cap is a thousand.

One difference from cron: when both a day of month and a weekday are given, cron fires when
*either* matches, launchd only when *both* do. The preview says "(both must match)" so it is not a
surprise.

**Fixed interval**: every N seconds, minutes, or hours, counted from when the job was loaded.

### When it fires, and when it does not

- **Paseo closed**: the job runs. launchd does not know Paseo exists.
- **Mac asleep at the scheduled time**: launchd runs the job once when the Mac wakes. Several
  missed times collapse into one run.
- **Mac off, or you logged out**: the run is missed. LaunchAgents belong to your login session.
- **Job disabled**: launchd remembers that across reboots until you enable it again.

## Runs and logs

Every run appends a line to the log with a timestamp, the command's combined output, and the exit
code, and one record to a history file — when it started, how long it took, and how it ended. The
surface shows the last twenty runs and the last 64 KB of the log. Both files live under
`$PASEO_HOME/plugins/launchd-jobs/` (`~/.paseo/plugins/launchd-jobs/` by default). A log is rotated
once it passes 1 MB, and the history keeps its last two hundred runs.

**Run now** asks launchd to start the job immediately. It does not change the schedule.

## Removing

Deleting a job in the surface unloads it, deletes the plist, and deletes its log and history.
Removing the *plugin* does not: the agents stay installed and keep running, because they are
launchd's, not Paseo's. Delete the jobs first, or delete the plists by hand and run
`launchctl bootout gui/$UID/<label>` for each.

## Limitations

- macOS only. A daemon on Linux would need a systemd user timer backend, which does not exist here.
- The daemon has to run inside your login session — which it does when the desktop app starts it.
  A daemon started over SSH with no GUI session may not be able to load agents into it.
- Six-field cron expressions with seconds are refused; launchd has no seconds field. Use a fixed
  interval instead.
- What launchd reports — whether a job is running, its process id, its spawn count — comes from
  `launchctl print`, whose output is prose. If a macOS release rewords it, those facts go blank
  until the parser is updated; the run history and the log do not depend on it.
