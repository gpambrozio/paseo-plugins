/**
 * The daemon's own file: `$PASEO_HOME/plugin-data/herald/config.json`. It holds
 * what the hooks act on — which events get a summary and which model writes
 * it — and nothing the app only draws.
 *
 * Read on every event rather than cached: a save from the settings screen has
 * to take effect on the next event, and the file is a few hundred bytes.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG, HeraldConfigSchema, type HeraldConfig } from "../shared/herald";
import { pluginDir } from "./data-dir";

function configPath(): string {
  return join(pluginDir(), "config.json");
}

/**
 * A missing file is the normal first run and yields the defaults. A file that
 * does not parse is reported and *also* yields the defaults: a hook that threw
 * here would silently stop announcing, which is worse than announcing with the
 * default model until the file is fixed.
 */
export async function readHeraldConfig(): Promise<HeraldConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(DEFAULT_CONFIG);
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    console.error(`[herald] ${configPath()} is not JSON, using defaults:`, error);
    return structuredClone(DEFAULT_CONFIG);
  }
  const parsed = HeraldConfigSchema.safeParse(json);
  if (!parsed.success) {
    console.error(`[herald] ${configPath()} is invalid, using defaults: ${parsed.error.message}`);
    return structuredClone(DEFAULT_CONFIG);
  }
  return parsed.data;
}

export async function writeHeraldConfig(config: HeraldConfig): Promise<HeraldConfig> {
  const parsed = HeraldConfigSchema.parse(config);
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed;
}
