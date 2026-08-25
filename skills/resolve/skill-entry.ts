/**
 * Scopes, not directories. Both providers scan several directories per scope —
 * Codex reads `.agents/skills` and legacy `.codex/skills` in the same walk — so
 * a kind names where a skill applies, and `SkillSource.dir` names where it is.
 */
export type SkillSourceKind = "project" | "repo" | "personal" | "admin" | "plugin";

export interface SkillSource {
  kind: SkillSourceKind;
  label: string;
  dir: string;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  userInvocable: boolean;
  status: "discovered";
}

export function makeSkillId(kind: SkillSourceKind, dir: string, name: string): string {
  return `${kind}:${dir}:${name}`;
}

/**
 * First name wins. Callers pass directories in precedence order, so a project
 * skill shadows a personal one of the same name without either being reported
 * twice.
 */
export function dedupeByName(entries: SkillEntry[]): SkillEntry[] {
  const byName = new Map<string, SkillEntry>();
  for (const entry of entries) {
    if (!byName.has(entry.name)) byName.set(entry.name, entry);
  }
  return [...byName.values()];
}
