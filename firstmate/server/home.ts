/**
 * The first mate's home: the directory it runs in, and the only place it
 * writes. FirstMate called this the distro — a charter and a set of records
 * that turn a general-purpose agent into a first mate — and it is the same
 * here, minus the scripts.
 *
 *     <home>/AGENTS.md          the charter, rewritten on every launch
 *     <home>/data/captain.md    standing orders; the captain's, never overwritten
 *     <home>/data/projects.md   the project registry
 *     <home>/data/backlog.md    every work item; the board reads it
 *     <home>/data/learnings.md
 *     <home>/projects/          clones for projects with no local checkout
 *
 * Everything but the charter is written only when missing, so a relaunch
 * never loses a record the first mate has been keeping.
 *
 * There is no `CLAUDE.md`. Claude Code and Codex both read `AGENTS.md` from
 * the working directory, and a `CLAUDE.md` importing it risks the charter
 * twice over in every turn's context; the launch prompt asks a harness that
 * reads neither to open the file itself.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BacklogItem, FirstmateConfig, Project } from "../shared/fleet";
import { EMPTY_BACKLOG, parseBacklog } from "./backlog";
import {
  CAPTAIN_TEMPLATE,
  LEARNINGS_TEMPLATE,
  PROJECTS_TEMPLATE,
  renderCharter,
} from "./charter";

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

/** Creates whatever of the home is missing and rewrites the charter from the current config. */
export async function prepareHome(home: string, config: FirstmateConfig): Promise<void> {
  await mkdir(join(home, "data"), { recursive: true });
  await mkdir(join(home, "projects"), { recursive: true });
  await writeFile(
    join(home, "AGENTS.md"),
    renderCharter({ home, crewProvider: config.crewProvider, crewModeId: config.crewModeId }),
    "utf8",
  );
  await writeIfMissing(join(home, "data", "captain.md"), CAPTAIN_TEMPLATE);
  await writeIfMissing(join(home, "data", "projects.md"), PROJECTS_TEMPLATE);
  await writeIfMissing(join(home, "data", "learnings.md"), LEARNINGS_TEMPLATE);
  await writeIfMissing(join(home, "data", "backlog.md"), EMPTY_BACKLOG);
}

/** Whether a launch has ever prepared this home. */
export function isHomeReady(home: string): Promise<boolean> {
  return exists(join(home, "AGENTS.md"));
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readBacklog(home: string): Promise<BacklogItem[]> {
  const markdown = await readOptional(join(home, "data", "backlog.md"));
  return markdown === null ? [] : parseBacklog(markdown);
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
