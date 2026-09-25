# AGENTS.md

A Paseo plugin that adds a **Scheduled jobs** sidebar surface: shell commands on a cron expression
or a fixed interval, written as LaunchAgents and run by launchd on the daemon machine.

The repo root `AGENTS.md` covers what every plugin here shares: the per-folder npm layout, the
typecheck/reload loop, the client/server bundle split, and the constraints nothing catches at
compile time. This file covers only what is specific to `launchd-jobs`.

## Orientation

| File              | What it owns                                                                     |
| ----------------- | -------------------------------------------------------------------------------- |
| `index.client.tsx` / `index.server.ts`        | Wiring only — binds the nine RPC contracts and registers the surface.           |
| `shared/jobs.ts`  | The zod contracts, and the `Job` shape both halves agree on.                     |
| `server/jobs.ts`  | Every `launchctl` and `plutil` call, the plist writer, the runner, logs, history. |
| `server/data-dir.ts` | `$PASEO_HOME/plugin-data/launchd-jobs/`, and moving the files out of `plugins/`. |
| `client/jobs.tsx` | The surface: the list, the detail pane, and the create/edit form.                |
| `client/log-follow.ts` | Follow mode: the `tail -f` terminal behind the log pane's live view.        |
| `client/failure-alert.ts` | The sidebar item, and the failing count in its title and icon.           |
| `shared/cron.ts`         | Unsuffixed, in both bundles: cron ⇄ `StartCalendarInterval`, and the sentences.  |
| `shared/cron.test.ts`    | With `server/data-dir.test.ts` and `server/jobs.test.ts`, the tests. `npm test`. |
| `README.md`       | What a job is to a user, and what launchd does and does not promise.             |

## launchd is the scheduler and the store

The backend keeps **no timers and no job list**. `contribute` returns an empty cleanup because there
is nothing to release. Everything the surface shows is read back from disk and from `launchctl` on
each `jobs.list`: the plists under the label prefix, `launchctl print` per label,
`launchctl print-disabled` once, and the tail of each job's history file. The one file the plugin
owns is `jobs.json`, mapping slug to display name, because a name like "Nightly backup" does not
survive being made into a label.

The second file it owns is `acknowledged.json`, slug to the `startedAt` of the failing run the user
has already seen, because that is the one fact the history files cannot hold — see *The sidebar's
failing count* below.

That is why there is no drift problem to solve. A plist edited by hand is what the list shows;
`fromCalendarEntries` turns its entries back into an expression when they form one, and
`describeEntries` shows them raw when they do not. Saving from the form rewrites the file in the
plugin's shape either way.

**The label prefix is the ownership boundary.** `listSlugs` globs
`com.paseo-plugins.launchd-jobs.*.plist` and nothing else in `~/Library/LaunchAgents` is ever
read, written, or booted out. Keep it that way; the user's other agents are on that directory.

## The launchctl choreography

Modern `launchctl` (`bootstrap`/`bootout`/`kickstart`/`enable`/`disable`) against the `gui/<uid>`
domain, never the deprecated `load`/`unload`. `process.getuid()` supplies the uid; the daemon runs
as the user, inside the login session, when the desktop app starts it.

- **Update is bootout, rewrite, bootstrap.** launchd does not reread a changed plist, and
  bootstrapping a label that is already loaded fails. `bootoutIfLoaded` swallows only the two
  "not loaded" spellings (`No such process`, `Could not find service`); anything else is thrown.
- **Enable is `enable` *then* bootstrap.** Bootstrapping a disabled label is refused. Disable is
  bootout then `disable`, so the job stops now and stays stopped after a reboot.
- **Delete runs `enable` before removing the plist.** `launchctl disable` is stored per label in
  launchd's override database, not in the plist, so without this a later job with the same slug
  would be born disabled.
- **Create leaves the plist in place if bootstrap fails.** The list then shows it as "Not loaded"
  with the error in a toast, and Enable retries. Removing it would hide the thing the user needs
  to fix.
- **Run now is `kickstart`**, refused when the label is not loaded because launchd would refuse it
  less helpfully.

`readStatus` parses `launchctl print` prose: `state = `, `pid = `, `runs = `, `last exit code = `.
Exit 113 with "Could not find service" is the one failure that means something (not loaded);
everything else is thrown. Those four lines have held across releases; treat anything else in that
output as unstable and do not add fields from it. `readDisabled` parses `"label" => disabled`
lines from `print-disabled`.

## The runner

launchd spawns `/bin/zsh <data>/runner.sh <slug> <command>`, not the command itself. The runner is
what makes the surface's history and log exist: it appends start and exit markers around the
command's output, writes one JSON line per run, and rotates both files. It is kept as a string
constant in `server/jobs.ts`, rewritten on every save when it differs, so a change to it ships
with the plugin and reaches every job the next time one is saved — **not** before. If the runner
format changes incompatibly, say so in the changelog.

**The runner rotates the log, so launchd must not hold it open.** `StandardOutPath` is deliberately
absent from the plist: launchd opens that file at spawn and keeps it across the run, so a file
moved out from under it goes on receiving output. The runner appends to the log itself, which is
why rotation is a simple `mv` before the command starts. `StandardErrorPath` points at the same
log only so a failure in the runner *itself* — a missing data directory, say — lands somewhere.

The command runs through `/bin/zsh -lc` **and** the plist carries a `PATH` captured by
`loginShellPath`, which asks `zsh -lic` (most people export PATH in `.zshrc`, which only an
interactive shell reads) and falls back to `zsh -lc` and then the plugin's own PATH. The plugin's
own is the wrong answer on purpose-last: the daemon under the desktop app has launchd's bare PATH,
which is the problem being solved. The probe has a five-second timeout because an interactive shell
with no TTY can misbehave.

`managed` is whether the plist's `ProgramArguments` is exactly the four-element runner shape. A
hand-written plist under the prefix lists as unmanaged with its spawn line shown shell-quoted, and
the detail pane says so.

## Moving out of `plugins/launchd-jobs`

The files used to live in `$PASEO_HOME/plugins/launchd-jobs/`, which is also Paseo's install root for
an npm or Git install and is deleted whole by `paseo plugin remove`. They now live in
`$PASEO_HOME/plugin-data/launchd-jobs/`. Each plist names the runner, `PASEO_LAUNCHD_JOBS_DIR` and
`StandardErrorPath` by absolute path, and launchd runs the definition it *loaded*, not the file, so
moving the files is two steps.

**`moveLegacyFiles`, synchronously, before any handler is bound.** A loaded job can fire at any
moment, so the new runner and a *forwarder* at the old runner path — a script that execs the new
runner against the new directory — go in before anything moves. `jobs.json`, `acknowledged.json` and
each file of `logs/` and `runs/` then move **one by one**, not as directories: a fire through the
forwarder creates the new `logs/`, and a directory-level move would then call the old one superseded
and strand it. A failed move leaves the plugin on the old directory for that start (the shared
`migrateLegacyData` rule), and the real runner goes back at the old path.

**`relocateLegacyJobs`, asynchronously, after it.** `plistRepairs` compares each of the three paths on
its own, so a rewrite cut short after the first `plutil` is finished on the next start rather than
skipped because the runner already looks new; `ProgramArguments` is replaced whole, because
`plutil -replace` on an array index *inserts*. Every loaded job whose `launchctl print` still names
the old directory anywhere is booted out and back in — **except one that is running**, since bootout
kills it. The forwarder stays until a later start has reloaded it, then goes, with the empty stderr
file launchd created beside it. The one run in flight at the moment of the move loses its history line
(the runner resolved the old `runs/` path before the forwarder existed).

The file moves and `plistRepairs` are covered by `server/jobs.test.ts`, which calls no `launchctl`. The
whole sequence was checked once on a scratch `PASEO_HOME` with two throwaway jobs made by the previous
`server/jobs.ts`, one of them mid-run.

## cron ⇄ calendar entries

`toCalendarEntries` is the cartesian product of every restricted field, because a launchd entry
holds one value per field. `MAX_ENTRIES` (1000) is enforced in `parseCron` so the form refuses it
before the server does. `fromCalendarEntries` only accepts entries that are exactly such a product
— same fields present in every entry, count equals the product, every entry accounted for —
which is also what a hand-written plist usually is.

Weekday `7` is folded to `0` on the way in, and `formatField` writes weekday as `0`, so a
round-trip of `* * * * 7` prints `0`. `describeCron` deliberately appends "(both must match)" when
day and weekday are both restricted: cron ORs them, launchd ANDs them, and that is the one place
the two disagree. The README says the same.

## Follow mode borrows a workspace

`readJobLog` answers a byte-tail of the file when asked, which is all the Refresh button needs and
useless while a job is running. Follow mode (`client/log-follow.ts`) runs `tail -f` in a daemon pty
through the 0.8 terminal SDK and repaints the pane from that terminal's scrollback every second.
The capture is a screen read on the daemon, not a file read, so the poll is cheap; the *latency* is
`tail`'s, not the poll's.

**`terminals.create` requires a `workspaceId` and this surface is global.** Terminals are
workspace-scoped in Paseo's model and a sidebar surface belongs to no workspace, so there is no
correct answer here — only a chosen one. It takes the first workspace the daemon lists that is not
archiving, names the terminal `launchd: <label>` so it is obvious in that workspace's terminal list
what put it there, and kills it when following stops. **This is user-visible in a workspace the user
did not associate with this plugin**; if a future Paseo grows workspace-less terminals, this is the
first thing to move. With no workspace at all, follow reports itself unavailable rather than
failing on press.

Two lifetime hazards, both handled with a `generation` counter rather than state:

- **A stop or an unmount landing while `create` is in flight** would otherwise leave a `tail -f`
  running with nothing holding its handle. The follow checks its generation after the await and
  kills the terminal it just made.
- **A cleanup runs after the component stops re-rendering**, so the handle lives in a ref; a state
  read there would be a stale closure.

Switching jobs and leaving the surface both tear down. While following, the log pane stops
re-reading the file on `lastFinished` and hides the Refresh button — the tail is already ahead of
anything a re-read would find, and two writers to one box only ever look broken.

## The sidebar's failing count

The sidebar row is how a job that failed at 3am reaches the user, and `client/failure-alert.ts`
owns it — the registration, not just the count. **`PluginSidebarContribution` is a static record**,
`{ id, title, icon, surface }`, in the pinned 0.8 and still in 0.9: no badge, no count, no colour,
and no callback the host re-reads. The only way to change what the row says is to unregister the
contribution and register it again, which is why the `addSidebarItem` call moved out of
`index.client.tsx` and into the module that watches for failures.

Removing and adding happen in the same synchronous step, and that is load-bearing in both
directions. Registering the id twice throws `Duplicate sidebar item`, so the old one has to go
first; and the host publishes a new snapshot on each call, so the only reason the row does not
blink out is that React schedules rather than renders between them. Keep those two lines adjacent.
Re-registering also pushes the item to the end of the host's list, which is invisible here because
this plugin contributes exactly one.

**With two hosts, one of them owns the row.** `groupPluginSidebarContributions`
(`packages/app/src/plugins/sidebar-groups.ts` in the app) merges every host's contribution under
`<pluginId>/sidebar/<itemId>`; the first host to arrive sets `title` and `icon`, and later hosts are
appended to `targets` with their own title and icon **discarded**. Order is `PluginRegistry.publish`
sorting installations by `` `${serverId}/${id}` ``, so the owner is whichever opaque server id sorts
first — not the host being viewed, and not the one with the newest bundle. A host still running an
older `launchd-jobs` therefore pins the row to the static label and no count appears anywhere, which
is exactly how this landed the first time it was tried on a two-host setup. There is no API for
reaching another host's plugin, so the count is one machine's and the README says so.

`jobs.health` is a separate contract from `jobs.list` because of *when* it is asked: the poll runs
whether or not the surface is open, once a minute, in every connected client. So it touches no
`launchctl` at all — it globs the prefix, reads the last line of each history file, and answers a
count. The cost of that is real and deliberate: a job launchd has quietly stopped scheduling is
**not** counted, because noticing that means `launchctl print` per label per minute. The README says
so under Limitations.

**Acknowledgement is per run, not per job.** `acknowledged.json` remembers the `startedAt` of the
failure that was seen, so the next failure alerts again with no expiry to tune and no state to
clear. Opening a job's detail is what acknowledges it — the surface's effect keys on the run's
`startedAt`, so a failure landing while the detail is already open is acknowledged too, which is
correct: the user is looking straight at it. A job whose latest run *succeeded* loses its entry
rather than gaining one, so acknowledging can never silence a later failure. Entries for jobs that
no longer exist are pruned on every write, and `deleteJobHandler` drops its own.

`refreshFailureAlert` is the surface's way of telling the alert to re-ask now instead of within the
minute, a module-scope binding lent by `startFailureAlert` the way `herald` lends `openSettings`.
It is called after an acknowledgement and after a delete, not on every list refresh — the 15-second
list poll doubling as a health poll would be twice the traffic for a count that changes hourly at
most.

## Checking the server half against reality

Everything `server/jobs.ts` imports from `shared/jobs.ts` is `import type`, so it transpiles to a
module depending only on Node built-ins, `server/data-dir.ts` and `shared/cron.ts`:

```bash
npx tsc server/jobs.ts server/data-dir.ts shared/cron.ts --module esnext --target es2022 \
  --moduleResolution bundler --outDir /tmp/ljcheck --skipLibCheck --strict --types node --ignoreConfig
sed -i '' 's#from "../shared/cron"#from "../shared/cron.js"#; s#from "./data-dir"#from "./data-dir.js"#' \
  /tmp/ljcheck/server/jobs.js
```

`--strict` matters: without it the `!parsed.ok` narrowing fails and `tsc` reports errors the
project typecheck does not. Then a throwaway `.mjs` in that directory can call `createJobHandler`,
`runJobHandler`, `listJobsHandler`, and `deleteJobHandler` in turn. Run it with `PASEO_HOME` pointed
at a scratch directory so the runner and logs land there — but know that **the plist still goes
into the real `~/Library/LaunchAgents` and launchd really loads it**, because there is no scratch
launchd. Name the test job so it is obviously one, and make sure the script deletes it, or delete it
by hand with `launchctl bootout gui/$UID/<label>` and `rm`. A job left behind from a scratch
`PASEO_HOME` shows as unmanaged in the real plugin, because its runner path differs.

`readJobHealthHandler` and `acknowledgeJobHandler` are cheaper to check than that, and the check is
worth doing because nothing else proves the alert is right: they create no job and load nothing into
launchd. Copy the real `runs/*.jsonl` into a scratch `PASEO_HOME`, edit the last line of one to a
non-zero `exitCode`, and call them there. `listSlugs` still reads the **real** `~/Library/LaunchAgents`
— which is what makes the slugs and `assertKnown` work — while every write lands in the scratch
directory.

There is no harness for the surface. A clean typecheck and a clean
`paseo plugin reload launchd-jobs` prove `client/jobs.tsx` compiles and loads, nothing more. The
sidebar's title and icon are not covered by either: only opening the app shows whether the row
actually repainted.
