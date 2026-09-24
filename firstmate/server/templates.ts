/**
 * The plugin's `templates/` folder: every file the plugin writes into the first mate's home, laid out as
 * it lands there; the parts it puts inside them (`parts/`); and everything it says to the first mate
 * itself (`messages/`). They are Markdown — and the home's icon — so they can be read and changed as the
 * text they become, rather than as strings in code.
 *
 * Paseo compiles the server half into one script and runs it from memory, so the code cannot say where
 * it was loaded from: `import.meta` is empty in that bundle, the process runs in the daemon's directory,
 * and nothing in the plugin API names the plugin's. The daemon knows — `paseo plugin ls --json` lists
 * each plugin's directory, the package itself for an npm install — so the folder is found there, once per
 * process. Where the code runs from its own files, as in the tests, `import.meta.url` says it directly.
 *
 * Read once and kept for the process: a changed template reaches a home in use on the next reload.
 * HTML comments in a template are notes for whoever edits it; `withoutNotes` leaves them out where a
 * template becomes a message or a part of another file.
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pluginDirectory } from "./cli";
import { PLUGIN_ID } from "./config";

/** Every template, by the path it has under `templates/` — for a home file, the path it has in the home. */
export const TEMPLATES = {
  agents: "AGENTS.md",
  icon: "icon.svg",
  backlog: "data/backlog.md",
  captain: "data/captain.md",
  charter: "data/charter.md",
  charterNew: "data/charter.new.md",
  learnings: "data/learnings.md",
  opening: "data/opening.md",
  projects: "data/projects.md",
  crewModeChosen: "parts/crew-mode-chosen.md",
  crewModeOpen: "parts/crew-mode-open.md",
  crewProviderChosen: "parts/crew-provider-chosen.md",
  crewProviderOpen: "parts/crew-provider-open.md",
  ahoy: "messages/ahoy.md",
  ahoyArgs: "messages/ahoy-args.md",
  bearings: "messages/bearings.md",
  bearingsArgs: "messages/bearings-args.md",
  relaunch: "messages/relaunch.md",
  restartNote: "messages/restart-note.md",
  steerRelay: "messages/steer-relay.md",
  steerRelayClipped: "messages/steer-relay-clipped.md",
  steerRelayNoAnswer: "messages/steer-relay-no-answer.md",
} as const;

export type TemplatePath = (typeof TEMPLATES)[keyof typeof TEMPLATES];

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function locate(): Promise<string> {
  const url: unknown = import.meta.url;
  if (typeof url === "string" && url.startsWith("file:")) {
    const beside = join(dirname(fileURLToPath(url)), "..", "templates");
    if (await isDirectory(beside)) return beside;
  }
  const directory = join(await pluginDirectory(PLUGIN_ID), "templates");
  if (!(await isDirectory(directory))) {
    throw new Error(`FirstMate's templates are not in ${directory}. Reinstall the plugin.`);
  }
  return directory;
}

let located: Promise<string> | null = null;
const cache = new Map<string, Promise<string>>();

/** The `templates/` folder; a failed lookup is not kept, so the next call tries again. */
export function templatesDirectory(): Promise<string> {
  located ??= locate().catch((error: unknown) => {
    located = null;
    throw error;
  });
  return located;
}

/** A template's text, exactly as written. */
export function readTemplate(path: TemplatePath): Promise<string> {
  let text = cache.get(path);
  if (text === undefined) {
    text = templatesDirectory().then((directory) => readFile(join(directory, path), "utf8"));
    cache.set(path, text);
    text.catch(() => cache.delete(path));
  }
  return text;
}

/** Text without its notes — its HTML comments — and without the whitespace around it. */
export function withoutNotes(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").trim();
}

/** A template from `messages/` or `parts/`, its notes left out and its placeholders filled. */
export async function message(path: TemplatePath, values: Readonly<Record<string, string>> = {}): Promise<string> {
  return fill(withoutNotes(await readTemplate(path)), values);
}

/** `{{name}}` filled from `values` in one pass, so a value is never read for placeholders; a name it does not have is left as it is. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (whole, name: string) => values[name] ?? whole);
}
