import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { dirsUpToRepoRoot, findRepoRoot } from "./repo-root.server";

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

describe("dirsUpToRepoRoot", () => {
  test("yields every directory from cwd up to the repository root, cwd first", async () => {
    const repo = path.join(root, "repo");
    const cwd = path.join(repo, "packages", "app");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });

    expect(await dirsUpToRepoRoot(cwd)).toEqual([cwd, path.join(repo, "packages"), repo]);
  });

  test("yields the repository root alone when cwd is the root", async () => {
    const repo = path.join(root, "repo");
    await mkdir(path.join(repo, ".git"), { recursive: true });

    expect(await dirsUpToRepoRoot(repo)).toEqual([repo]);
  });

  test("yields cwd alone outside a repository, rather than climbing to /", async () => {
    const plain = path.join(root, "no-repo", "deep");
    await mkdir(plain, { recursive: true });

    expect(await dirsUpToRepoRoot(plain)).toEqual([plain]);
  });
});
