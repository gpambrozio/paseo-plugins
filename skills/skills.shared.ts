import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const SkillSourceSchema = z.object({
  // Must stay in step with SkillSourceKind in resolve/skill-entry.ts — a
  // mismatch fails zod validation at runtime, not at compile time.
  kind: z.enum(["project", "repo", "personal", "admin", "plugin"]),
  label: z.string(),
  dir: z.string(),
});

export const SkillEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source: SkillSourceSchema,
  path: z.string(),
  userInvocable: z.boolean(),
  status: z.enum(["discovered"]),
});

export const ReportedSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string(),
});

/**
 * What the live session says it can run, minus everything discovery already
 * found, split on the provider's own `kind`. `available: false` means the daemon
 * predates `agent.commands()`, which is not an error — the panel simply omits
 * both sections.
 */
export const ReportedSkillsSchema = z.object({
  available: z.boolean(),
  error: z.string().nullable(),
  skills: z.array(ReportedSkillSchema),
  commands: z.array(ReportedSkillSchema),
});

export const listSkills = defineRpc({
  name: "skills.list",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    provider: z.string(),
    /**
     * Whether filesystem discovery ran for this provider — not whether the panel
     * has anything to show. Every provider that answers `agent.commands()` gets a
     * reported section regardless.
     */
    scanned: z.boolean(),
    cwd: z.string().nullable(),
    skills: z.array(SkillEntrySchema),
    reported: ReportedSkillsSchema,
  }),
});

export const readSkill = defineRpc({
  name: "skills.read",
  input: z.object({ agentId: z.string(), skillId: z.string() }),
  output: z.object({
    name: z.string(),
    description: z.string(),
    path: z.string(),
    body: z.string(),
  }),
});
