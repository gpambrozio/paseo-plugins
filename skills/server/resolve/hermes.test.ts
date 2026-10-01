import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { resolveHermesSkills } from "./hermes";

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

/** Every root points into the temp dir, so nothing reads the real home. */
function resolve() {
  return resolveHermesSkills({ hermesHome: path.join(root, "hermes-home") });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paseo-skills-hermes-"));
});

describe("resolveHermesSkills", () => {
  test("finds a flat skill directly under skills/", async () => {
    await writeSkill(path.join(root, "hermes-home", "skills"), "paseo", "Paseo reference");

    const skills = await resolve();

    expect(skills.map((skill) => skill.name)).toEqual(["paseo"]);
    expect(skills[0]!.source.kind).toBe("personal");
    expect(skills[0]!.path).toBe(
      path.join(root, "hermes-home", "skills", "paseo", "SKILL.md"),
    );
  });

  test("finds a skill inside a category folder", async () => {
    await writeSkill(path.join(root, "hermes-home", "skills", "productivity"), "docx", "Word files");

    const skills = await resolve();

    expect(skills.map((skill) => skill.name)).toEqual(["docx"]);
    expect(skills[0]!.path).toBe(
      path.join(root, "hermes-home", "skills", "productivity", "docx", "SKILL.md"),
    );
  });

  test("reads flat skills and category skills side by side", async () => {
    const skillsDir = path.join(root, "hermes-home", "skills");
    await writeSkill(skillsDir, "paseo", "Paseo reference");
    await writeSkill(path.join(skillsDir, "productivity"), "docx", "Word files");
    await writeSkill(path.join(skillsDir, "research"), "arxiv", "arXiv papers");

    const names = (await resolve()).map((skill) => skill.name);

    expect(names).toEqual(["arxiv", "docx", "paseo"]);
  });

  test("follows a symlinked skill folder", async () => {
    const store = path.join(root, "agents-store");
    await writeSkill(store, "paseo-handoff", "Hands off a task");
    const skillsDir = path.join(root, "hermes-home", "skills");
    await mkdir(skillsDir, { recursive: true });
    await symlink(path.join(store, "paseo-handoff"), path.join(skillsDir, "paseo-handoff"));

    const skills = await resolve();

    expect(skills.map((skill) => skill.name)).toEqual(["paseo-handoff"]);
    expect(skills[0]!.path).toBe(path.join(skillsDir, "paseo-handoff", "SKILL.md"));
  });

  test("reads a symlinked category folder", async () => {
    const store = path.join(root, "agents-store");
    await writeSkill(store, "docx", "Word files");
    const skillsDir = path.join(root, "hermes-home", "skills");
    await mkdir(skillsDir, { recursive: true });
    await symlink(store, path.join(skillsDir, "productivity"));

    const skills = await resolve();

    expect(skills.map((skill) => skill.name)).toEqual(["docx"]);
  });

  test("treats a folder whose SKILL.md fails frontmatter as a skill, not a category", async () => {
    // A broken SKILL.md still marks the folder: without the file-existence test
    // the scan would descend into it looking for skills that are not there.
    const skillsDir = path.join(root, "hermes-home", "skills");
    await writeSkill(skillsDir, "whole", "A whole skill");
    await mkdir(path.join(skillsDir, "broken"));
    await writeFile(path.join(skillsDir, "broken", "SKILL.md"), "no frontmatter at all", "utf8");

    const names = (await resolve()).map((skill) => skill.name);

    expect(names).toEqual(["whole"]);
  });

  test("skips an entry whose frontmatter lacks name or description", async () => {
    const skillsDir = path.join(root, "hermes-home", "skills");
    await writeSkill(skillsDir, "whole", "A whole skill");
    await mkdir(path.join(skillsDir, "partial"));
    await writeFile(
      path.join(skillsDir, "partial", "SKILL.md"),
      "---\nname: partial\n---\n\nNo description.\n",
      "utf8",
    );

    const names = (await resolve()).map((skill) => skill.name);

    expect(names).toEqual(["whole"]);
  });

  test("resolves a name collision across the two levels first-wins", async () => {
    // Candidates are collected flat-level first, so the flat copy shadows the
    // category copy — the same rule Claude and Codex follow.
    const skillsDir = path.join(root, "hermes-home", "skills");
    await writeSkill(skillsDir, "duplicate", "Flat copy");
    await writeSkill(path.join(skillsDir, "productivity"), "duplicate", "Category copy");

    const skills = await resolve();

    expect(skills).toHaveLength(1);
    expect(skills[0]!.description).toBe("Flat copy");
  });

  test("ignores a category that holds no skills", async () => {
    const skillsDir = path.join(root, "hermes-home", "skills");
    await mkdir(path.join(skillsDir, "empty-category"), { recursive: true });
    await writeFile(path.join(skillsDir, "empty-category", "DESCRIPTION.md"), "docs", "utf8");

    const skills = await resolve();

    expect(skills).toEqual([]);
  });

  test("does not list a skill Hermes archived", async () => {
    // Hermes retires skills into skills/.archive/<name>/; its own walk prunes
    // the directory, so the panel must not present them as live.
    const skillsDir = path.join(root, "hermes-home", "skills");
    await writeSkill(skillsDir, "live", "A live skill");
    await writeSkill(path.join(skillsDir, ".archive"), "retired", "A retired skill");

    const names = (await resolve()).map((skill) => skill.name);

    expect(names).toEqual(["live"]);
  });

  test("does not list an excluded directory posing as a flat skill", async () => {
    // An excluded name with a SKILL.md directly inside it — skills/.hub/SKILL.md
    // — is filtered at the flat level too, not only as a category.
    const skillsDir = path.join(root, "hermes-home", "skills");
    await writeSkill(skillsDir, "live", "A live skill");
    await writeSkill(skillsDir, ".hub", "Poses as a flat skill");

    const names = (await resolve()).map((skill) => skill.name);

    expect(names).toEqual(["live"]);
  });

  test("does not list an excluded directory inside a category", async () => {
    // Excluded names apply wherever they appear, a category's children included.
    // The SKILL.md sits directly in productivity/node_modules/ — the exact path
    // the category reader enumerates — so this fails if that reader loses its
    // predicate, and passes only while the exclusion rides the category read.
    const skillsDir = path.join(root, "hermes-home", "skills");
    await writeSkill(path.join(skillsDir, "productivity"), "docx", "Word files");
    await writeSkill(
      path.join(skillsDir, "productivity"),
      "node_modules",
      "A vendored skill",
    );

    const names = (await resolve()).map((skill) => skill.name);

    expect(names).toEqual(["docx"]);
  });

  test("does not let an excluded flat entry shadow a live skill", async () => {
    // The excluded folder claims the SAME name as the live category skill, so
    // without the flat-level predicate first-wins would read the excluded copy
    // and hide the live one behind it.
    const skillsDir = path.join(root, "hermes-home", "skills");
    await mkdir(path.join(skillsDir, ".archive"), { recursive: true });
    await writeFile(
      path.join(skillsDir, ".archive", "SKILL.md"),
      "---\nname: archive\ndescription: The excluded copy\n---\n\nBody.\n",
      "utf8",
    );
    await writeSkill(path.join(skillsDir, "productivity"), "archive", "The live one");

    const skills = await resolve();

    expect(skills.map((skill) => skill.name)).toEqual(["archive"]);
    expect(skills[0]!.description).toBe("The live one");
  });

  test("does not list token-gated _org mirror skills", async () => {
    // _org/<org>/<skill> mirrors load only for the org named by the
    // .active_org marker; the marker and mirror layout are out of scope here,
    // so none of them are listed.
    const skillsDir = path.join(root, "hermes-home", "skills");
    await writeSkill(skillsDir, "personal", "A personal skill");
    await writeSkill(path.join(skillsDir, "_org", "acme"), "org-only", "An org mirror skill");

    const names = (await resolve()).map((skill) => skill.name);

    expect(names).toEqual(["personal"]);
  });

  test("does not read below the second level", async () => {
    const skillsDir = path.join(root, "hermes-home", "skills");
    // A directory three levels deep that is not a skill: category > folder > skill.
    await writeSkill(path.join(skillsDir, "deep", "deeper"), "buried", "Should not be found");

    const skills = await resolve();

    expect(skills).toEqual([]);
  });

  test("returns nothing when the skills directory is absent", async () => {
    const skills = await resolve();

    expect(skills).toEqual([]);
  });
});
