import * as fs from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dataPath, legacyPluginDir, migrateLegacyData, pluginDir, PLUGIN_ID } from "./data-dir";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, linkSync: vi.fn(actual.linkSync), renameSync: vi.fn(actual.renameSync) };
});

let paseoHome = "";
const previousHome = process.env.PASEO_HOME;

beforeEach(async () => {
  paseoHome = await mkdtemp(join(tmpdir(), `${PLUGIN_ID}-data-dir-`));
  process.env.PASEO_HOME = paseoHome;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(paseoHome, { recursive: true, force: true });
});

async function put(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

function failLinkOnce(code = "EACCES"): void {
  vi.mocked(fs.linkSync).mockImplementationOnce(() => {
    throw Object.assign(new Error(code), { code });
  });
}

describe("the data directory", () => {
  it("is under plugin-data, not under Paseo's install root", () => {
    expect(pluginDir()).toBe(join(paseoHome, "plugin-data", PLUGIN_ID));
    expect(legacyPluginDir()).toBe(join(paseoHome, "plugins", PLUGIN_ID));
  });

  it("serves an entry from the new directory unless only the legacy one has it", async () => {
    expect(dataPath("config.json")).toBe(join(pluginDir(), "config.json"));
    await put(join(legacyPluginDir(), "config.json"), "old");
    expect(dataPath("config.json")).toBe(join(legacyPluginDir(), "config.json"));
    await put(join(pluginDir(), "config.json"), "new");
    expect(dataPath("config.json")).toBe(join(pluginDir(), "config.json"));
  });
});

describe("migrateLegacyData", () => {
  it("moves a file and a directory the new place does not have yet", async () => {
    await put(join(legacyPluginDir(), "config.json"), "old config");
    await put(join(legacyPluginDir(), "logs", "a.log"), "old log");

    expect(migrateLegacyData(["config.json", "logs"])).toEqual({ "config.json": "moved", logs: "moved" });

    expect(await readFile(join(pluginDir(), "config.json"), "utf8")).toBe("old config");
    expect(await readFile(join(pluginDir(), "logs", "a.log"), "utf8")).toBe("old log");
    expect(await readdir(legacyPluginDir())).toEqual([]);
  });

  it("moves a path inside a directory, creating the parent", async () => {
    await put(join(legacyPluginDir(), "logs", "a.log"), "old log");

    expect(migrateLegacyData([join("logs", "a.log")])).toEqual({ [join("logs", "a.log")]: "moved" });

    expect(await readFile(join(pluginDir(), "logs", "a.log"), "utf8")).toBe("old log");
    expect(await readdir(join(legacyPluginDir(), "logs"))).toEqual([]);
  });

  it("leaves both copies alone when the new place already has the entry", async () => {
    await put(join(legacyPluginDir(), "config.json"), "old config");
    await put(join(pluginDir(), "config.json"), "new config");

    expect(migrateLegacyData(["config.json"])).toEqual({ "config.json": "kept" });

    expect(await readFile(join(pluginDir(), "config.json"), "utf8")).toBe("new config");
    expect(await readFile(join(legacyPluginDir(), "config.json"), "utf8")).toBe("old config");
  });

  it("never overwrites a file that appears at the destination during the move", async () => {
    await put(join(legacyPluginDir(), "config.json"), "old config");
    const actual = vi.mocked(fs.linkSync).getMockImplementation();
    vi.mocked(fs.linkSync).mockImplementationOnce((from, to) => {
      fs.writeFileSync(to, "written by a racing writer", "utf8");
      actual?.(from, to);
    });

    expect(migrateLegacyData(["config.json"])).toEqual({ "config.json": "kept" });

    expect(await readFile(join(pluginDir(), "config.json"), "utf8")).toBe("written by a racing writer");
    expect(await readFile(join(legacyPluginDir(), "config.json"), "utf8")).toBe("old config");
  });

  it("reports an entry the old place never had, and creates nothing", () => {
    expect(migrateLegacyData(["config.json"])).toEqual({ "config.json": "absent" });
    expect(fs.existsSync(pluginDir())).toBe(false);
  });

  it("never moves what it was not named, such as a managed install's version directories", async () => {
    const version = join(legacyPluginDir(), "0b7c5e2a-4f7e-4f39-9f3a-6c1d2e3f4a5b");
    await put(join(version, "node_modules", "pkg", "package.json"), "{}");
    await put(join(legacyPluginDir(), "config.json"), "old config");

    migrateLegacyData(["config.json"]);

    expect(await readdir(legacyPluginDir())).toEqual(["0b7c5e2a-4f7e-4f39-9f3a-6c1d2e3f4a5b"]);
    expect(await readFile(join(version, "node_modules", "pkg", "package.json"), "utf8")).toBe("{}");
    expect(await readdir(pluginDir())).toEqual(["config.json"]);
  });

  it("copies a file across filesystems and removes the original only after the copy lands", async () => {
    await put(join(legacyPluginDir(), "config.json"), "old config");
    failLinkOnce("EXDEV");

    expect(migrateLegacyData(["config.json"])).toEqual({ "config.json": "moved" });

    expect(await readFile(join(pluginDir(), "config.json"), "utf8")).toBe("old config");
    expect(await readdir(pluginDir())).toEqual(["config.json"]);
    expect(await readdir(legacyPluginDir())).toEqual([]);
  });

  it("copies a directory across filesystems the same way", async () => {
    await put(join(legacyPluginDir(), "logs", "a.log"), "old log");
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
    });

    expect(migrateLegacyData(["logs"])).toEqual({ logs: "moved" });

    expect(await readFile(join(pluginDir(), "logs", "a.log"), "utf8")).toBe("old log");
    expect(await readdir(pluginDir())).toEqual(["logs"]);
    expect(await readdir(legacyPluginDir())).toEqual([]);
  });

  it("keeps the original, and serves and retries it from there, when its move fails", async () => {
    await put(join(legacyPluginDir(), "config.json"), "old config");
    failLinkOnce();

    expect(migrateLegacyData(["config.json"])).toEqual({ "config.json": "failed" });
    expect(fs.existsSync(join(pluginDir(), "config.json"))).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(legacyPluginDir()), expect.any(Error));

    // A handler edits the file where dataPath says it is.
    expect(dataPath("config.json")).toBe(join(legacyPluginDir(), "config.json"));
    await writeFile(dataPath("config.json"), "edited after the failure", "utf8");

    // The next start carries the edited file over.
    expect(migrateLegacyData(["config.json"])).toEqual({ "config.json": "moved" });
    expect(await readFile(dataPath("config.json"), "utf8")).toBe("edited after the failure");
  });

  it("keeps an edit to an entry both places had, even when another entry failed to move", async () => {
    await put(join(legacyPluginDir(), "config.json"), "old config");
    await put(join(pluginDir(), "config.json"), "new config");
    await put(join(legacyPluginDir(), "attention.json"), "old attention");
    failLinkOnce();

    expect(migrateLegacyData(["config.json", "attention.json"])).toEqual({
      "config.json": "kept",
      "attention.json": "failed",
    });

    // The copy in use is the one the next start keeps.
    await writeFile(dataPath("config.json"), "edited this start", "utf8");
    await writeFile(dataPath("attention.json"), "attention edited this start", "utf8");

    migrateLegacyData(["config.json", "attention.json"]);
    expect(await readFile(dataPath("config.json"), "utf8")).toBe("edited this start");
    expect(await readFile(dataPath("attention.json"), "utf8")).toBe("attention edited this start");
    expect(dataPath("attention.json")).toBe(join(pluginDir(), "attention.json"));
  });
});
