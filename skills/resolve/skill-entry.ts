export type SkillSourceKind = "project" | "personal" | "plugin" | "codex-home" | "codex-repo";

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
