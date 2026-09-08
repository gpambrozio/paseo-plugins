import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseFrontmatter } from "./frontmatter";
import { dedupeByName, makeSkillId, type SkillEntry, type SkillSourceKind } from "./skill-entry";

export interface SkillDirectoryCandidate {
  dir: string;
  kind: SkillSourceKind;
  label: string;
  /** Plugin skills are invoked as `plugin:skill`; everything else keeps its name. */
  nameFor?: (frontmatterName: string) => string;
}

/**
 * Reads a provider's whole search path. Candidates arrive in precedence order
 * and the first copy of a name wins, so a project skill shadows a personal one
 * without either being listed twice.
 *
 * The same directory can be named twice — a repository rooted at `$HOME` puts
 * `~/.claude/skills` in both the repo walk and the personal scope — so a
 * directory is read once, under the first scope that reached it.
 */
export async function readSkillCandidates(
  candidates: SkillDirectoryCandidate[],
): Promise<SkillEntry[]> {
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    const resolved = path.resolve(candidate.dir);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });

  const groups = await Promise.all(
    unique.map((candidate) =>
      readSkillsFromDirectory(candidate.dir, candidate.kind, candidate.label, candidate.nameFor),
    ),
  );
  return dedupeByName(groups.flat()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Scans one `skills` directory. Each direct child directory (or symlink to one)
 * holding a SKILL.md is a skill. A missing directory is normal, not an error.
 * An entry whose frontmatter lacks name or description is skipped, matching the
 * providers — listing it would show a skill the agent cannot actually see.
 */
export async function readSkillsFromDirectory(
  dir: string,
  kind: SkillSourceKind,
  label: string,
  nameFor: (frontmatterName: string) => string = (name) => name,
): Promise<SkillEntry[]> {
  let dirEntries;
  try {
    dirEntries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = dirEntries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
  const results = await Promise.all(
    candidates.map(async (entry): Promise<SkillEntry | null> => {
      const skillPath = path.join(dir, entry.name, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(skillPath, "utf8");
      } catch {
        return null;
      }
      const { frontmatter } = parseFrontmatter(raw);
      const rawName = frontmatter.name;
      const description = frontmatter.description;
      if (!rawName || !description) return null;
      const name = nameFor(rawName);
      const userInvocable = frontmatter["user-invocable"] !== "false";
      return {
        id: makeSkillId(kind, dir, name),
        name,
        description,
        source: { kind, label, dir },
        path: skillPath,
        userInvocable,
        status: "discovered",
      };
    }),
  );

  return results
    .filter((entry): entry is SkillEntry => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
