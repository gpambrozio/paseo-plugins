import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanRelative, listDirectory, readTextFile, writeTextFile } from "./files";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "firstmate-files-"));
  tempDirs.push(dir);
  await mkdir(join(dir, "data", "fix-login"), { recursive: true });
  await writeFile(join(dir, "AGENTS.md"), "# First mate\n");
  await writeFile(join(dir, "data", "backlog.md"), "## In flight\n");
  await writeFile(join(dir, "data", "fix-login", "brief.md"), "brief");
  return dir;
}

describe("cleanRelative", () => {
  it("normalizes paths inside the home and refuses the rest", () => {
    expect(cleanRelative("")).toBe("");
    expect(cleanRelative("./data//backlog.md")).toBe("data/backlog.md");
    expect(cleanRelative("data/fix-login/../backlog.md")).toBe("data/backlog.md");
    expect(() => cleanRelative("../outside")).toThrow(/outside the home/);
    expect(() => cleanRelative("data/../../x")).toThrow(/outside the home/);
    expect(() => cleanRelative("/etc/passwd")).toThrow(/not a path inside/);
  });
});

describe("listDirectory", () => {
  it("lists folders first, then files, with paths relative to the home", async () => {
    const dir = await home();
    const root = await listDirectory(dir, "");
    expect(root.entries.map((entry) => [entry.kind, entry.path])).toEqual([
      ["dir", "data"],
      ["file", "AGENTS.md"],
    ]);
    const data = await listDirectory(dir, "data");
    expect(data.entries.map((entry) => entry.path)).toEqual(["data/fix-login", "data/backlog.md"]);
  });

  it("refuses a symlink that leads outside the home", async () => {
    const dir = await home();
    const outside = await mkdtemp(join(tmpdir(), "firstmate-outside-"));
    tempDirs.push(outside);
    await writeFile(join(outside, "secret.txt"), "no");
    await symlink(outside, join(dir, "escape"));
    await expect(listDirectory(dir, "escape")).rejects.toThrow(/outside the home/);
    await expect(readTextFile(dir, "escape/secret.txt")).rejects.toThrow(/outside the home/);
  });
});

describe("readTextFile", () => {
  it("reads text and flags a binary file instead of sending it", async () => {
    const dir = await home();
    expect(await readTextFile(dir, "data/backlog.md")).toMatchObject({ content: "## In flight\n", binary: false });
    await writeFile(join(dir, "image.png"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
    expect(await readTextFile(dir, "image.png")).toMatchObject({ content: null, binary: true });
  });
});

describe("writeTextFile", () => {
  it("saves over the version it opened, and refuses one that changed since unless forced", async () => {
    const dir = await home();
    const opened = await readTextFile(dir, "data/backlog.md");
    const saved = await writeTextFile(dir, {
      path: "data/backlog.md",
      content: "mine",
      expectedModifiedMs: opened.modifiedMs,
      force: false,
    });
    expect(await readFile(join(dir, "data", "backlog.md"), "utf8")).toBe("mine");

    // The first mate writes the file after the editor opened it.
    await writeFile(join(dir, "data", "backlog.md"), "theirs");
    const later = new Date(saved.modifiedMs + 5000);
    await utimes(join(dir, "data", "backlog.md"), later, later);
    await expect(
      writeTextFile(dir, { path: "data/backlog.md", content: "mine again", expectedModifiedMs: saved.modifiedMs, force: false }),
    ).rejects.toThrow(/changed since you opened it/);
    expect(await readFile(join(dir, "data", "backlog.md"), "utf8")).toBe("theirs");

    await writeTextFile(dir, { path: "data/backlog.md", content: "mine again", expectedModifiedMs: saved.modifiedMs, force: true });
    expect(await readFile(join(dir, "data", "backlog.md"), "utf8")).toBe("mine again");
  });

  it("lets only one of two saves opened at the same version replace the file", async () => {
    const dir = await home();
    // Opened well before the saves, so each save's new mtime differs from it.
    const earlier = new Date(Date.now() - 60_000);
    await utimes(join(dir, "data", "backlog.md"), earlier, earlier);
    const opened = await readTextFile(dir, "data/backlog.md");
    const contents = ["first", "second"];
    const results = await Promise.allSettled(
      contents.map((content) =>
        writeTextFile(dir, { path: "data/backlog.md", content, expectedModifiedMs: opened.modifiedMs, force: false }),
      ),
    );
    // Either may reach the queue first; exactly one wins, and the file is the winner's.
    const winners = contents.filter((_, index) => results[index]?.status === "fulfilled");
    expect(winners).toHaveLength(1);
    expect(await readFile(join(dir, "data", "backlog.md"), "utf8")).toBe(winners[0]);
    expect((await readdir(join(dir, "data"))).sort()).toEqual(["backlog.md", "fix-login"]);
  });

  it("creates a new file, folders and all, but never over an existing one", async () => {
    const dir = await home();
    await writeTextFile(dir, { path: "notes/today.md", content: "hi", expectedModifiedMs: null, force: false });
    expect(await readFile(join(dir, "notes", "today.md"), "utf8")).toBe("hi");
    await expect(
      writeTextFile(dir, { path: "AGENTS.md", content: "x", expectedModifiedMs: null, force: false }),
    ).rejects.toThrow(/already exists/);
    await expect(
      writeTextFile(dir, { path: "../escape.md", content: "x", expectedModifiedMs: null, force: false }),
    ).rejects.toThrow(/outside the home/);
  });
});
