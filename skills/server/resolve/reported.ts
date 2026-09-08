/**
 * The session's own view of what it can run, as reported by the provider rather
 * than found on disk. This is the only way to see skills bundled inside an agent
 * binary, which live on no scannable path.
 *
 * Deliberately free of Node imports and of any `@getpaseo/client` type, so it
 * compiles into either bundle and does not depend on the daemon's SDK version.
 */

export interface ReportedCommand {
  name: string;
  description: string;
  argumentHint: string;
  kind?: "command" | "skill";
}

export interface ReportedSkill {
  name: string;
  description: string;
  argumentHint: string;
}

export interface CommandsResult {
  commands: ReportedCommand[];
  error: string | null;
}

interface CommandsCapableHandle {
  commands(): Promise<CommandsResult>;
}

/**
 * The `paseo` object comes from the daemon's bundled client, not from this
 * project's node_modules, so the method may be absent no matter what the types
 * say. Structural detection keeps the plugin working on a daemon that predates
 * `agent.commands()` instead of throwing at runtime.
 */
export function supportsCommands(handle: unknown): handle is CommandsCapableHandle {
  return typeof (handle as Partial<CommandsCapableHandle> | null)?.commands === "function";
}

export interface ReportedSplit {
  skills: ReportedSkill[];
  commands: ReportedSkill[];
}

/**
 * Reported entries that filesystem discovery did not already find, split into
 * skills and session controls on the `kind` the provider assigned.
 *
 * `kind` is optional and is the provider's own judgement, not ground truth.
 * Claude derives it from a hardcoded denylist of root-only commands and calls
 * everything else a skill, so plenty of session controls land in the skills
 * bucket. There is no better signal available: Claude's built-ins are compiled
 * into its binary, so nothing on disk can confirm the split.
 *
 * An entry with no `kind` counts as a skill. Bucketing unclassified entries as
 * commands would empty the skills section for any provider that omits the field.
 */
export function selectReported(
  commands: readonly ReportedCommand[],
  discoveredNames: readonly string[],
): ReportedSplit {
  const seen = new Set(discoveredNames);
  const split: ReportedSplit = { skills: [], commands: [] };
  for (const command of commands) {
    if (seen.has(command.name)) continue;
    seen.add(command.name);
    const bucket = command.kind === "command" ? split.commands : split.skills;
    bucket.push({
      name: command.name,
      description: command.description,
      argumentHint: command.argumentHint,
    });
  }
  const byName = (a: ReportedSkill, b: ReportedSkill) => a.name.localeCompare(b.name);
  split.skills.sort(byName);
  split.commands.sort(byName);
  return split;
}
