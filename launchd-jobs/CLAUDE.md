# CLAUDE.md

A Paseo plugin that adds a **Scheduled jobs** sidebar surface: shell commands on a cron expression
or a fixed interval, written as LaunchAgents and run by launchd on the daemon machine.

The repo root `CLAUDE.md` covers what every plugin here shares: the per-folder npm layout, the
typecheck/reload loop, the client/server bundle split, and the constraints nothing catches at
compile time. This file covers only what is specific to `launchd-jobs`.

## Orientation

| File              | What it owns                                                                     |
| ----------------- | -------------------------------------------------------------------------------- |
| `index.client.tsx` / `index.server.ts`        | Wiring only — binds the seven RPC contracts and registers the sidebar surface.  |
| `shared/jobs.ts`  | The zod contracts, and the `Job` shape both halves agree on.                     |
| `server/jobs.ts`  | Every `launchctl` and `plutil` call, the plist writer, the runner, logs, history. |
| `client/jobs.tsx` | The surface: the list, the detail pane, and the create/edit form.                |
| `client/log-follow.ts` | Follow mode: the `tail -f` terminal behind the log pane's live view.        |
| `shared/cron.ts`         | Unsuffixed, in both bundles: cron ⇄ `StartCalendarInterval`, and the sentences.  |
| `shared/cron.test.ts`    | The only tests. `npm test`.                                                      |
| `README.md`       | What a job is to a user, and what launchd does and does not promise.             |

## launchd is the scheduler and the store

The backend keeps **no timers and no job list**. `contribute` returns an empty cleanup because there
is nothing to release. Everything the surface shows is read back from disk and from `launchctl` on
each `jobs.list`: the plists under the label prefix, `launchctl print` per label,
`launchctl print-disabled` once, and the tail of each job's history file. The one file the plugin
owns is `jobs.json`, mapping slug to display name, because a name like "Nightly backup" does not
survive being made into a label.

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

## Checking the server half against reality

Everything `server/jobs.ts` imports from `shared/jobs.ts` is `import type`, so it transpiles to a
module depending only on Node built-ins and `shared/cron.ts`:

```bash
npx tsc server/jobs.ts shared/cron.ts --module esnext --target es2022 --moduleResolution bundler \
  --outDir /tmp/ljcheck --skipLibCheck --strict --types node --ignoreConfig
sed -i '' 's#from "../shared/cron"#from "../shared/cron.js"#' /tmp/ljcheck/server/jobs.js
```

`--strict` matters: without it the `!parsed.ok` narrowing fails and `tsc` reports errors the
project typecheck does not. Then a throwaway `.mjs` in that directory can call `createJobHandler`,
`runJobHandler`, `listJobsHandler`, and `deleteJobHandler` in turn. Run it with `PASEO_HOME` pointed
at a scratch directory so the runner and logs land there — but know that **the plist still goes
into the real `~/Library/LaunchAgents` and launchd really loads it**, because there is no scratch
launchd. Name the test job so it is obviously one, and make sure the script deletes it, or delete it
by hand with `launchctl bootout gui/$UID/<label>` and `rm`. A job left behind from a scratch
`PASEO_HOME` shows as unmanaged in the real plugin, because its runner path differs.

There is no harness for the surface. A clean typecheck and a clean
`paseo plugin reload launchd-jobs` prove `client/jobs.tsx` compiles and loads, nothing more.
