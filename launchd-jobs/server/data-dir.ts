/**
 * Where this plugin keeps its own files: `$PASEO_HOME/plugin-data/launchd-jobs/`.
 *
 * They used to live in `$PASEO_HOME/plugins/launchd-jobs/`, which is also where Paseo
 * installs an npm or Git plugin, and `paseo plugin remove` deletes that
 * directory whole. Paseo never touches `plugin-data/`. `migrateLegacyData`
 * carries the files over by name — never the directory itself, which on a
 * managed install also holds Paseo's version directories.
 *
 * Every plugin in this repository carries its own copy of this module.
 */
import { randomUUID } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PLUGIN_ID = "launchd-jobs";

export function paseoHome(): string {
  return process.env.PASEO_HOME ?? join(homedir(), ".paseo");
}

export function pluginDir(): string {
  return join(paseoHome(), "plugin-data", PLUGIN_ID);
}

/** Where the files used to live; read only to move them out. */
export function legacyPluginDir(): string {
  return join(paseoHome(), "plugins", PLUGIN_ID);
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Moves each named entry — a file or a directory — from the legacy directory
 * into the new one, unless the new one already has it.
 *
 * A rename first. Across filesystems, a copy to a temporary name that is then
 * renamed into place, so a half-finished copy never looks like migrated data,
 * and the legacy copy is removed only once the new one is whole.
 *
 * Synchronous on purpose: the server entry calls it before binding a handler,
 * so no handler can write a fresh file into the new directory first and make
 * the user's real one look superseded.
 */
export function migrateLegacyData(entries: readonly string[]): Record<string, MigrationOutcome> {
  const outcomes: Record<string, MigrationOutcome> = {};
  for (const entry of entries) outcomes[entry] = migrateEntry(entry);
  return outcomes;
}

function migrateEntry(entry: string): MigrationOutcome {
  const from = join(legacyPluginDir(), entry);
  const to = join(pluginDir(), entry);
  try {
    if (!exists(from)) return "absent";
    if (exists(to)) return "kept";
    mkdirSync(pluginDir(), { recursive: true });
    try {
      renameSync(from, to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      copyAcross(from, to);
    }
    console.log(`[${PLUGIN_ID}] moved ${from} to ${to}`);
    return "moved";
  } catch (error) {
    console.error(`[${PLUGIN_ID}] could not move ${from} to ${to}; it stays where it is:`, error);
    return "failed";
  }
}

function copyAcross(from: string, to: string): void {
  const temporary = `${to}.${randomUUID()}.tmp`;
  try {
    cpSync(from, temporary, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true });
    renameSync(temporary, to);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  try {
    rmSync(from, { recursive: true, force: true });
  } catch (error) {
    // Both copies exist now, and the new one wins from here on.
    console.error(`[${PLUGIN_ID}] copied ${from} to ${to} but could not remove the original:`, error);
  }
}
