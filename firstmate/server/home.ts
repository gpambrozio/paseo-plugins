/**
 * The first mate's home: the directory it runs in, and the only place it
 * writes. FirstMate called this the distro — a charter and a set of records
 * that turn a general-purpose agent into a first mate — and it is the same
 * here, minus the scripts.
 *
 *     <home>/AGENTS.md           the charter, rendered from data/charter.md on every launch
 *     <home>/data/charter.md     the charter's source; follows the plugin until the captain edits it
 *     <home>/data/captain.md     standing orders; the captain's, never overwritten
 *     <home>/data/projects.md    the project registry
 *     <home>/data/backlog.md     every work item; the board reads it
 *     <home>/data/suggestions.md what the captain might do next; the board's buttons
 *     <home>/data/learnings.md
 *     <home>/data/opening.md     a new first mate's first message; the captain's, never overwritten
 *     <home>/projects/           clones for projects with no local checkout
 *     <home>/icon.svg            the icon Paseo's sidebar shows for the home
 *
 * Every file starts as its namesake in the plugin's `templates/` folder, which
 * is laid out the same way (`templates.ts`). Everything but the charter is
 * written only when missing, so a relaunch never loses a record the first
 * mate has been keeping.
 *
 * The icon is Lucide's ship — the plugin's own sidebar icon, ISC-licensed — in
 * white on a blue rounded square. It is a file, not something the plugin sets:
 * Paseo looks for an icon in every project's folder on its own (`favicon.svg`,
 * `icon.svg`, `icon.png` and more, square and 32 KB at most; an SVG counts as
 * square) and shows it unless the captain uploaded one in the project's
 * settings.
 *
 * There is no `CLAUDE.md`. Claude Code and Codex both read `AGENTS.md` from
 * the working directory, and a `CLAUDE.md` importing it risks the charter
 * twice over in every turn's context; the launch prompt asks a harness that
 * reads neither to open the file itself.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BacklogItem, FirstmateConfig, Project, Suggestion } from "../shared/fleet";
import { parseBacklog } from "./backlog";
import { renderCharter } from "./charter";
import { syncCharter } from "./charter-file";
import { parseSuggestions } from "./suggestions";
import { TEMPLATES, readTemplate, withoutNotes, type TemplatePath } from "./templates";

/** The home's records: written from their templates when missing, and the captain's or the first mate's after. */
const RECORDS: readonly TemplatePath[] = [
  TEMPLATES.captain,
  TEMPLATES.projects,
  TEMPLATES.learnings,
  TEMPLATES.backlog,
  TEMPLATES.suggestions,
  TEMPLATES.opening,
  TEMPLATES.icon,
];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

/**
 * Creates whatever of the home is missing, brings `data/charter.md` in step with the plugin's charter
 * (`charter-file.ts`), and renders `AGENTS.md` from it with the current config.
 */
export async function prepareHome(home: string, config: FirstmateConfig): Promise<void> {
  await mkdir(join(home, "data"), { recursive: true });
  await mkdir(join(home, "projects"), { recursive: true });
  const charter = await syncCharter(home);
  await writeFile(
    join(home, TEMPLATES.agents),
    await renderCharter({ home, crewProvider: config.crewProvider, crewModeId: config.crewModeId }, charter.template),
    "utf8",
  );
  for (const record of RECORDS) await writeIfMissing(join(home, record), await readTemplate(record));
}

/** Whether a launch has ever prepared this home. */
export function isHomeReady(home: string): Promise<boolean> {
  return exists(join(home, TEMPLATES.agents));
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * A new first mate's first message: `data/opening.md` without its HTML comments, which are notes to the
 * captain. A missing or empty file gives the template's wording, so a first mate is never started with
 * nothing to act on.
 */
export async function readOpening(home: string): Promise<string> {
  const text = withoutNotes((await readOptional(join(home, TEMPLATES.opening))) ?? "");
  return text === "" ? withoutNotes(await readTemplate(TEMPLATES.opening)) : text;
}

export async function readBacklog(home: string): Promise<BacklogItem[]> {
  const markdown = await readOptional(join(home, "data", "backlog.md"));
  return markdown === null ? [] : parseBacklog(markdown);
}

export async function readSuggestions(home: string): Promise<Suggestion[]> {
  const markdown = await readOptional(join(home, TEMPLATES.suggestions));
  return markdown === null ? [] : parseSuggestions(markdown);
}

/**
 * `- <name> [<mode> +yolo] - <location> - <description>`, as the charter asks.
 * The line splits on ` - ` first, and only the name part is read for the
 * bracket, so a Markdown link or a `[WIP]` in the description stays text. The
 * bracket, the location and the description are each optional, and a line
 * that is not a list item is not a project.
 */
export function parseProjects(markdown: string): Project[] {
  const projects: Project[] = [];
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const item = /^\s*[-*]\s+(?!\[[ xX]\])(.+)$/.exec(line);
    if (item === null) continue;
    const [head = "", ...rest] = (item[1] ?? "").split(/\s+[-–—]\s+/).map((part) => part.trim());
    const bracket = /^(.*?)\s*\[([^\]]*)\]\s*$/.exec(head);
    const name = (bracket?.[1] ?? head).replace(/[`*]/g, "").trim();
    if (name === "" || name.startsWith("(") || /\s/.test(name)) continue;
    const flags = (bracket?.[2] ?? "").split(/\s+/).filter((flag) => flag !== "");
    const parts = rest.filter((part) => part !== "");
    projects.push({
      name,
      mode: flags.find((flag) => !flag.startsWith("+")) ?? null,
      yolo: flags.includes("+yolo"),
      location: parts[0] ?? null,
      description: parts.slice(1).join(" - ") || null,
    });
  }
  return projects;
}

export async function readProjects(home: string): Promise<Project[]> {
  const markdown = await readOptional(join(home, "data", "projects.md"));
  return markdown === null ? [] : parseProjects(markdown);
}
