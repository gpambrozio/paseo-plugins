import * as fs from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { legacyPluginDir, migrateLegacyData, pluginDir, PLUGIN_ID } from "./data-dir";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

let paseoHome = "";
const previousHome = process.env["PASEO_HOME"];

beforeEach(async () => {
  paseoHome = await mkdtemp(join(tmpdir(), `${PLUGIN_ID}-data-dir-`));
  process.env["PASEO_HOME"] = paseoHome;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (previousHome === undefined) delete process.env["PASEO_HOME"];
  else process.env["PASEO_HOME"] = previousHome;
  await rm(paseoHome, { recursive: true, force: true });
});

async function put(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

describe("the data directory", () => {
  it("is under plugin-data, not under Paseo's install root", () => {
    expect(pluginDir()).toBe(join(paseoHome, "plugin-data", PLUGIN_ID));
    expect(legacyPluginDir()).toBe(join(paseoHome, "plugins", PLUGIN_ID));
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

  it("leaves both copies alone when the new place already has the entry", async () => {
    await put(join(legacyPluginDir(), "config.json"), "old config");
    await put(join(pluginDir(), "config.json"), "new config");

    expect(migrateLegacyData(["config.json"])).toEqual({ "config.json": "kept" });

    expect(await readFile(join(pluginDir(), "config.json"), "utf8")).toBe("new config");
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

  it("copies across filesystems and removes the original only after the copy lands", async () => {
    await put(join(legacyPluginDir(), "logs", "a.log"), "old log");
    const exdev = Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw exdev;
    });

    expect(migrateLegacyData(["logs"])).toEqual({ logs: "moved" });

    expect(await readFile(join(pluginDir(), "logs", "a.log"), "utf8")).toBe("old log");
    expect(await readdir(pluginDir())).toEqual(["logs"]);
    expect(await readdir(legacyPluginDir())).toEqual([]);
  });

  it("keeps the original and leaves no partial copy when the move fails", async () => {
    await put(join(legacyPluginDir(), "config.json"), "old config");
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });

    expect(migrateLegacyData(["config.json"])).toEqual({ "config.json": "failed" });

    expect(await readFile(join(legacyPluginDir(), "config.json"), "utf8")).toBe("old config");
    expect(await readdir(pluginDir())).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(legacyPluginDir()), expect.any(Error));
  });
});
