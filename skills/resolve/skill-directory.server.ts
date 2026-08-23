import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseFrontmatter } from "./frontmatter";
import { makeSkillId, type SkillEntry, type SkillSourceKind } from "./skill-entry";

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
