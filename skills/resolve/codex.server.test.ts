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

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paseo-skills-codex-"));
});

describe("resolveCodexSkills", () => {
  test("finds a skill in the working directory", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".codex", "skills"), "deploy", "Deploys the app");

    const skills = await resolveCodexSkills({ cwd, codexHome: path.join(root, "codex-home") });

    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("deploy");
    expect(skills[0]?.description).toBe("Deploys the app");
    expect(skills[0]?.source.kind).toBe("project");
    expect(skills[0]?.path).toBe(path.join(cwd, ".codex", "skills", "deploy", "SKILL.md"));
    expect(skills[0]?.status).toBe("discovered");
  });

  test("finds a skill in the codex home directory", async () => {
    const cwd = path.join(root, "work");
    await mkdir(cwd, { recursive: true });
    const codexHome = path.join(root, "codex-home");
    await writeSkill(path.join(codexHome, "skills"), "review", "Reviews code");

    const skills = await resolveCodexSkills({ cwd, codexHome });

    expect(skills.map((skill) => skill.name)).toEqual(["review"]);
    expect(skills[0]?.source.kind).toBe("codex-home");
  });

  test("the working directory wins a name collision with codex home", async () => {
    const cwd = path.join(root, "work");
    const codexHome = path.join(root, "codex-home");
    await writeSkill(path.join(cwd, ".codex", "skills"), "deploy", "Local version");
    await writeSkill(path.join(codexHome, "skills"), "deploy", "Home version");

    const skills = await resolveCodexSkills({ cwd, codexHome });

    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("Local version");
  });

  test("includes the repository root when the working directory is inside a repo", async () => {
    const repo = path.join(root, "repo");
    const cwd = path.join(repo, "packages", "app");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeSkill(path.join(repo, ".codex", "skills"), "release", "Cuts a release");

    const skills = await resolveCodexSkills({ cwd, codexHome: path.join(root, "codex-home") });

    expect(skills.map((skill) => skill.name)).toEqual(["release"]);
    expect(skills[0]?.source.kind).toBe("codex-repo");
  });

  test("skips an entry whose frontmatter has no description", async () => {
    const cwd = path.join(root, "work");
    const skillDir = path.join(cwd, ".codex", "skills", "broken");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: broken\n---\nbody\n", "utf8");

    const skills = await resolveCodexSkills({ cwd, codexHome: path.join(root, "codex-home") });

    expect(skills).toEqual([]);
  });

  test("returns an empty list when nothing exists", async () => {
    const skills = await resolveCodexSkills({
      cwd: path.join(root, "missing"),
      codexHome: path.join(root, "also-missing"),
    });

    expect(skills).toEqual([]);
  });

  test("sorts the whole result alphabetically across source groups", async () => {
    const cwd = path.join(root, "work");
    const codexHome = path.join(root, "codex-home");
    await writeSkill(path.join(cwd, ".codex", "skills"), "alpha", "First");
    await writeSkill(path.join(cwd, ".codex", "skills"), "zeta", "Last");
    await writeSkill(path.join(codexHome, "skills"), "middle", "Middle");

    const skills = await resolveCodexSkills({ cwd, codexHome });

    expect(skills.map((skill) => skill.name)).toEqual(["alpha", "middle", "zeta"]);
  });

  test("marks a skill that opts out of user invocation", async () => {
    const cwd = path.join(root, "work");
    const skillDir = path.join(cwd, ".codex", "skills", "internal");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: internal\ndescription: Internal only\nuser-invocable: false\n---\nbody\n",
      "utf8",
    );

    const skills = await resolveCodexSkills({ cwd, codexHome: path.join(root, "codex-home") });

    expect(skills[0]?.userInvocable).toBe(false);
  });

  test("defaults to user-invocable when the frontmatter omits the flag", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".codex", "skills"), "deploy", "Deploys the app");

    const skills = await resolveCodexSkills({ cwd, codexHome: path.join(root, "codex-home") });

    expect(skills[0]?.userInvocable).toBe(true);
  });
});
