import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PluginHandlerContext } from "@getpaseo/plugin/server";

import { parseFrontmatter } from "./resolve/frontmatter";
import { resolveClaudeSkills } from "./resolve/claude.server";
import { resolveCodexSkills } from "./resolve/codex.server";
import type { SkillEntry } from "./resolve/skill-entry";

export interface SkillRoots {
  claudeHome: string;
  codexHome: string;
}

export function defaultSkillRoots(env: NodeJS.ProcessEnv = process.env): SkillRoots {
  const home = os.homedir();
  return {
    claudeHome: path.join(home, ".claude"),
    codexHome: env.CODEX_HOME ?? path.join(home, ".codex"),
  };
}

interface ResolvedAgent {
  provider: string;
  cwd: string;
}

async function loadAgent(agentId: string, context: PluginHandlerContext): Promise<ResolvedAgent> {
  const handle = context.paseo.agents.ref(agentId);
  const refreshed = await handle.refresh();
  const agent = refreshed?.agent ?? handle.current();
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return { provider: agent.provider, cwd: agent.cwd };
}

async function resolveForAgent(agent: ResolvedAgent, roots: SkillRoots): Promise<SkillEntry[]> {
  if (agent.provider === "claude") {
    return resolveClaudeSkills({ cwd: agent.cwd, claudeHome: roots.claudeHome });
  }
  if (agent.provider === "codex") {
    return resolveCodexSkills({ cwd: agent.cwd, codexHome: roots.codexHome });
  }
  return [];
}

function isSupported(provider: string): boolean {
  return provider === "claude" || provider === "codex";
}

export function createListSkillsHandler(roots: SkillRoots = defaultSkillRoots()) {
  return async (input: { agentId: string }, context: PluginHandlerContext) => {
    const agent = await loadAgent(input.agentId, context);
    return {
      provider: agent.provider,
      supported: isSupported(agent.provider),
      cwd: agent.cwd,
      skills: await resolveForAgent(agent, roots),
    };
  };
}

/**
 * Takes a skill id, never a path. Discovery runs again and the id is looked up
 * in its result, so the only readable files are ones discovery already found.
 */
export function createReadSkillHandler(roots: SkillRoots = defaultSkillRoots()) {
  return async (input: { agentId: string; skillId: string }, context: PluginHandlerContext) => {
    const agent = await loadAgent(input.agentId, context);
    const skills = await resolveForAgent(agent, roots);
    const skill = skills.find((entry) => entry.id === input.skillId);
    if (!skill) {
      throw new Error(`Skill not available: ${input.skillId}`);
    }
    const raw = await readFile(skill.path, "utf8");
    return {
      name: skill.name,
      description: skill.description,
      path: skill.path,
      body: parseFrontmatter(raw).body,
    };
  };
}
