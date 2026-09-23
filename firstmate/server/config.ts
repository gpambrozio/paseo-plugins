/**
 * The daemon's own file: `$PASEO_HOME/plugins/firstmate/config.json`. It holds
 * what handlers act on — where the home is, which agent is the first mate, and
 * the models the charter names — and nothing the board only draws.
 *
 * Read on every call rather than cached: a save from the settings screen has
 * to take effect on the next one, and the file is a few hundred bytes.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { FirstmateConfigSchema, type FirstmateConfig } from "../shared/fleet";

export function paseoHome(): string {
  return process.env.PASEO_HOME ?? join(homedir(), ".paseo");
}

export function pluginDir(): string {
  return join(paseoHome(), "plugins", "firstmate");
}

function configPath(): string {
  return join(pluginDir(), "config.json");
}

/** The home the config names, with `~` expanded; the plugin's own directory when it names none. */
export function resolveHome(config: FirstmateConfig): string {
  const configured = config.home.trim();
  if (configured === "") return join(pluginDir(), "home");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
  if (!isAbsolute(configured)) {
    throw new Error(`The first mate's home must be an absolute path, not "${configured}".`);
  }
  return resolve(configured);
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

export type FirstmateConfigPatch = { [Key in keyof FirstmateConfig]?: FirstmateConfig[Key] | undefined };

/**
 * Merges `patch` into the saved config — a field left `undefined` keeps its
 * saved value — and writes it to a temporary file that is then renamed, so a
 * crash never leaves half a file.
 */
export async function updateFirstmateConfig(patch: FirstmateConfigPatch): Promise<FirstmateConfig> {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const next = FirstmateConfigSchema.parse({ ...(await readFirstmateConfig()), ...defined });
  // Validated before it is saved, so a relative home is refused rather than stored.
  resolveHome(next);
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporary, path);
  return next;
}
