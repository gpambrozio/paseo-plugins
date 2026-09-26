/**
 * The home's `watches/` folder: the scripts in it, each one's schedule, and the plugin's own watches
 * seeded into it.
 *
 * A watch is any file directly in `watches/` whose name is letters, digits, `.`, `_` and `-`, does not
 * start with a dot and does not end in `.md` (the folder's README). It declares its schedule in a
 * comment in its first lines — `# schedule: 0,30 9-17 * * 1-5`, or `//` or `--` for languages that comment
 * that way — and it has to be executable, since it is run as it is, by its `#!` line. A file that
 * fails any of that is still listed, as invalid with the reason, and never run.
 *
 * **The plugin's own watches** (`BUILT_IN_WATCHES`) start as their namesakes in `templates/watches/`,
 * and follow the plugin until the captain edits them — the way `data/charter.md` does
 * (`charter-file.ts`). Each carries a `firstmate-watch <fingerprint>` line recording the version it
 * was copied from:
 *
 * - **Untouched** — the copy still matches its fingerprint, so a new plugin version replaces it.
 * - **Edited** — the captain's copy is kept as it is. When the plugin's version has moved on, the
 *   board says so; deleting the file takes the new one.
 * - **Missing** — written again. Switching a watch off on the board is how it is kept quiet.
 */
import { createHash } from "node:crypto";
import { chmod, mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { WATCHES_DIR } from "../shared/fleet";
import { parseSchedule, type Schedule } from "./watch-schedule";
import { TEMPLATES, fill, readTemplate, type TemplatePath } from "./templates";

export { WATCHES_DIR };

/** The plugin's own watches: the file name each has in `watches/`, and its template. */
export const BUILT_IN_WATCHES: ReadonlyArray<{ name: string; template: TemplatePath }> = [
  { name: "pr-watch", template: TEMPLATES.watchPr },
];

/** How far into a file the schedule comment is looked for. */
const HEADER_LINES = 20;
const HEADER_BYTES = 4096;

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SCHEDULE_LINE = /^\s*(?:#|\/\/|--)\s*schedule:\s*(.*?)\s*$/i;

export interface WatchFile {
  name: string;
  path: string;
  /** The schedule as written, or null when the header has none. */
  scheduleText: string | null;
  /** Null when invalid. */
  schedule: Schedule | null;
  /** Why it cannot run, or null. */
  invalid: string | null;
}

/** The schedule a script's first lines declare, as written, or null. */
export function scheduleLine(text: string): string | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").slice(0, HEADER_LINES);
  for (const line of lines) {
    const match = SCHEDULE_LINE.exec(line);
    if (match !== null) return match[1] ?? "";
  }
  return null;
}

async function readHead(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readWatch(directory: string, name: string): Promise<WatchFile> {
  const path = join(directory, name);
  const invalid = (reason: string, scheduleText: string | null = null): WatchFile => ({
    name,
    path,
    scheduleText,
    schedule: null,
    invalid: reason,
  });
  if (!NAME.test(name)) return invalid("its name may have only letters, digits, dots, dashes and underscores");
  let head: string;
  let mode: number;
  try {
    head = await readHead(path);
    ({ mode } = await stat(path));
  } catch (error) {
    return invalid(`it could not be read: ${describe(error)}`);
  }
  const scheduleText = scheduleLine(head);
  if (scheduleText === null) {
    return invalid(`it has no "schedule:" comment in its first ${HEADER_LINES} lines`);
  }
  let schedule: Schedule;
  try {
    schedule = parseSchedule(scheduleText);
  } catch (error) {
    return invalid(`its schedule cannot be read: ${describe(error)}`, scheduleText);
  }
  if ((mode & 0o111) === 0) return invalid("it is not executable (chmod +x)", scheduleText);
  if (!head.startsWith("#!")) return invalid("it has no #! line saying what runs it", scheduleText);
  return { name, path, scheduleText, schedule, invalid: null };
}

/** Every watch in `<home>/watches/`, by name; none when the folder is missing. */
export async function listWatches(home: string): Promise<WatchFile[]> {
  const directory = join(home, WATCHES_DIR);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const names = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && !entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  return Promise.all(names.map((name) => readWatch(directory, name)));
}

// ---------------------------------------------------------------------------
// The plugin's own watches
// ---------------------------------------------------------------------------

const MARK = /firstmate-watch ([0-9a-f]{16}|\{\{fingerprint\}\})/;

/** The script's fingerprint: its text with the fingerprint itself left out. */
export function watchFingerprint(text: string): string {
  const neutral = text.replace(/\r\n?/g, "\n").replace(MARK, "firstmate-watch");
  return createHash("sha256").update(neutral).digest("hex").slice(0, 16);
}

/** The copy as the plugin writes it: its template, fingerprinted. */
function copyOf(template: string): string {
  return fill(template, { fingerprint: watchFingerprint(template) });
}

export interface BuiltInState {
  /** The copy should become the plugin's current version. */
  rewrite: boolean;
  edited: boolean;
  /** Edited, and the plugin's version has changed since the one it started from. */
  outdated: boolean;
}

/** What a built-in's copy means, given the plugin's current template; null copy is a missing file. */
export function assessBuiltIn(copy: string | null, template: string): BuiltInState {
  if (copy === null) return { rewrite: true, edited: false, outdated: false };
  const current = watchFingerprint(template);
  const base = MARK.exec(copy)?.[1] ?? null;
  if (base !== null && watchFingerprint(copy) === base) {
    return { rewrite: base !== current, edited: false, outdated: false };
  }
  return { rewrite: false, edited: true, outdated: base !== current };
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Each built-in's state, by name, touching nothing: what the board reads on every poll. */
export async function builtInStates(home: string): Promise<Map<string, BuiltInState>> {
  const states = new Map<string, BuiltInState>();
  for (const watch of BUILT_IN_WATCHES) {
    const copy = await readOptional(join(home, WATCHES_DIR, watch.name));
    states.set(watch.name, assessBuiltIn(copy, await readTemplate(watch.template)));
  }
  return states;
}

/**
 * Writes the folder and its README when missing, and each built-in watch when it is missing or an
 * untouched copy of an older version.
 */
export async function seedWatches(home: string): Promise<void> {
  const directory = join(home, WATCHES_DIR);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(home, TEMPLATES.watchesReadme), await readTemplate(TEMPLATES.watchesReadme), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  for (const watch of BUILT_IN_WATCHES) {
    const path = join(directory, watch.name);
    const template = await readTemplate(watch.template);
    if (!assessBuiltIn(await readOptional(path), template).rewrite) continue;
    await writeFile(path, copyOf(template), "utf8");
    await chmod(path, 0o755);
  }
}
