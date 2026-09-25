/**
 * The daemon's own file: `$PASEO_HOME/plugin-data/firstmate/config.json`. It
 * holds what handlers act on — where the home is, which agent is the first
 * mate, and the models the charter names — and nothing the board only draws.
 *
 * Read on every call rather than cached: a save from the settings screen has
 * to take effect on the next one, and the file is a few hundred bytes.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { FirstmateConfigSchema, type FirstmateConfig } from "../shared/fleet";
import { dataPath, legacyPluginDir, migrateLegacyData } from "./data-dir";
import { serialized } from "./serialize";

function configPath(): string {
  return dataPath("config.json");
}

/**
 * The home when the config names none: `plugin-data/firstmate/home`, or the
 * one under `plugins/firstmate/` for as long as `migrateLegacyFiles` has had
 * to leave it there (`dataPath`).
 */
export function defaultHome(): string {
  return dataPath("home");
}

/** The home the config names, with `~` expanded; `defaultHome()` when it names none. */
export function resolveHome(config: FirstmateConfig): string {
  const configured = config.home.trim();
  if (configured === "") return defaultHome();
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
  if (!isAbsolute(configured)) {
    throw new Error(`The first mate's home must be an absolute path, not "${configured}".`);
  }
  return resolve(configured);
}

/**
 * Moves the config out of `plugins/firstmate/`, and the old default home with
 * it when nothing depends on where that home is. Called by the server entry
 * before any handler is bound; an entry whose move fails is used where it is
 * (`dataPath`) and tried again on the next start.
 *
 * A home that has to stay is used where it is — `defaultHome()` finds it, or
 * the config names it — and the reason is logged on every start until it can go.
 */
export function migrateLegacyFiles(): void {
  const entries = ["config.json"];
  const legacyHome = join(legacyPluginDir(), "home");
  if (existsSync(legacyHome)) {
    const reason = legacyHomeMustStay(legacyHome);
    if (reason === null) entries.push("home");
    else console.warn(`[firstmate] leaving the first mate's home at ${legacyHome}: ${reason}`);
  }
  migrateLegacyData(entries);
}

/**
 * Why the legacy home cannot move yet, or null when it can. A first mate
 * works in the directory it was launched in, a home the settings name by path
 * is the captain's choice, and a clone under `projects/` is a Paseo project,
 * and the first mate's registry, by its absolute path.
 */
function legacyHomeMustStay(legacyHome: string): string | null {
  const config = readConfigSync();
  if (config === null) return "its config could not be read, so whether a first mate is aboard is unknown";
  if (config.home.trim() === "") {
    if (config.mateAgentId !== "") {
      return "a first mate is aboard in it; it moves on the first start after the first mate is released";
    }
  } else if (namesDirectory(config, legacyHome)) {
    return "the settings name it as the home; choose another there to move it";
  }
  let clones: string[];
  try {
    clones = readdirSync(join(legacyHome, "projects")).filter((name) => !name.startsWith("."));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    clones = [];
  }
  if (clones.length > 0) {
    return `projects/ holds clones Paseo knows by path (${clones.join(", ")}); to move it, move it by hand and name the new place as the home in the settings`;
  }
  return null;
}

/** Whether the home the config names is `directory`; a home it cannot resolve is not. */
function namesDirectory(config: FirstmateConfig, directory: string): boolean {
  try {
    return resolveHome(config) === resolve(directory);
  } catch {
    return false;
  }
}

function parseConfig(raw: string): FirstmateConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    console.error(`[firstmate] ${configPath()} is not JSON, using defaults:`, error);
    return FirstmateConfigSchema.parse({});
  }
  const parsed = FirstmateConfigSchema.safeParse(json);
  if (!parsed.success) {
    console.error(`[firstmate] ${configPath()} is invalid, using defaults: ${parsed.error.message}`);
    return FirstmateConfigSchema.parse({});
  }
  return parsed.data;
}

/**
 * The saved config — from the legacy directory too, since this runs before the
 * move; null when it cannot be read at all, the defaults when there is none.
 */
function readConfigSync(): FirstmateConfig | null {
  const path = configPath();
  if (!existsSync(path)) return FirstmateConfigSchema.parse({});
  try {
    return parseConfig(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`[firstmate] could not read ${path}:`, error);
    return null;
  }
}

/**
 * A missing file is the normal first run and yields the defaults. A file that
 * does not parse is reported and *also* yields the defaults, rather than
 * leaving the board unable to load at all.
 */
export async function readFirstmateConfig(): Promise<FirstmateConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return FirstmateConfigSchema.parse({});
    throw error;
  }
  return parseConfig(raw);
}

export type FirstmateConfigPatch = { [Key in keyof FirstmateConfig]?: FirstmateConfig[Key] | undefined };

/**
 * Merges `patch` into the saved config — a field left `undefined` keeps its
 * saved value — and writes it to a temporary file that is then renamed, so a
 * crash never leaves half a file. Updates run one at a time, so a settings
 * save landing during a launch cannot write back a config without the launch's
 * `mateAgentId`.
 */
export function updateFirstmateConfig(patch: FirstmateConfigPatch): Promise<FirstmateConfig> {
  return serialized(configPath(), () => applyConfigPatch(patch));
}

async function applyConfigPatch(patch: FirstmateConfigPatch): Promise<FirstmateConfig> {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const previous = await readFirstmateConfig();
  const next = FirstmateConfigSchema.parse({ ...previous, ...defined });
  // Validated before it is saved, so a relative home is refused rather than stored.
  const home = resolveHome(next);
  // The board reads the home the config names, and a running first mate keeps
  // writing the one it was launched in; moving it under one would show an
  // empty backlog while the real one carried on out of sight.
  if (next.mateAgentId !== "" && home !== resolveHome(previous)) {
    throw new Error("Release the first mate before moving its home; it keeps working in the one it was launched in.");
  }
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporary, path);
  return next;
}
