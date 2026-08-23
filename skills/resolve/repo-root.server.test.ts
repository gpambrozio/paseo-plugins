import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { findRepoRoot } from "./repo-root.server";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paseo-skills-repo-"));
});

describe("findRepoRoot", () => {
  test("finds the root from a nested directory", async () => {
    const repo = path.join(root, "repo");
    const nested = path.join(repo, "packages", "app", "src");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(nested, { recursive: true });

    expect(await findRepoRoot(nested)).toBe(repo);
  });

  test("matches a .git file, so worktrees and submodules resolve", async () => {
    const repo = path.join(root, "worktree");
    await mkdir(repo, { recursive: true });
    await writeFile(path.join(repo, ".git"), "gitdir: /elsewhere\n", "utf8");

    expect(await findRepoRoot(repo)).toBe(repo);
  });

  test("returns null and stops at the filesystem root when there is no repo", async () => {
    const plain = path.join(root, "no-repo", "deep");
    await mkdir(plain, { recursive: true });

    expect(await findRepoRoot(plain)).toBeNull();
  });
});
