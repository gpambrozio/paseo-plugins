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

type CommandsFn = () => Promise<{
  commands: Array<{
    name: string;
    description: string;
    argumentHint: string;
    kind?: "command" | "skill";
  }>;
  error: string | null;
}>;

function contextFor(
  agent: { id: string; provider: string; cwd: string } | null,
  commands?: CommandsFn,
) {
  const handle = {
    refresh: async () => (agent ? { agent, project: null } : null),
    current: () => agent,
    // Omitted entirely when no stub is given, standing in for a daemon that
    // predates agent.commands().
    ...(commands ? { commands } : {}),
  };
  return { paseo: { agents: { ref: () => handle } } } as unknown as PluginHandlerContext;
}

function reports(
  ...commands: Array<{
    name: string;
    description?: string;
    argumentHint?: string;
    kind?: "command" | "skill";
  }>
): CommandsFn {
  return async () => ({
    commands: commands.map((command) => ({
      description: `Description for ${command.name}`,
      argumentHint: "",
      ...command,
    })),
    error: null,
  });
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
    agentsHome: path.join(root, "agents-home"),
    adminSkillsDir: path.join(root, "etc", "codex", "skills"),
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
    await writeSkill(path.join(cwd, ".agents", "skills"), "deploy", "Deploys the app");
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

  test("reports session skills that discovery did not find", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "catchup", "Summarizes changes");
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor(
        { id: "agent-1", provider: "claude", cwd },
        reports(
          { name: "catchup", kind: "skill" },
          { name: "dataviz", kind: "skill" },
          { name: "usage", kind: "command" },
        ),
      ),
    );

    expect(result.skills.map((skill) => skill.name)).toEqual(["catchup"]);
    expect(result.reported).toEqual({
      available: true,
      error: null,
      skills: [{ name: "dataviz", description: "Description for dataviz", argumentHint: "" }],
      commands: [{ name: "usage", description: "Description for usage", argumentHint: "" }],
    });
  });

  test("marks the section unavailable on a daemon without commands()", async () => {
    const cwd = path.join(root, "work");
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "claude", cwd }),
    );

    expect(result.reported).toEqual({
      available: false,
      error: null,
      skills: [],
      commands: [],
    });
  });

  test("keeps the discovered list when the session cannot answer", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "catchup", "Summarizes changes");
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "claude", cwd }, async () => {
        throw new Error("session is not running");
      }),
    );

    expect(result.skills.map((skill) => skill.name)).toEqual(["catchup"]);
    expect(result.reported).toEqual({
      available: true,
      error: "session is not running",
      skills: [],
      commands: [],
    });
  });

  test("passes through an error the provider reported itself", async () => {
    const cwd = path.join(root, "work");
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "claude", cwd }, async () => ({
        commands: [],
        error: "provider timed out",
      })),
    );

    expect(result.reported.error).toBe("provider timed out");
  });

  test("reports session skills for a provider discovery does not support", async () => {
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor(
        { id: "agent-1", provider: "opencode", cwd: root },
        reports({ name: "explain", kind: "skill" }),
      ),
    );

    expect(result.supported).toBe(false);
    expect(result.skills).toEqual([]);
    expect(result.reported.skills.map((skill) => skill.name)).toEqual(["explain"]);
  });
});

describe("defaultSkillRoots", () => {
  test("honors CODEX_HOME", () => {
    const roots = defaultSkillRoots({ CODEX_HOME: "/custom/codex" } as NodeJS.ProcessEnv);
    expect(roots.codexHome).toBe("/custom/codex");
  });

  test("falls back to ~/.codex and always uses ~/.claude and ~/.agents", () => {
    const roots = defaultSkillRoots({} as NodeJS.ProcessEnv);
    expect(roots.codexHome).toBe(path.join(os.homedir(), ".codex"));
    expect(roots.claudeHome).toBe(path.join(os.homedir(), ".claude"));
    expect(roots.agentsHome).toBe(path.join(os.homedir(), ".agents"));
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
