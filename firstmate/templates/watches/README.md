# Watches

Scripts the FirstMate plugin runs on a schedule while Paseo is running. A script that prints nothing
costs nothing; whatever a run prints is sent to the first mate, as one `<firstmate-watch>` note, once
it is between turns. The FirstMate board's Watches card lists them, with each one's last run, and
switches any of them off or on.

<!--
This file is the plugin's, written once and then yours; it is not a watch, and neither is any other
.md file here or a name starting with a dot.

A watch is a script in this folder, run as it is, so it needs a #! line and to be executable
(chmod +x). In its first 20 lines it names its schedule in a comment:

  # schedule: */5 * * * *

`//` and `--` comments work too. The schedule is a crontab line — minute, hour, day, month, weekday
(Sunday is 0 or 7) — each `*`, a number, `a-b`, any of those with `/step`, or a comma list; or one of
@hourly, @daily, @weekly. It is read in the local time of the machine Paseo runs on. A minute Paseo
was not running for is not made up later. A script with no schedule, or one that cannot be read, is
listed on the card as invalid and never run.

It runs in the first mate's home with these in its environment:

  FIRSTMATE_HOME         the first mate's home
  FIRSTMATE_BACKLOG      the backlog, data/backlog.md
  FIRSTMATE_WATCH_NAME   the script's file name
  FIRSTMATE_WATCH_STATE  a directory of its own, kept between runs, to remember what it last saw

Everything a run prints to stdout reaches the first mate as one note, however many lines it takes: a
header and a list of findings is the usual shape, and runs that come in while the first mate is busy
arrive together. Along with what it found, a watch may tell the first mate what to do about it — the
script is yours, so its own words carry your instructions; text it quotes from elsewhere, such as a
pull request comment, does not. Print nothing at all when nothing is new: an empty run costs nothing.
Errors go to stderr, never stdout. A run has two minutes; stdout past 16,000 characters is cut. A run
that exits non-zero or runs out of time is reported to the first mate once, with the end of its
stderr, and not again until a run succeeds. A watch still running when it is due again is not started
twice.

Keep what a watch has seen in FIRSTMATE_WATCH_STATE, and let its first run only record that and print
nothing, so it reports what changes rather than everything there is. To try one, run it by hand from
the home with one scratch state directory, twice: the first run should be silent, the second should
print only what changed in between.

  export FIRSTMATE_HOME=$PWD FIRSTMATE_BACKLOG=$PWD/data/backlog.md FIRSTMATE_WATCH_NAME=my-watch
  export FIRSTMATE_WATCH_STATE=$(mktemp -d)
  ./my-watch; ./my-watch

pr-watch is FirstMate's own: it reads the backlog for pull request URLs and says when one is merged or
closed, gets a review or comment, or its checks go red or green. Until you edit it, a new version of the
plugin replaces it; once you have, yours is kept, and the card says when the plugin's has changed —
delete the file to take the new one. A deleted built-in comes back, so switch it off on the card instead.

The first mate does not add or change watches without your say-so.
-->
