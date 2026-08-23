import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { beforeEach, describe, expect, test } from "vitest";

import {
  createListSkillsHandler,
  createReadSkillHandler,
  defaultSkillRoots,
  type SkillRoots,
} from "./skills.server";

let root: string;
let roots: SkillRoots;

function contextFor(agent: { id: string; provider: string; cwd: string } | null) {
  const handle = {
    refresh: async () => (agent ? { agent, project: null } : null),
    current: () => agent,
  };
  return { paseo: { agents: { ref: () => handle } } } as unknown as PluginHandlerContext;
}

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody for ${name}.\n`,
    "utf8",
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paseo-skills-handler-"));
  roots = {
    claudeHome: path.join(root, "claude-home"),
    codexHome: path.join(root, "codex-home"),
  };
});

describe("createListSkillsHandler", () => {
  test("lists claude skills for a claude agent", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "catchup", "Summarizes changes");
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "claude", cwd }),
    );

    expect(result.supported).toBe(true);
    expect(result.provider).toBe("claude");
    expect(result.cwd).toBe(cwd);
    expect(result.skills.map((skill) => skill.name)).toEqual(["catchup"]);
  });

  test("lists codex skills for a codex agent", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".codex", "skills"), "deploy", "Deploys the app");
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "codex", cwd }),
    );

    expect(result.skills.map((skill) => skill.name)).toEqual(["deploy"]);
  });

  test("reports an unsupported provider instead of an empty list", async () => {
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "opencode", cwd: root }),
    );

    expect(result.supported).toBe(false);
    expect(result.provider).toBe("opencode");
    expect(result.skills).toEqual([]);
  });

  test("throws when the agent cannot be found", async () => {
    const handler = createListSkillsHandler(roots);

    await expect(handler({ agentId: "missing" }, contextFor(null))).rejects.toThrow(
      /missing/,
    );
  });
});

describe("defaultSkillRoots", () => {
  test("honors CODEX_HOME", () => {
    const roots = defaultSkillRoots({ CODEX_HOME: "/custom/codex" } as NodeJS.ProcessEnv);
    expect(roots.codexHome).toBe("/custom/codex");
  });

  test("falls back to ~/.codex and always uses ~/.claude", () => {
    const roots = defaultSkillRoots({} as NodeJS.ProcessEnv);
    expect(roots.codexHome).toBe(path.join(os.homedir(), ".codex"));
    expect(roots.claudeHome).toBe(path.join(os.homedir(), ".claude"));
  });
});

describe("createReadSkillHandler", () => {
  test("returns the body for a discovered skill", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "catchup", "Summarizes changes");
    const context = contextFor({ id: "agent-1", provider: "claude", cwd });
    const listed = await createListSkillsHandler(roots)({ agentId: "agent-1" }, context);
    const skillId = listed.skills[0]!.id;

    const result = await createReadSkillHandler(roots)({ agentId: "agent-1", skillId }, context);

    expect(result.name).toBe("catchup");
    expect(result.description).toBe("Summarizes changes");
    expect(result.path).toBe(path.join(cwd, ".claude", "skills", "catchup", "SKILL.md"));
    expect(result.body).toBe("Body for catchup.\n");
  });

  test("throws for a skill id discovery does not return", async () => {
    const cwd = path.join(root, "work");
    await mkdir(cwd, { recursive: true });
    const context = contextFor({ id: "agent-1", provider: "claude", cwd });

    await expect(
      createReadSkillHandler(roots)(
        { agentId: "agent-1", skillId: "project:/etc:passwd" },
        context,
      ),
    ).rejects.toThrow(/not available/);
  });
});
