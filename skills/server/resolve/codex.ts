import path from "node:path";

import { dirsUpToRepoRoot } from "./repo-root";
import { readSkillCandidates, type SkillDirectoryCandidate } from "./skill-directory";
import type { SkillEntry } from "./skill-entry";

export interface CodexResolveOptions {
  cwd: string;
  /** `$CODEX_HOME` or `~/.codex`. Only the legacy `skills` directory is read from it. */
  codexHome: string;
  /** `~/.agents`, the documented home for user-scoped skills. */
  agentsHome: string;
  /** `/etc/codex/skills`, the admin scope. */
  adminSkillsDir: string;
}

/**
 * Follows Codex's documented search path: `.agents/skills` in every directory
 * from cwd up to the repository root, then `$HOME/.agents/skills`, then
 * `/etc/codex/skills`.
 *
 * `.codex/skills` is read alongside each `.agents/skills` and at `$CODEX_HOME`
 * because older Codex builds looked there, and Paseo before 0.11.0-beta.2
 * synced its orchestration skills there too. Paseo now writes only to
 * `~/.agents/skills` and `~/.claude/skills`, and leaves an old copy in place
 * when the user edited it. It sits second within each scope, so when a name
 * lives in both the documented directory wins.
 *
 * Codex's bundled system skills have no path on disk and stay invisible here.
 */
export async function resolveCodexSkills(options: CodexResolveOptions): Promise<SkillEntry[]> {
  const dirs = await dirsUpToRepoRoot(options.cwd);

  const candidates: SkillDirectoryCandidate[] = dirs.flatMap((dir, index) => {
    const scope =
      index === 0
        ? { kind: "project" as const, label: "Project" }
        : { kind: "repo" as const, label: "Repository" };
    return [
      { dir: path.join(dir, ".agents", "skills"), ...scope },
      { dir: path.join(dir, ".codex", "skills"), ...scope },
    ];
  });

  candidates.push(
    { dir: path.join(options.agentsHome, "skills"), kind: "personal", label: "Personal" },
    { dir: path.join(options.codexHome, "skills"), kind: "personal", label: "Personal" },
    { dir: options.adminSkillsDir, kind: "admin", label: "Admin" },
  );

  return readSkillCandidates(candidates);
}
