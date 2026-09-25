/**
 * Where this plugin keeps its own files: `$PASEO_HOME/plugin-data/model-pricing/`.
 *
 * They used to live in `$PASEO_HOME/plugins/model-pricing/`, which is also where Paseo
 * installs an npm or Git plugin, and `paseo plugin remove` deletes that
 * directory whole. Paseo never touches `plugin-data/`. `migrateLegacyData`
 * carries the files over by name — never the directory itself, which on a
 * managed install also holds Paseo's version directories.
 *
 * Every plugin in this repository carries its own copy of this module.
 */
import { randomUUID } from "node:crypto";
import { cpSync, linkSync, lstatSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PLUGIN_ID = "model-pricing";

export function paseoHome(): string {
  return process.env["PASEO_HOME"] ?? join(homedir(), ".paseo");
}

export function pluginDir(): string {
  return join(paseoHome(), "plugin-data", PLUGIN_ID);
}

/** Where the files used to live; read only to move them out. */
export function legacyPluginDir(): string {
  return join(paseoHome(), "plugins", PLUGIN_ID);
}

/**
 * Where one entry is read and written: the new directory when it has it or
 * when neither does, the legacy one when only that has it — which is only
 * after its move failed. So the copy in use is always the one the next start
 * keeps: a file both have is served from the new place, whose copy wins, and
 * a file whose move failed is edited where it is and carried over next time,
 * edits and all.
 */
export function dataPath(entry: string): string {
  const current = join(pluginDir(), entry);
  const legacy = join(legacyPluginDir(), entry);
  return !exists(current) && exists(legacy) ? legacy : current;
}

/**
 * - `moved`: it was only in the legacy directory, and now it is only in the new one.
 * - `absent`: the legacy directory does not have it.
 * - `kept`: both have it; the new one wins and the legacy copy is left alone.
 * - `failed`: logged, and the legacy copy is where it was, to be tried again on the next start.
 */
export type MigrationOutcome = "moved" | "absent" | "kept" | "failed";

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/**
 * Moves each named entry — a file or a directory, or a path inside one — from
 * the legacy directory into the new one, unless the new one already has it.
 * One entry failing does not stop the others; `dataPath` serves it from where
 * it is until a later start moves it.
 *
 * A file is hard-linked into place and then unlinked from the old place: the
 * link refuses to replace a file that appeared in the meantime, so a writer
 * racing the move is never overwritten. Across filesystems, a copy under a
 * temporary name is linked into place the same way. A directory is renamed.
 *
 * Synchronous on purpose: the server entry calls it before binding a handler,
 * so no handler writes during the move.
 */
export function migrateLegacyData(entries: readonly string[]): Record<string, MigrationOutcome> {
  const outcomes: Record<string, MigrationOutcome> = {};
  for (const entry of entries) {
    outcomes[entry] = migrateEntry(join(legacyPluginDir(), entry), join(pluginDir(), entry));
  }
  return outcomes;
}

function migrateEntry(from: string, to: string): MigrationOutcome {
  try {
    if (!exists(from)) return "absent";
    if (exists(to)) return "kept";
    mkdirSync(dirname(to), { recursive: true });
    const moved = lstatSync(from).isDirectory() ? moveDirectory(from, to) : moveFile(from, to);
    if (!moved) return "kept";
    console.log(`[${PLUGIN_ID}] moved ${from} to ${to}`);
    return "moved";
  } catch (error) {
    console.error(`[${PLUGIN_ID}] could not move ${from} to ${to}; it stays where it is:`, error);
    return "failed";
  }
}

/** False when `to` appeared before the link could land; `from` is then untouched. */
function moveFile(from: string, to: string): boolean {
  try {
    linkSync(from, to);
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    if (errorCode(error) !== "EXDEV") throw error;
    const temporary = `${to}.${randomUUID()}.tmp`;
    try {
      cpSync(from, temporary, { errorOnExist: true, force: false, preserveTimestamps: true });
      linkSync(temporary, to);
    } catch (copyError) {
      if (errorCode(copyError) === "EEXIST") return false;
      throw copyError;
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  removeOriginal(from, to);
  return true;
}

function moveDirectory(from: string, to: string): boolean {
  try {
    renameSync(from, to);
    return true;
  } catch (error) {
    if (errorCode(error) !== "EXDEV") throw error;
  }
  const temporary = `${to}.${randomUUID()}.tmp`;
  try {
    cpSync(from, temporary, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true });
    if (exists(to)) return false;
    renameSync(temporary, to);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  removeOriginal(from, to);
  return true;
}

function removeOriginal(from: string, to: string): void {
  try {
    rmSync(from, { recursive: true, force: true });
  } catch (error) {
    // Both copies exist now, and the new one wins from here on.
    console.error(`[${PLUGIN_ID}] moved ${from} to ${to} but could not remove the original:`, error);
  }
}
