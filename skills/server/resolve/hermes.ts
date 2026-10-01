import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { readSkillCandidates, type SkillDirectoryCandidate } from "./skill-directory";
import type { SkillEntry } from "./skill-entry";

export interface HermesResolveOptions {
  /**
   * `$HERMES_HOME` or `~/.hermes`. Which profile a Hermes agent runs with
   * decides where its skills are, and nothing the plugin can see says which
   * profile an agent uses — the plugin subprocess reads the environment the
   * daemon passed it, not a provider's `env`. The resolver reads the home an
   * unprofiled `hermes acp` reads, the common case for a Paseo-launched agent;
   * `HERMES_HOME` moves it only when the daemon itself was started with that
   * variable in its environment. See design.md for the limitation.
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
 * mirrors: `_org/<org>/` loads only for the org named by the
 * `skills/_org/.active_org` marker, which Hermes's `read_active_org_id()`
 * reads back. The marker and mirror layout are deliberately out of scope
 * here — an intentional omission rather than an impossibility — so the
 * resolver lists no org skills rather than half-supporting them.
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

  // The predicate rides every candidate, not only the category walk: an
  // excluded name can appear as a child of the skills directory itself or of
  // any category, and `readSkillCandidates` reads children unfiltered unless
  // the candidate carries `includeEntry`.
  const notExcluded = (name: string): boolean =>
    !EXCLUDED_DIRS.has(name) && name !== ORG_MIRROR_DIR;

  const candidates: SkillDirectoryCandidate[] = [
    { dir: skillsDir, kind: "personal", label: "Personal", includeEntry: notExcluded },
    ...categories.map((entry) => ({
      dir: path.join(skillsDir, entry.name),
      kind: "personal" as const,
      label: "Personal",
      includeEntry: notExcluded,
    })),
  ];

  return readSkillCandidates(candidates);
}
