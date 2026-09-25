import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  describeCron,
  describeEntries,
  describeInterval,
  formatCron,
  fromCalendarEntries,
  parseCron,
  toCalendarEntries,
  type CalendarEntry,
} from "../shared/cron";
import type { Job, JobSpec, RunRecord, Schedule } from "../shared/jobs";
import { dataPath, legacyPluginDir, migrateLegacyData, pluginDir } from "./data-dir";

/**
 * The daemon half: every `launchctl` and `plutil` call, the plist files, the
 * runner script, and the log and history files. launchd is the scheduler and
 * the store — this module keeps no state of its own beyond a file mapping
 * slugs to display names.
 *
 * Everything runs on the **daemon machine**. That is where the LaunchAgents
 * live and where the jobs fire, whether or not Paseo is open.
 */

/**
 * Every job this plugin owns is a LaunchAgent whose label starts with this.
 * Listing globs for it, so nothing else in `~/Library/LaunchAgents` is ever
 * touched, and a plist someone writes by hand under the prefix shows up too.
 */
export const LABEL_PREFIX = "com.paseo-plugins.launchd-jobs.";

const RUNNER_NAME = "runner.sh";
/** How much of a log the panel gets. Older output is still in the file. */
const LOG_TAIL_BYTES = 64 * 1024;
const RUNS_TAIL_BYTES = 64 * 1024;
const RECENT_RUNS = 20;
const FALLBACK_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

const exec = promisify(execFile);

interface CommandFailure extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureText(error: unknown): string {
  const failure = error as CommandFailure;
  const combined = `${failure.stderr ?? ""}\n${failure.stdout ?? ""}`.trim();
  return combined === "" ? failure.message : combined;
}

async function launchctl(args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("launchctl", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    throw new Error(`launchctl ${args.join(" ")} failed: ${failureText(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Paths

function launchAgentsDir(): string {
  return join(homedir(), "Library", "LaunchAgents");
}

function domain(): string {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("Cannot determine the user id for the launchd gui domain");
  return `gui/${uid}`;
}

function labelFor(slug: string): string {
  return `${LABEL_PREFIX}${slug}`;
}

function plistPath(slug: string): string {
  return join(launchAgentsDir(), `${labelFor(slug)}.plist`);
}

function logPath(slug: string): string {
  return join(pluginDir(), "logs", `${slug}.log`);
}

function runsPath(slug: string): string {
  return join(pluginDir(), "runs", `${slug}.jsonl`);
}

function runnerPath(): string {
  return join(pluginDir(), RUNNER_NAME);
}

function namesPath(): string {
  return dataPath("jobs.json");
}

function acksPath(): string {
  return dataPath("acknowledged.json");
}

function isMissing(error: unknown): boolean {
  return (error as { code?: string }).code === "ENOENT";
}

// ---------------------------------------------------------------------------
// The runner

/**
 * What launchd actually spawns. It runs the command through a login shell,
 * writes start and exit markers around its output, appends one JSON line of
 * history, and keeps both files from growing without bound. Kept as data
 * here, rewritten on every save, so an edit to it ships with the plugin.
 *
 * A log is rotated *before* the command starts, by this script, not by
 * launchd: launchd keeps `StandardOutPath` open across the run, so a file
 * moved out from under it would go on receiving output. Only the runner's own
 * stderr goes through launchd, for the case where the runner itself fails.
 */
const RUNNER_SCRIPT = [
  "#!/bin/zsh",
  "# Written by the launchd-jobs Paseo plugin; rewritten whenever a job is saved.",
  "# launchd runs it as: runner.sh <slug> <command>, with PASEO_LAUNCHD_JOBS_DIR set.",
  "set -u",
  "zmodload zsh/datetime",
  'slug="$1"',
  'command="$2"',
  'dir="$PASEO_LAUNCHD_JOBS_DIR"',
  'log="$dir/logs/$slug.log"',
  'runs="$dir/runs/$slug.jsonl"',
  'mkdir -p "$dir/logs" "$dir/runs"',
  'if [[ -f "$log" && $(stat -f %z "$log") -gt 1048576 ]]; then',
  '  mv -f "$log" "$log.1"',
  "fi",
  "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "start_time=$EPOCHREALTIME",
  "{",
  '  print -r -- "=== $started start"',
  '  /bin/zsh -lc "$command"',
  "  code=$?",
  '  print -r -- "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) exit $code"',
  '} >> "$log" 2>&1',
  "finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "duration_ms=$(printf '%.0f' $(( (EPOCHREALTIME - start_time) * 1000 )))",
  'print -r -- "{\\"startedAt\\":\\"$started\\",\\"finishedAt\\":\\"$finished\\",\\"exitCode\\":$code,\\"durationMs\\":$duration_ms}" >> "$runs"',
  'if [[ $(stat -f %z "$runs") -gt 262144 ]]; then',
  '  tail -n 200 "$runs" > "$runs.tmp" && mv -f "$runs.tmp" "$runs"',
  "fi",
  "exit $code",
  "",
].join("\n");

async function ensureRunner(): Promise<string> {
  const path = runnerPath();
  await mkdir(join(pluginDir(), "logs"), { recursive: true });
  await mkdir(join(pluginDir(), "runs"), { recursive: true });
  let current: string | null = null;
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  // Replaced, never rewritten in place: launchd may start it at any moment.
  if (current !== RUNNER_SCRIPT) writeScriptSync(path, RUNNER_SCRIPT);
  return path;
}

/**
 * The PATH a job gets. launchd hands agents `/usr/bin:/bin:/usr/sbin:/sbin`
 * and nothing from any shell startup file, so anything from Homebrew or a
 * version manager is missing. Asking the user's interactive login shell what
 * its PATH is, and writing that into the plist, is what makes `gh` or `node`
 * resolve. Interactive first because most people export PATH in `.zshrc`;
 * login-only next; the plugin's own PATH last, since the daemon under the
 * desktop app has the same bare one launchd would give.
 */
async function loginShellPath(): Promise<string> {
  for (const flags of ["-lic", "-lc"]) {
    try {
      const { stdout } = await exec("/bin/zsh", [flags, 'print -r -- "$PATH"'], {
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, TERM: "dumb" },
      });
      // A startup file may print its own lines first; the PATH is the last
      // line that looks like one.
      const line = stdout
        .split("\n")
        .map((entry) => entry.trim())
        .filter((entry) => entry.includes("/"))
        .pop();
      if (line !== undefined && line !== "") return line;
    } catch (error) {
      console.warn(`[launchd-jobs] zsh ${flags} PATH probe failed: ${failureText(error)}`);
    }
  }
  return process.env.PATH ?? FALLBACK_PATH;
}

// ---------------------------------------------------------------------------
// Display names

interface NameFile {
  names: Record<string, string>;
}

async function readNames(): Promise<NameFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(namesPath(), "utf8"));
    if (typeof parsed === "object" && parsed !== null && "names" in parsed) {
      const names = (parsed as { names: unknown }).names;
      if (typeof names === "object" && names !== null) {
        const clean: Record<string, string> = {};
        for (const [slug, name] of Object.entries(names as Record<string, unknown>)) {
          if (typeof name === "string") clean[slug] = name;
        }
        return { names: clean };
      }
    }
  } catch (error) {
    if (!isMissing(error)) console.warn(`[launchd-jobs] ignoring unreadable ${namesPath()}: ${String(error)}`);
  }
  return { names: {} };
}

async function writeNames(file: NameFile): Promise<void> {
  await mkdir(dirname(namesPath()), { recursive: true });
  await writeFile(namesPath(), `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Acknowledged failures
//
// The sidebar's alert is derived from the history files, with one thing added
// that they cannot hold: whether the user has already seen a failure. That is
// the second file the plugin owns, slug to the `startedAt` of the failing run
// that was acknowledged. Remembering the run rather than the job is what makes
// the alert come back when the job fails again.

interface AckFile {
  acknowledged: Record<string, string>;
}

async function readAcks(): Promise<AckFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(acksPath(), "utf8"));
    if (typeof parsed === "object" && parsed !== null && "acknowledged" in parsed) {
      const entries = (parsed as { acknowledged: unknown }).acknowledged;
      if (typeof entries === "object" && entries !== null) {
        const clean: Record<string, string> = {};
        for (const [slug, startedAt] of Object.entries(entries as Record<string, unknown>)) {
          if (typeof startedAt === "string") clean[slug] = startedAt;
        }
        return { acknowledged: clean };
      }
    }
  } catch (error) {
    if (!isMissing(error)) console.warn(`[launchd-jobs] ignoring unreadable ${acksPath()}: ${String(error)}`);
  }
  return { acknowledged: {} };
}

async function writeAcks(file: AckFile): Promise<void> {
  await mkdir(dirname(acksPath()), { recursive: true });
  await writeFile(acksPath(), `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Reading a job back

export interface PlistFile {
  Label?: unknown;
  ProgramArguments?: unknown;
  EnvironmentVariables?: unknown;
  StandardErrorPath?: unknown;
  WorkingDirectory?: unknown;
  StartCalendarInterval?: unknown;
  StartInterval?: unknown;
}

async function readPlist(path: string): Promise<PlistFile> {
  const { stdout } = await exec("plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf8" });
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a dictionary`);
  }
  return parsed as PlistFile;
}

const PLIST_KEYS: Record<string, keyof CalendarEntry> = {
  Minute: "minute",
  Hour: "hour",
  Day: "day",
  Month: "month",
  Weekday: "weekday",
};

function calendarEntriesOf(value: unknown): CalendarEntry[] | null {
  if (value === undefined || value === null) return null;
  const dicts = Array.isArray(value) ? value : [value];
  const entries: CalendarEntry[] = [];
  for (const dict of dicts) {
    if (typeof dict !== "object" || dict === null) return null;
    const entry: CalendarEntry = {};
    for (const [key, field] of Object.entries(PLIST_KEYS)) {
      const raw = (dict as Record<string, unknown>)[key];
      if (raw === undefined) continue;
      if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
      entry[field] = raw;
    }
    entries.push(entry);
  }
  return entries;
}

function scheduleOf(plist: PlistFile): Schedule {
  if (typeof plist.StartInterval === "number" && plist.StartInterval > 0) {
    const seconds = Math.round(plist.StartInterval);
    return { type: "interval", seconds, description: describeInterval(seconds) };
  }
  const entries = calendarEntriesOf(plist.StartCalendarInterval);
  if (entries === null) return { type: "none", description: "Only when run by hand" };
  const fields = fromCalendarEntries(entries);
  if (fields === null) return { type: "calendar", description: describeEntries(entries), entries };
  return { type: "cron", expression: formatCron(fields), description: describeCron(fields), entries };
}

function shellQuote(word: string): string {
  return /^[A-Za-z0-9_/.:=+@%,-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

/**
 * The command as the user wrote it, when the plist is in the runner shape,
 * or the spawn line as launchd would run it otherwise, quoted for reading.
 */
function commandOf(plist: PlistFile, runner: string): { command: string; managed: boolean } {
  const args = Array.isArray(plist.ProgramArguments)
    ? plist.ProgramArguments.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (args.length === 4 && args[0] === "/bin/zsh" && args[1] === runner) {
    return { command: args[3] ?? "", managed: true };
  }
  return { command: args.map(shellQuote).join(" "), managed: false };
}

interface LaunchdStatus {
  loaded: boolean;
  running: boolean;
  pid: number | null;
  runs: number | null;
  lastExitCode: number | null;
}

const UNLOADED: LaunchdStatus = { loaded: false, running: false, pid: null, runs: null, lastExitCode: null };

function matchInt(text: string, pattern: RegExp): number | null {
  const found = pattern.exec(text)?.[1];
  return found === undefined ? null : Number(found);
}

/**
 * `launchctl print` is the only place launchd reports state, and its output
 * is prose, so this reads the few lines whose shape has held across releases
 * and treats everything else as absent. Exit 113 with "Could not find
 * service" is the one failure that means something: the label is not loaded.
 */
async function readStatus(label: string): Promise<LaunchdStatus> {
  const output = await printService(label);
  return output === null ? UNLOADED : statusOf(output);
}

function statusOf(output: string): LaunchdStatus {
  const state = /^\s*state = (.+?)\s*$/m.exec(output)?.[1] ?? "";
  return {
    loaded: true,
    running: state.startsWith("running"),
    pid: matchInt(output, /^\s*pid = (\d+)\s*$/m),
    runs: matchInt(output, /^\s*runs = (\d+)\s*$/m),
    lastExitCode: matchInt(output, /^\s*last exit code = (-?\d+)\s*$/m),
  };
}

/** `launchctl print` for one label, or null when it is not loaded. */
async function printService(label: string): Promise<string | null> {
  try {
    const { stdout } = await exec("launchctl", ["print", `${domain()}/${label}`], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const failure = error as CommandFailure;
    if (failure.code === 113 || /Could not find service/.test(failureText(error))) return null;
    throw new Error(`launchctl print ${label} failed: ${failureText(error)}`);
  }
}

/** Labels `launchctl disable` has been applied to, read once per list. */
async function readDisabled(): Promise<Set<string>> {
  const output = await launchctl(["print-disabled", domain()]);
  const disabled = new Set<string>();
  for (const match of output.matchAll(/"([^"]+)" => disabled/g)) {
    const label = match[1];
    if (label !== undefined) disabled.add(label);
  }
  return disabled;
}

/**
 * The last `bytes` of a file, from the first whole line. A missing file is
 * an empty tail, not an error: a job that has never run has no log yet.
 */
async function readTail(path: string, bytes: number): Promise<{ text: string; truncated: boolean }> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (isMissing(error)) return { text: "", truncated: false };
    throw error;
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    let text = buffer.toString("utf8");
    const truncated = start > 0;
    if (truncated) {
      const newline = text.indexOf("\n");
      text = newline === -1 ? "" : text.slice(newline + 1);
    }
    return { text, truncated };
  } finally {
    await handle.close();
  }
}

function toRunRecord(line: string): RunRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.startedAt !== "string" ||
      typeof record.finishedAt !== "string" ||
      typeof record.exitCode !== "number" ||
      typeof record.durationMs !== "number"
    ) {
      return null;
    }
    return {
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      exitCode: record.exitCode,
      durationMs: Math.max(0, Math.round(record.durationMs)),
    };
  } catch {
    return null;
  }
}

async function readRuns(slug: string): Promise<RunRecord[]> {
  const { text } = await readTail(runsPath(slug), RUNS_TAIL_BYTES);
  const records: RunRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const record = toRunRecord(line);
    if (record !== null) records.push(record);
  }
  return records.slice(-RECENT_RUNS).reverse();
}

async function readJob(slug: string, disabled: ReadonlySet<string>, names: NameFile): Promise<Job> {
  const label = labelFor(slug);
  const path = plistPath(slug);
  const base = {
    id: slug,
    label,
    name: names.names[slug] ?? slug,
    plistPath: path,
    logPath: logPath(slug),
    disabled: disabled.has(label),
  };
  const [plistResult, status, recentRuns] = await Promise.all([
    readPlist(path).then(
      (plist) => ({ plist, problem: null as string | null }),
      (error: unknown) => ({ plist: null, problem: `Could not read the plist: ${failureText(error)}` }),
    ),
    readStatus(label),
    readRuns(slug),
  ]);
  if (plistResult.plist === null) {
    return {
      ...base,
      command: "",
      cwd: null,
      schedule: { type: "none", description: "Unknown" },
      managed: false,
      ...status,
      recentRuns,
      problem: plistResult.problem,
    };
  }
  const { plist } = plistResult;
  const { command, managed } = commandOf(plist, runnerPath());
  return {
    ...base,
    command,
    cwd: typeof plist.WorkingDirectory === "string" ? plist.WorkingDirectory : null,
    schedule: scheduleOf(plist),
    managed,
    ...status,
    recentRuns,
    problem: null,
  };
}

async function listSlugs(): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(launchAgentsDir());
  } catch (error) {
    if (!isMissing(error)) throw error;
    return [];
  }
  return names
    .filter((name) => name.startsWith(LABEL_PREFIX) && name.endsWith(".plist"))
    .map((name) => name.slice(LABEL_PREFIX.length, -".plist".length))
    .sort();
}

async function loadJob(slug: string): Promise<Job> {
  const [disabled, names] = await Promise.all([readDisabled(), readNames()]);
  return readJob(slug, disabled, names);
}

// ---------------------------------------------------------------------------
// Writing a job

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ENTRY_KEYS: ReadonlyArray<[keyof CalendarEntry, string]> = [
  ["minute", "Minute"],
  ["hour", "Hour"],
  ["day", "Day"],
  ["month", "Month"],
  ["weekday", "Weekday"],
];

function scheduleXml(schedule: JobSpec["schedule"]): string {
  if (schedule.type === "interval") {
    return `  <key>StartInterval</key>\n  <integer>${schedule.seconds}</integer>\n`;
  }
  const parsed = parseCron(schedule.expression);
  if (!parsed.ok) throw new Error(parsed.error);
  const dicts = toCalendarEntries(parsed.fields).map((entry) => {
    const keys = ENTRY_KEYS.filter(([field]) => entry[field] !== undefined)
      .map(([field, key]) => `      <key>${key}</key>\n      <integer>${entry[field]}</integer>\n`)
      .join("");
    return keys === "" ? "    <dict/>\n" : `    <dict>\n${keys}    </dict>\n`;
  });
  return `  <key>StartCalendarInterval</key>\n  <array>\n${dicts.join("")}  </array>\n`;
}

function plistXml(input: {
  slug: string;
  spec: JobSpec;
  runner: string;
  path: string;
}): string {
  const { slug, spec } = input;
  const env = [
    ["PATH", input.path],
    ["PASEO_LAUNCHD_JOBS_DIR", pluginDir()],
  ]
    .map(([key, value]) => `    <key>${key}</key>\n    <string>${escapeXml(value ?? "")}</string>\n`)
    .join("");
  const cwd = spec.cwd === null ? "" : `  <key>WorkingDirectory</key>\n  <string>${escapeXml(spec.cwd)}</string>\n`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    `  <key>Label</key>\n  <string>${escapeXml(labelFor(slug))}</string>`,
    "  <key>ProgramArguments</key>\n  <array>",
    "    <string>/bin/zsh</string>",
    `    <string>${escapeXml(input.runner)}</string>`,
    `    <string>${escapeXml(slug)}</string>`,
    `    <string>${escapeXml(spec.command)}</string>`,
    "  </array>",
    `${cwd}  <key>EnvironmentVariables</key>\n  <dict>\n${env}  </dict>`,
    scheduleXml(spec.schedule).trimEnd(),
    // Only the runner's own failures reach this file; the command's output is
    // appended by the runner, which is what lets the runner rotate it.
    `  <key>StandardErrorPath</key>\n  <string>${escapeXml(logPath(slug))}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug === "" ? "job" : slug;
}

async function uniqueSlug(name: string): Promise<string> {
  const taken = new Set(await listSlugs());
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Validates what zod cannot: the cron parses, the directory is absolute. */
function normaliseSpec(spec: JobSpec): JobSpec {
  if (spec.schedule.type === "cron") {
    const parsed = parseCron(spec.schedule.expression);
    if (!parsed.ok) throw new Error(parsed.error);
  }
  let cwd = spec.cwd;
  if (cwd !== null) {
    if (cwd === "") cwd = null;
    else if (cwd === "~" || cwd.startsWith("~/")) cwd = join(homedir(), cwd.slice(1));
    else if (!cwd.startsWith("/")) throw new Error("The working directory must be an absolute path");
  }
  return { ...spec, cwd };
}

/** Ignores "not loaded"; anything else is a real failure. */
async function bootoutIfLoaded(label: string): Promise<void> {
  try {
    await exec("launchctl", ["bootout", `${domain()}/${label}`], { encoding: "utf8" });
  } catch (error) {
    const text = failureText(error);
    if (/No such process|Could not find service/.test(text)) return;
    throw new Error(`launchctl bootout ${label} failed: ${text}`);
  }
}

async function bootstrap(slug: string): Promise<void> {
  await launchctl(["bootstrap", domain(), plistPath(slug)]);
}

async function writeJob(slug: string, spec: JobSpec): Promise<void> {
  const [runner, path] = await Promise.all([ensureRunner(), loginShellPath()]);
  const names = await readNames();
  names.names[slug] = spec.name;
  await writeNames(names);
  await mkdir(launchAgentsDir(), { recursive: true });
  await writeFile(plistPath(slug), plistXml({ slug, spec, runner, path }), "utf8");
}

async function assertKnown(slug: string): Promise<void> {
  try {
    await stat(plistPath(slug));
  } catch (error) {
    if (isMissing(error)) throw new Error(`No job "${slug}" under ${launchAgentsDir()}`);
    throw error;
  }
}

function assertSupported(): void {
  if (process.platform !== "darwin") {
    throw new Error("launchd jobs are only available when the daemon runs on macOS");
  }
}

// ---------------------------------------------------------------------------
// Moving out of `plugins/launchd-jobs`
//
// The runner, logs and history used to live in `$PASEO_HOME/plugins/launchd-jobs/`,
// which `paseo plugin remove` deletes on an npm or Git install. Every plist names
// the runner, the directory and the stderr log by absolute path, and launchd keeps
// the definition it loaded until the job is booted out and back in — so the files
// move first (`moveLegacyFiles`, synchronously, from the server entry) and the jobs
// follow (`relocateLegacyJobs`, after it).

function legacyRunnerPath(): string {
  return join(legacyPluginDir(), RUNNER_NAME);
}

/**
 * What stands at the old runner path while launchd still holds a job loaded
 * from there: it runs the new runner against the new directory, so the next
 * fire works and its log lands where the surface reads it.
 *
 * First it moves this job's own log and history, if they are still in the old
 * place, with the same no-clobber link the daemon uses. launchd never runs two
 * instances of one job, so nothing else is writing them, and the new runner
 * never starts a fresh file under a name whose history is still in the old
 * directory. Racing the daemon's move of the same file is harmless: both link
 * the one inode, and whichever lands second finds it there.
 */
function forwardingRunner(): string {
  return [
    "#!/bin/zsh",
    "# Written by the launchd-jobs Paseo plugin, whose files moved to plugin-data. It forwards jobs",
    "# launchd loaded before the move, and is removed once every one of them has been reloaded.",
    `legacy=${shellQuote(legacyPluginDir())}`,
    `new=${shellQuote(pluginDir())}`,
    'for file in "logs/$1.log.1" "logs/$1.log" "runs/$1.jsonl"; do',
    '  if [[ -f "$legacy/$file" ]]; then',
    '    mkdir -p "$new/${file:h}"',
    '    ln "$legacy/$file" "$new/$file" 2>/dev/null && rm -f "$legacy/$file"',
    "  fi",
    "done",
    'export PASEO_LAUNCHD_JOBS_DIR="$new"',
    `exec /bin/zsh ${shellQuote(runnerPath())} "$@"`,
    "",
  ].join("\n");
}

/**
 * Writes a script launchd may start at any moment: to a temporary file beside
 * it, made executable, then renamed over it, so a fire sees the old script or
 * the new one and never an empty or half-written one. A failure leaves the old
 * script as it was.
 */
function writeScriptSync(path: string, content: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, "utf8");
    chmodSync(temporary, 0o755);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** What `logs/` or `runs/` holds in the legacy directory, as entries to move one by one. */
function legacyEntriesIn(directory: string): string[] {
  try {
    return readdirSync(join(legacyPluginDir(), directory)).map((name) => join(directory, name));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/**
 * Moves the plugin's files, called by the server entry before any handler is
 * bound, and says whether the jobs may follow (`relocateLegacyJobs`).
 *
 * Jobs launchd loaded from the old runner can fire at any moment, so the new
 * runner and the forwarder go in *before* anything moves: from then on a fire
 * writes to the new directory, having first moved its own files there. Logs
 * and history move file by file, so a fire that has created `logs/` in the new
 * directory cannot make the old directory look superseded. `runner.sh` itself
 * is not moved: the new one is written fresh, and the old path is the
 * forwarder's. When the forwarder cannot be installed nothing moves — fires
 * would still write the old files — and the next start tries again.
 */
export function moveLegacyFiles(): boolean {
  const legacyRunner = legacyRunnerPath();
  if (existsSync(legacyRunner)) {
    try {
      mkdirSync(join(pluginDir(), "logs"), { recursive: true });
      mkdirSync(join(pluginDir(), "runs"), { recursive: true });
      writeScriptSync(runnerPath(), RUNNER_SCRIPT);
      writeScriptSync(legacyRunner, forwardingRunner());
    } catch (error) {
      console.error(`[launchd-jobs] could not put a forwarder at ${legacyRunner}, so nothing moves this start:`, error);
      return false;
    }
  }
  migrateLegacyData(["jobs.json", "acknowledged.json", ...legacyEntriesIn("logs"), ...legacyEntriesIn("runs")]);
  return true;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function writeForwardingRunner(): Promise<void> {
  // launchd opens the loaded job's `StandardErrorPath`, which is still under here.
  await mkdir(join(legacyPluginDir(), "logs"), { recursive: true });
  writeScriptSync(legacyRunnerPath(), forwardingRunner());
}

async function removeForwardingRunner(): Promise<void> {
  await unlink(legacyRunnerPath());
  // launchd creates the loaded job's stderr file there, empty, since the
  // forwarded runner writes the real log. Only empty files go, and then each
  // directory only if nothing else is left in it.
  for (const directory of ["logs", "runs"]) {
    const path = join(legacyPluginDir(), directory);
    let names: string[];
    try {
      names = await readdir(path);
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    await Promise.all(
      names.map(async (name) => {
        const file = join(path, name);
        const info = await lstat(file);
        if (info.isFile() && info.size === 0) await unlink(file);
      }),
    );
    try {
      await rmdir(path);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOTEMPTY") throw error;
    }
  }
}

/**
 * The `plutil -replace` arguments that bring one of this plugin's plists onto
 * the new directory: each of the three paths compared on its own, so a rewrite
 * cut short after the first — a failed `plutil`, a stopped daemon — is finished
 * on the next start rather than skipped because the runner already looks new.
 * `ProgramArguments` is replaced whole: `-replace` on an array index inserts.
 * Empty for a plist that is not in the runner shape, or already right.
 */
export function plistRepairs(plist: PlistFile, slug: string): [keyPath: string, type: string, value: string][] {
  const args = Array.isArray(plist.ProgramArguments) ? (plist.ProgramArguments as unknown[]) : [];
  const ours = args.length === 4 && args[0] === "/bin/zsh" && (args[1] === legacyRunnerPath() || args[1] === runnerPath());
  if (!ours) return [];
  const repairs: [string, string, string][] = [];
  if (args[1] !== runnerPath()) {
    repairs.push(["ProgramArguments", "-json", JSON.stringify(args.map((arg, index) => (index === 1 ? runnerPath() : arg)))]);
  }
  const env = plist.EnvironmentVariables;
  const dir = typeof env === "object" && env !== null ? (env as Record<string, unknown>)["PASEO_LAUNCHD_JOBS_DIR"] : undefined;
  if (dir !== pluginDir()) repairs.push(["EnvironmentVariables.PASEO_LAUNCHD_JOBS_DIR", "-string", pluginDir()]);
  if (plist.StandardErrorPath !== logPath(slug)) repairs.push(["StandardErrorPath", "-string", logPath(slug)]);
  return repairs;
}

/** Whether launchd's loaded definition (`launchctl print`) still names anything under the legacy directory. */
export function loadedFromLegacy(printed: string): boolean {
  const legacy = legacyPluginDir();
  return printed.split("\n").some((line) => {
    const text = line.trim();
    return text.includes(`${legacy}/`) || text.endsWith(legacy);
  });
}

async function repointPlist(slug: string, repairs: readonly [string, string, string][]): Promise<void> {
  const path = plistPath(slug);
  for (const [keyPath, type, value] of repairs) {
    try {
      await exec("plutil", ["-replace", keyPath, type, value, path], { encoding: "utf8" });
    } catch (error) {
      throw new Error(`plutil -replace ${keyPath} in ${path} failed: ${failureText(error)}`);
    }
  }
}

/**
 * Returns true when the job is done with the legacy directory, false when it
 * still needs the forwarding runner: launchd holds it from there and it is
 * running now, so a bootout would kill it. The next start tries it again.
 */
async function relocateJob(slug: string): Promise<boolean> {
  const repairs = plistRepairs(await readPlist(plistPath(slug)), slug);
  if (repairs.length > 0) {
    await repointPlist(slug, repairs);
    console.log(`[launchd-jobs] pointed ${plistPath(slug)} at ${pluginDir()}`);
  }
  const label = labelFor(slug);
  const loaded = await printService(label);
  if (loaded === null || !loadedFromLegacy(loaded)) return true;
  if (statusOf(loaded).running) {
    console.warn(`[launchd-jobs] ${label} is running, so it is reloaded from its new plist on a later start`);
    return false;
  }
  await bootoutIfLoaded(label);
  await bootstrap(slug);
  return true;
}

/**
 * Called once from the server entry, after `moveLegacyFiles`. A job it cannot
 * move keeps the forwarding runner, so no job stops firing because of the move;
 * every failure is logged with the paths involved.
 */
export async function relocateLegacyJobs(): Promise<void> {
  if (process.platform !== "darwin") return;
  const legacyRunner = legacyRunnerPath();
  await ensureRunner();

  let forwardingNeeded = false;
  for (const slug of await listSlugs()) {
    try {
      if (!(await relocateJob(slug))) forwardingNeeded = true;
    } catch (error) {
      forwardingNeeded = true;
      console.error(`[launchd-jobs] could not move ${plistPath(slug)} off ${legacyPluginDir()}: ${errorMessage(error)}`);
    }
  }

  if (forwardingNeeded) await writeForwardingRunner();
  else if (await pathExists(legacyRunner)) await removeForwardingRunner();
}

// ---------------------------------------------------------------------------
// Handlers

export async function listJobsHandler(): Promise<{ supported: boolean; jobs: Job[]; launchAgentsDir: string }> {
  const dir = launchAgentsDir();
  if (process.platform !== "darwin") return { supported: false, jobs: [], launchAgentsDir: dir };
  const [slugs, disabled, names] = await Promise.all([listSlugs(), readDisabled(), readNames()]);
  const jobs = await Promise.all(slugs.map((slug) => readJob(slug, disabled, names)));
  return { supported: true, jobs, launchAgentsDir: dir };
}

export async function createJobHandler(input: JobSpec): Promise<Job> {
  assertSupported();
  const spec = normaliseSpec(input);
  const slug = await uniqueSlug(spec.name);
  await writeJob(slug, spec);
  // The file stays if launchd refuses it: the list shows it unloaded with
  // the error in hand, and Enable retries once the cause is fixed.
  await bootstrap(slug);
  return loadJob(slug);
}

export async function updateJobHandler(input: { id: string; spec: JobSpec }): Promise<Job> {
  assertSupported();
  await assertKnown(input.id);
  const spec = normaliseSpec(input.spec);
  const label = labelFor(input.id);
  const disabled = (await readDisabled()).has(label);
  // launchd does not reread a changed plist; the job has to leave and return.
  await bootoutIfLoaded(label);
  await writeJob(input.id, spec);
  if (!disabled) await bootstrap(input.id);
  return loadJob(input.id);
}

export async function deleteJobHandler(input: { id: string }): Promise<Record<string, never>> {
  assertSupported();
  await assertKnown(input.id);
  const label = labelFor(input.id);
  await bootoutIfLoaded(label);
  // A `disable` outlives the plist: launchd keeps it per label in its own
  // override store, so without this a later job with the same slug would be
  // born disabled.
  try {
    await launchctl(["enable", `${domain()}/${label}`]);
  } catch (error) {
    console.warn(`[launchd-jobs] could not clear the disabled flag for ${label}: ${errorMessage(error)}`);
  }
  for (const path of [plistPath(input.id), logPath(input.id), `${logPath(input.id)}.1`, runsPath(input.id)]) {
    try {
      await unlink(path);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  const names = await readNames();
  delete names.names[input.id];
  await writeNames(names);
  const acks = await readAcks();
  if (input.id in acks.acknowledged) {
    delete acks.acknowledged[input.id];
    await writeAcks(acks);
  }
  return {};
}

export async function runJobHandler(input: { id: string }): Promise<Record<string, never>> {
  assertSupported();
  await assertKnown(input.id);
  const label = labelFor(input.id);
  const status = await readStatus(label);
  if (!status.loaded) throw new Error("The job is not loaded; enable it first");
  await launchctl(["kickstart", `${domain()}/${label}`]);
  return {};
}

export async function setJobEnabledHandler(input: { id: string; enabled: boolean }): Promise<Job> {
  assertSupported();
  await assertKnown(input.id);
  const label = labelFor(input.id);
  if (input.enabled) {
    // `enable` first: bootstrapping a disabled label is refused.
    await launchctl(["enable", `${domain()}/${label}`]);
    await bootoutIfLoaded(label);
    await bootstrap(input.id);
  } else {
    await bootoutIfLoaded(label);
    await launchctl(["disable", `${domain()}/${label}`]);
  }
  return loadJob(input.id);
}

export async function readJobLogHandler(input: { id: string }): Promise<{ text: string; truncated: boolean; path: string }> {
  assertSupported();
  const path = logPath(input.id);
  const tail = await readTail(path, LOG_TAIL_BYTES);
  return { ...tail, path };
}

/**
 * Which jobs are failing and unacknowledged. Deliberately free of `launchctl`:
 * the sidebar polls this whether or not the surface is open, and everything it
 * needs is the last line of each history file. A job launchd has quietly
 * stopped scheduling therefore does not show up here — the surface's own status
 * column is where that is visible.
 */
export async function readJobHealthHandler(): Promise<{
  supported: boolean;
  failing: { id: string; name: string }[];
}> {
  if (process.platform !== "darwin") return { supported: false, failing: [] };
  const [slugs, names, acks] = await Promise.all([listSlugs(), readNames(), readAcks()]);
  const checked = await Promise.all(
    slugs.map(async function check(slug): Promise<{ id: string; name: string } | null> {
      const last = (await readRuns(slug))[0];
      if (last === undefined || last.exitCode === 0) return null;
      if (acks.acknowledged[slug] === last.startedAt) return null;
      return { id: slug, name: names.names[slug] ?? slug };
    }),
  );
  const failing: { id: string; name: string }[] = [];
  for (const entry of checked) {
    if (entry !== null) failing.push(entry);
  }
  return { supported: true, failing };
}

/**
 * Remembers that the user has seen this job's latest run. A job whose latest
 * run succeeded loses its entry instead of gaining one, so acknowledging is
 * never what makes a later failure silent. Entries for jobs that no longer
 * exist are dropped on the way past.
 */
export async function acknowledgeJobHandler(input: { id: string }): Promise<Record<string, never>> {
  assertSupported();
  await assertKnown(input.id);
  const [last, acks, slugs] = await Promise.all([
    readRuns(input.id).then((runs) => runs[0]),
    readAcks(),
    listSlugs(),
  ]);
  const known = new Set(slugs);
  const next: Record<string, string> = {};
  for (const [slug, startedAt] of Object.entries(acks.acknowledged)) {
    if (known.has(slug)) next[slug] = startedAt;
  }
  if (last === undefined || last.exitCode === 0) delete next[input.id];
  else next[input.id] = last.startedAt;
  await writeAcks({ acknowledged: next });
  return {};
}
