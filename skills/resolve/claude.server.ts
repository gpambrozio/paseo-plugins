import { readFile } from "node:fs/promises";
import path from "node:path";

import { dirsUpToRepoRoot } from "./repo-root.server";
import { readSkillCandidates, type SkillDirectoryCandidate } from "./skill-directory.server";
import type { SkillEntry } from "./skill-entry";

export interface ClaudeResolveOptions {
  cwd: string;
  claudeHome: string;
}

interface InstalledPluginEntry {
  scope?: string;
  projectPath?: string;
  installPath?: string;
}

function isInside(child: string, parent: string): boolean {
  const normalizedChild = path.resolve(child);
  const normalizedParent = path.resolve(parent);
  return (
    normalizedChild === normalizedParent ||
    normalizedChild.startsWith(`${normalizedParent}${path.sep}`)
  );
}

/**
 * The plugin cache keeps every version ever fetched, so the directory listing
 * cannot tell you what is live. installed_plugins.json can: each entry names the
 * exact installPath in use. An entry with a projectPath applies only inside that
 * directory, whatever its `scope` string says — real manifests carry
 * `scope: "local"` entries that are per-project. An entry with no projectPath
 * applies everywhere.
 */
async function readInstalledPluginDirs(
  claudeHome: string,
  cwd: string,
): Promise<Array<{ pluginName: string; dir: string }>> {
  const manifestPath = path.join(claudeHome, "plugins", "installed_plugins.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return [];
  }

  const plugins = (parsed as { plugins?: Record<string, unknown> } | null)?.plugins;
  if (!plugins || typeof plugins !== "object") return [];

  const results: Array<{ pluginName: string; dir: string }> = [];
  for (const [key, value] of Object.entries(plugins)) {
    if (!Array.isArray(value)) continue;
    const pluginName = key.split("@")[0] ?? key;
    for (const entry of value as InstalledPluginEntry[]) {
      if (!entry || typeof entry.installPath !== "string") continue;
      // A projectPath scopes the entry to that directory regardless of what
      // `scope` says — real manifests carry `scope: "local"` entries that are
      // per-project. An entry with no projectPath applies everywhere.
      if (typeof entry.projectPath === "string" && !isInside(cwd, entry.projectPath)) continue;
      results.push({ pluginName, dir: path.join(entry.installPath, "skills") });
    }
  }
  return results;
}

/**
 * Precedence: the working directory, then each directory up to the repository
 * root, then personal, then plugins. Claude loads `.claude/skills` from every
 * one of those ancestors, so an agent working in a subdirectory still sees the
 * skills checked in at the repo root. Plugin skills are namespaced
 * `plugin:skill`, so in practice they never collide with the rest.
 */
export async function resolveClaudeSkills(options: ClaudeResolveOptions): Promise<SkillEntry[]> {
  const [pluginDirs, dirs] = await Promise.all([
    readInstalledPluginDirs(options.claudeHome, options.cwd),
    dirsUpToRepoRoot(options.cwd),
  ]);

  const candidates: SkillDirectoryCandidate[] = dirs.map((dir, index) => ({
    dir: path.join(dir, ".claude", "skills"),
    kind: index === 0 ? "project" : "repo",
    label: index === 0 ? "Project" : "Repository",
  }));

  candidates.push({
    dir: path.join(options.claudeHome, "skills"),
    kind: "personal",
    label: "Personal",
  });
  for (const { pluginName, dir } of pluginDirs) {
    candidates.push({
      dir,
      kind: "plugin",
      label: pluginName,
      nameFor: (name) => `${pluginName}:${name}`,
    });
  }

  return readSkillCandidates(candidates);
}
