import * as fs from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultHome, migrateLegacyFiles, readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./config";
import { legacyPluginDir, pluginDir } from "./data-dir";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

let paseoHome = "";
const previousHome = process.env.PASEO_HOME;

beforeEach(async () => {
  paseoHome = await mkdtemp(join(tmpdir(), "firstmate-config-"));
  process.env.PASEO_HOME = paseoHome;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(paseoHome, { recursive: true, force: true });
});

describe("updateFirstmateConfig", () => {
  it("keeps every field when updates overlap, and leaves no temporary file behind", async () => {
    // A launch recording its first mate while a settings save lands.
    await Promise.all([
      updateFirstmateConfig({ mateAgentId: "mate" }),
      updateFirstmateConfig({ mateProvider: "claude/claude-sonnet-5" }),
      updateFirstmateConfig({ mateModeId: "plan" }),
    ]);
    expect(await readFirstmateConfig()).toMatchObject({
      mateAgentId: "mate",
      mateProvider: "claude/claude-sonnet-5",
      mateModeId: "plan",
    });
    expect(await readdir(pluginDir())).toEqual(["config.json"]);
  });

  it("still applies an update queued behind one that failed", async () => {
    await updateFirstmateConfig({ mateAgentId: "mate" });
    const results = await Promise.allSettled([
      updateFirstmateConfig({ home: "/somewhere/else" }),
      updateFirstmateConfig({ mateProvider: "codex/gpt-5" }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
    expect(await readFirstmateConfig()).toMatchObject({ mateAgentId: "mate", mateProvider: "codex/gpt-5" });
  });
});

describe("the first mate's home", () => {
  async function legacyConfig(config: Record<string, string>): Promise<void> {
    await mkdir(legacyPluginDir(), { recursive: true });
    await writeFile(join(legacyPluginDir(), "config.json"), JSON.stringify(config), "utf8");
  }

  async function legacyHome(...files: string[]): Promise<string> {
    const home = join(legacyPluginDir(), "home");
    await mkdir(join(home, "data"), { recursive: true });
    await writeFile(join(home, "AGENTS.md"), "charter", "utf8");
    await Promise.all(
      files.map(async (file) => {
        await mkdir(join(home, file, ".."), { recursive: true });
        await writeFile(join(home, file), "x", "utf8");
      }),
    );
    return home;
  }

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to plugin-data when there is nothing to migrate", () => {
    migrateLegacyFiles();
    expect(defaultHome()).toBe(join(paseoHome, "plugin-data", "firstmate", "home"));
  });

  it("moves the config and a home nobody is aboard", async () => {
    await legacyConfig({ mateProvider: "claude/claude-sonnet-5" });
    await legacyHome("data/backlog.md");

    migrateLegacyFiles();

    expect(await readFirstmateConfig()).toMatchObject({ mateProvider: "claude/claude-sonnet-5" });
    expect(resolveHome(await readFirstmateConfig())).toBe(join(pluginDir(), "home"));
    expect(await readFile(join(pluginDir(), "home", "data", "backlog.md"), "utf8")).toBe("x");
    expect(await readdir(legacyPluginDir())).toEqual([]);
  });

  it("leaves the home where it is while a first mate is aboard in it, and keeps using it", async () => {
    await legacyConfig({ mateAgentId: "mate" });
    const home = await legacyHome();

    migrateLegacyFiles();

    expect(await readFirstmateConfig()).toMatchObject({ mateAgentId: "mate" });
    expect(resolveHome(await readFirstmateConfig())).toBe(home);
    expect(await readFile(join(home, "AGENTS.md"), "utf8")).toBe("charter");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("a first mate is aboard"));

    // Released: the next start carries it over.
    await updateFirstmateConfig({ mateAgentId: "" });
    migrateLegacyFiles();
    expect(resolveHome(await readFirstmateConfig())).toBe(join(pluginDir(), "home"));
    expect(await readFile(join(pluginDir(), "home", "AGENTS.md"), "utf8")).toBe("charter");
  });

  it("leaves a home holding clones where it is, since Paseo knows them by path", async () => {
    const home = await legacyHome("projects/shop/README.md");

    migrateLegacyFiles();

    expect(defaultHome()).toBe(home);
    expect(await readFile(join(home, "projects", "shop", "README.md"), "utf8")).toBe("x");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("shop"));
  });

  it("leaves a configured home alone, and still moves the old default one out", async () => {
    await legacyConfig({ home: "/Users/captain/firstmate", mateAgentId: "mate" });
    await legacyHome();

    migrateLegacyFiles();

    expect(resolveHome(await readFirstmateConfig())).toBe("/Users/captain/firstmate");
    expect(await readFile(join(pluginDir(), "home", "AGENTS.md"), "utf8")).toBe("charter");
  });

  it("leaves a home the settings name by its legacy path where it is, first mate and all", async () => {
    const home = join(legacyPluginDir(), "home");
    await legacyConfig({ home, mateAgentId: "mate" });
    await legacyHome();

    migrateLegacyFiles();

    expect(resolveHome(await readFirstmateConfig())).toBe(home);
    expect(await readFile(join(home, "AGENTS.md"), "utf8")).toBe("charter");
    expect(fs.existsSync(join(pluginDir(), "home"))).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("the settings name it"));
  });

  it("keeps using a home whose move failed where it is, and moves it on the next start", async () => {
    await legacyConfig({ mateProvider: "claude/claude-sonnet-5" });
    const home = await legacyHome();
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });

    migrateLegacyFiles();

    expect(await readFirstmateConfig()).toMatchObject({ mateProvider: "claude/claude-sonnet-5" });
    expect(resolveHome(await readFirstmateConfig())).toBe(home);

    migrateLegacyFiles();
    expect(resolveHome(await readFirstmateConfig())).toBe(join(pluginDir(), "home"));
    expect(await readFile(join(pluginDir(), "home", "AGENTS.md"), "utf8")).toBe("charter");
  });

  it("prefers a home already in plugin-data, and leaves the old one untouched", async () => {
    const old = await legacyHome();
    await mkdir(join(pluginDir(), "home"), { recursive: true });

    migrateLegacyFiles();

    expect(defaultHome()).toBe(join(pluginDir(), "home"));
    expect(await readFile(join(old, "AGENTS.md"), "utf8")).toBe("charter");
  });
});
