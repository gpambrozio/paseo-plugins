import { execFile } from "node:child_process";
import { chmod, mkdir, open, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
} from "./cron";
import type { Job, JobSpec, RunRecord, Schedule } from "./jobs.shared";

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

function paseoHome(): string {
  return process.env.PASEO_HOME ?? join(homedir(), ".paseo");
}

function dataDir(): string {
  return join(paseoHome(), "plugins", "launchd-jobs");
}

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
  return join(dataDir(), "logs", `${slug}.log`);
}

function runsPath(slug: string): string {
  return join(dataDir(), "runs", `${slug}.jsonl`);
}

function runnerPath(): string {
  return join(dataDir(), RUNNER_NAME);
}

function namesPath(): string {
  return join(dataDir(), "jobs.json");
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
  await mkdir(join(dataDir(), "logs"), { recursive: true });
  await mkdir(join(dataDir(), "runs"), { recursive: true });
  let current: string | null = null;
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  if (current !== RUNNER_SCRIPT) await writeFile(path, RUNNER_SCRIPT, "utf8");
  await chmod(path, 0o755);
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
  await mkdir(dataDir(), { recursive: true });
  await writeFile(namesPath(), `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Reading a job back

interface PlistFile {
  Label?: unknown;
  ProgramArguments?: unknown;
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
  let output: string;
  try {
    ({ stdout: output } = await exec("launchctl", ["print", `${domain()}/${label}`], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    }));
  } catch (error) {
    const failure = error as CommandFailure;
    if (failure.code === 113 || /Could not find service/.test(failureText(error))) return UNLOADED;
    throw new Error(`launchctl print ${label} failed: ${failureText(error)}`);
  }
  const state = /^\s*state = (.+?)\s*$/m.exec(output)?.[1] ?? "";
  return {
    loaded: true,
    running: state.startsWith("running"),
    pid: matchInt(output, /^\s*pid = (\d+)\s*$/m),
    runs: matchInt(output, /^\s*runs = (\d+)\s*$/m),
    lastExitCode: matchInt(output, /^\s*last exit code = (-?\d+)\s*$/m),
  };
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
    ["PASEO_LAUNCHD_JOBS_DIR", dataDir()],
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
