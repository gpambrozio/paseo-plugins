import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { readSkillCandidates, type SkillDirectoryCandidate } from "./skill-directory";
import type { SkillEntry } from "./skill-entry";

export interface HermesResolveOptions {
  /**
   * `$HERMES_HOME` or `~/.hermes`. The live agent's profile decides where its
   * skills are, and a daemon-side plugin cannot see which profile the agent
   * runs with, so this is the home an unprofiled `hermes acp` reads — the
   * common case for a Paseo-launched agent. A daemon that wants a profile's
   * skills sets `HERMES_HOME` in the provider's `env`.
   */
  hermesHome: string;
}

/**
 * Hermes prunes these from its own walk wherever they appear, so the plugin
 * must too or the panel lists skills Hermes cannot load: `.archive` holds
 * skills the curator retired, `.hub` the skill manager's working area, and
 * the rest are environment directories that can hold a stray `SKILL.md`
 * without being skills.
 */
const EXCLUDED_DIRS = new Set([
  ".git",
  ".github",
  ".hub",
  ".archive",
  ".curator_backups",
  ".locks",
  ".venv",
  "venv",
  "node_modules",
  "site-packages",
  "__pycache__",
  ".tox",
  ".nox",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
]);

/**
 * Hermes also walks an `_org` directory of token-gated organization skill
 * mirrors, which load only for the org whose marker the sync client wrote.
 * Whether a mirror is active is not visible from the filesystem, so the
 * plugin reads none of them rather than listing skills that may not load.
 */
const ORG_MIRROR_DIR = "_org";

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/**
 * Hermes keeps skills in `<home>/skills`, one level deeper than Claude or
 * Codex when categories are in use: `skills/<skill>/SKILL.md` and
 * `skills/<category>/<skill>/SKILL.md` are both real. The bundled install
 * ships its skills inside categories; flat entries come from user and
 * cross-agent installs, whose skill folders may be symlinks into `~/.agents`.
 *
 * A direct child is a category when it holds no `SKILL.md` of its own; the
 * test is file existence rather than a parse, because a `SKILL.md` that fails
 * frontmatter still marks its folder as a skill, not a container of skills.
 * `EXCLUDED_DIRS` and `_org` are never treated as categories. Nothing below
 * the second level is read.
 */
export async function resolveHermesSkills(options: HermesResolveOptions): Promise<SkillEntry[]> {
  const skillsDir = path.join(options.hermesHome, "skills");

  let dirEntries;
  try {
    dirEntries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return []; // An absent skills directory is the normal case, not an error.
  }

  const children = dirEntries.filter(
    (entry) =>
      (entry.isDirectory() || entry.isSymbolicLink()) &&
      !EXCLUDED_DIRS.has(entry.name) &&
      entry.name !== ORG_MIRROR_DIR,
  );
  const holdsSkillMd = await Promise.all(
    children.map((entry) => isFile(path.join(skillsDir, entry.name, "SKILL.md"))),
  );
  const categories = children.filter((_, index) => !holdsSkillMd[index]);

  const candidates: SkillDirectoryCandidate[] = [
    { dir: skillsDir, kind: "personal", label: "Personal" },
    ...categories.map((entry) => ({
      dir: path.join(skillsDir, entry.name),
      kind: "personal" as const,
      label: "Personal",
    })),
  ];

  return readSkillCandidates(candidates);
}
