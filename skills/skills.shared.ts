import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const SkillSourceSchema = z.object({
  kind: z.enum(["project", "personal", "plugin", "codex-home", "codex-repo"]),
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

export const listSkills = defineRpc({
  name: "skills.list",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    provider: z.string(),
    supported: z.boolean(),
    cwd: z.string().nullable(),
    skills: z.array(SkillEntrySchema),
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
