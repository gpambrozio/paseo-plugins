import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { resolveCodexSkills } from "./codex.server";

let root: string;

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody for ${name}.\n`,
    "utf8",
  );
}

/** Every root outside cwd points into the temp dir, so nothing reads the real home. */
function resolve(cwd: string) {
  return resolveCodexSkills({
    cwd,
    codexHome: path.join(root, "codex-home"),
    agentsHome: path.join(root, "agents-home"),
    adminSkillsDir: path.join(root, "etc", "codex", "skills"),
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paseo-skills-codex-"));
});

describe("resolveCodexSkills", () => {
  test("finds a skill in the working directory", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".agents", "skills"), "deploy", "Deploys the app");

    const skills = await resolve(cwd);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("deploy");
    expect(skills[0]?.description).toBe("Deploys the app");
    expect(skills[0]?.source.kind).toBe("project");
    expect(skills[0]?.path).toBe(path.join(cwd, ".agents", "skills", "deploy", "SKILL.md"));
    expect(skills[0]?.status).toBe("discovered");
  });

  test("still finds a skill in the legacy .codex directory", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".codex", "skills"), "deploy", "Deploys the app");

    const skills = await resolve(cwd);

    expect(skills.map((skill) => skill.name)).toEqual(["deploy"]);
    expect(skills[0]?.source.kind).toBe("project");
  });

  test(".agents wins a name collision with .codex in the same directory", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".agents", "skills"), "deploy", "Documented version");
    await writeSkill(path.join(cwd, ".codex", "skills"), "deploy", "Legacy version");

    const skills = await resolve(cwd);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("Documented version");
  });

  test("finds a skill in the user's ~/.agents/skills", async () => {
    const cwd = path.join(root, "work");
    await mkdir(cwd, { recursive: true });
    await writeSkill(path.join(root, "agents-home", "skills"), "review", "Reviews code");

    const skills = await resolve(cwd);

    expect(skills.map((skill) => skill.name)).toEqual(["review"]);
    expect(skills[0]?.source.kind).toBe("personal");
    expect(skills[0]?.source.label).toBe("Personal");
  });

  test("finds a skill in the codex home directory", async () => {
    const cwd = path.join(root, "work");
    await mkdir(cwd, { recursive: true });
    await writeSkill(path.join(root, "codex-home", "skills"), "review", "Reviews code");

    const skills = await resolve(cwd);

    expect(skills.map((skill) => skill.name)).toEqual(["review"]);
    expect(skills[0]?.source.kind).toBe("personal");
  });

  test("lists a Paseo skill once when the sync wrote it to both agent homes", async () => {
    const cwd = path.join(root, "work");
    await mkdir(cwd, { recursive: true });
    await writeSkill(path.join(root, "agents-home", "skills"), "paseo", "Operates Paseo");
    await writeSkill(path.join(root, "codex-home", "skills"), "paseo", "Operates Paseo");

    const skills = await resolve(cwd);

    expect(skills.map((skill) => skill.name)).toEqual(["paseo"]);
  });

  test("finds a skill in the admin directory", async () => {
    const cwd = path.join(root, "work");
    await mkdir(cwd, { recursive: true });
    await writeSkill(path.join(root, "etc", "codex", "skills"), "audit", "Company policy");

    const skills = await resolve(cwd);

    expect(skills.map((skill) => skill.name)).toEqual(["audit"]);
    expect(skills[0]?.source.kind).toBe("admin");
    expect(skills[0]?.source.label).toBe("Admin");
  });

  test("the working directory wins a name collision with the user home", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".agents", "skills"), "deploy", "Local version");
    await writeSkill(path.join(root, "agents-home", "skills"), "deploy", "Home version");

    const skills = await resolve(cwd);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("Local version");
  });

  test("reads every directory from the working directory up to the repository root", async () => {
    const repo = path.join(root, "repo");
    const cwd = path.join(repo, "packages", "app");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeSkill(path.join(repo, ".agents", "skills"), "release", "Cuts a release");
    await writeSkill(path.join(repo, "packages", ".agents", "skills"), "bump", "Bumps versions");

    const skills = await resolve(cwd);

    expect(skills.map((skill) => skill.name)).toEqual(["bump", "release"]);
    expect(skills.every((skill) => skill.source.kind === "repo")).toBe(true);
    expect(skills.every((skill) => skill.source.label === "Repository")).toBe(true);
  });

  test("a nearer ancestor wins a name collision with the repository root", async () => {
    const repo = path.join(root, "repo");
    const cwd = path.join(repo, "packages", "app");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeSkill(path.join(repo, ".agents", "skills"), "release", "Root version");
    await writeSkill(path.join(repo, "packages", ".agents", "skills"), "release", "Nearer version");

    const skills = await resolve(cwd);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("Nearer version");
  });

  test("does not climb above the working directory outside a repository", async () => {
    const cwd = path.join(root, "loose", "work");
    await mkdir(cwd, { recursive: true });
    await writeSkill(path.join(root, "loose", ".agents", "skills"), "stray", "Not in a repo");

    const skills = await resolve(cwd);

    expect(skills).toEqual([]);
  });

  test("skips an entry whose frontmatter has no description", async () => {
    const cwd = path.join(root, "work");
    const skillDir = path.join(cwd, ".agents", "skills", "broken");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: broken\n---\nbody\n", "utf8");

    const skills = await resolve(cwd);

    expect(skills).toEqual([]);
  });

  test("returns an empty list when nothing exists", async () => {
    const skills = await resolve(path.join(root, "missing"));

    expect(skills).toEqual([]);
  });

  test("sorts the whole result alphabetically across source groups", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".agents", "skills"), "alpha", "First");
    await writeSkill(path.join(cwd, ".agents", "skills"), "zeta", "Last");
    await writeSkill(path.join(root, "agents-home", "skills"), "middle", "Middle");

    const skills = await resolve(cwd);

    expect(skills.map((skill) => skill.name)).toEqual(["alpha", "middle", "zeta"]);
  });

  test("marks a skill that opts out of user invocation", async () => {
    const cwd = path.join(root, "work");
    const skillDir = path.join(cwd, ".agents", "skills", "internal");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: internal\ndescription: Internal only\nuser-invocable: false\n---\nbody\n",
      "utf8",
    );

    const skills = await resolve(cwd);

    expect(skills[0]?.userInvocable).toBe(false);
  });

  test("defaults to user-invocable when the frontmatter omits the flag", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".agents", "skills"), "deploy", "Deploys the app");

    const skills = await resolve(cwd);

    expect(skills[0]?.userInvocable).toBe(true);
  });
});
