import path from "node:path";

import { findRepoRoot } from "./repo-root.server";
import { readSkillsFromDirectory } from "./skill-directory.server";
import { dedupeByName, type SkillEntry } from "./skill-entry";

export interface CodexResolveOptions {
  cwd: string;
  codexHome: string;
}

/**
 * Mirrors Paseo's own listCodexSkills so this panel and the composer agree.
 * Directories are searched in precedence order and the first name wins.
 */
export async function resolveCodexSkills(options: CodexResolveOptions): Promise<SkillEntry[]> {
  const repoRoot = await findRepoRoot(options.cwd);
  const groups: Array<Promise<SkillEntry[]>> = [
    readSkillsFromDirectory(path.join(options.cwd, ".codex", "skills"), "project", "Project"),
  ];

  if (repoRoot) {
    groups.push(
      readSkillsFromDirectory(
        path.join(path.dirname(options.cwd), ".codex", "skills"),
        "codex-repo",
        "Repository",
      ),
      readSkillsFromDirectory(path.join(repoRoot, ".codex", "skills"), "codex-repo", "Repository"),
    );
  }

  groups.push(
    readSkillsFromDirectory(path.join(options.codexHome, "skills"), "codex-home", "Codex home"),
  );

  const resolved = await Promise.all(groups);
  return dedupeByName(resolved.flat()).sort((a, b) => a.name.localeCompare(b.name));
}
