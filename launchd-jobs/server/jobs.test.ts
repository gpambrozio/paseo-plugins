import * as fs from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { legacyPluginDir, pluginDir } from "./data-dir";
import { loadedFromLegacy, moveLegacyFiles, plistRepairs, type PlistFile } from "./jobs";

// Only the file moves and the pure plist logic are exercised here: nothing in
// this file calls launchctl or touches ~/Library/LaunchAgents.

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

let paseoHome = "";
const previousHome = process.env.PASEO_HOME;

beforeEach(async () => {
  paseoHome = await mkdtemp(join(tmpdir(), "launchd-jobs-move-"));
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

function newDir(): string {
  return join(paseoHome, "plugin-data", "launchd-jobs");
}

async function put(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

function plist(runner: string, dir: string, log: string): PlistFile {
  return {
    ProgramArguments: ["/bin/zsh", runner, "backup", "echo hi"],
    EnvironmentVariables: { PATH: "/usr/bin", PASEO_LAUNCHD_JOBS_DIR: dir },
    StandardErrorPath: log,
  };
}

describe("plistRepairs", () => {
  it("repoints all three paths of a plist written before the move", () => {
    const legacy = legacyPluginDir();
    const repairs = plistRepairs(plist(join(legacy, "runner.sh"), legacy, join(legacy, "logs", "backup.log")), "backup");

    expect(repairs).toEqual([
      ["ProgramArguments", "-json", JSON.stringify(["/bin/zsh", join(newDir(), "runner.sh"), "backup", "echo hi"])],
      ["EnvironmentVariables.PASEO_LAUNCHD_JOBS_DIR", "-string", newDir()],
      ["StandardErrorPath", "-string", join(newDir(), "logs", "backup.log")],
    ]);
  });

  it("finishes a rewrite cut short after the runner was repointed", () => {
    const legacy = legacyPluginDir();
    const partial = plist(join(newDir(), "runner.sh"), legacy, join(legacy, "logs", "backup.log"));

    expect(plistRepairs(partial, "backup")).toEqual([
      ["EnvironmentVariables.PASEO_LAUNCHD_JOBS_DIR", "-string", newDir()],
      ["StandardErrorPath", "-string", join(newDir(), "logs", "backup.log")],
    ]);
  });

  it("leaves a plist that is already right, or not in the runner shape, alone", () => {
    expect(plistRepairs(plist(join(newDir(), "runner.sh"), newDir(), join(newDir(), "logs", "backup.log")), "backup")).toEqual([]);
    expect(plistRepairs({ ProgramArguments: ["/usr/bin/true"], StandardErrorPath: "/tmp/x.log" }, "backup")).toEqual([]);
  });
});

describe("loadedFromLegacy", () => {
  it("sees a loaded definition that still names the legacy directory anywhere, not only its runner", () => {
    const legacy = legacyPluginDir();
    const printed = (runner: string, dir: string) =>
      [
        "gui/501/com.paseo-plugins.launchd-jobs.backup = {",
        "\targuments = {",
        "\t\t/bin/zsh",
        `\t\t${runner}`,
        "\t}",
        `\tstderr path = ${join(dir, "logs", "backup.log")}`,
        "\tenvironment = {",
        `\t\tPASEO_LAUNCHD_JOBS_DIR => ${dir}`,
        "\t}",
        "}",
      ].join("\n");

    expect(loadedFromLegacy(printed(join(legacy, "runner.sh"), legacy))).toBe(true);
    expect(loadedFromLegacy(printed(join(newDir(), "runner.sh"), legacy))).toBe(true);
    expect(loadedFromLegacy(printed(join(newDir(), "runner.sh"), newDir()))).toBe(false);
  });
});

describe("moveLegacyFiles", () => {
  async function legacyInstall(): Promise<void> {
    const legacy = legacyPluginDir();
    await put(join(legacy, "runner.sh"), "#!/bin/zsh\n# the old runner\n");
    await put(join(legacy, "jobs.json"), '{"names":{"backup":"Backup"}}');
    await put(join(legacy, "logs", "backup.log"), "old log");
    await put(join(legacy, "runs", "backup.jsonl"), "old runs");
  }

  it("forwards the old runner to the new directory before anything moves, then moves the files", async () => {
    await legacyInstall();

    moveLegacyFiles();

    const forwarder = await readFile(join(legacyPluginDir(), "runner.sh"), "utf8");
    expect(forwarder).toContain(`export PASEO_LAUNCHD_JOBS_DIR=${newDir()}`);
    expect(forwarder).toContain(`exec /bin/zsh ${join(newDir(), "runner.sh")} "$@"`);
    expect(await readFile(join(newDir(), "runner.sh"), "utf8")).toContain('dir="$PASEO_LAUNCHD_JOBS_DIR"');
    expect(await readFile(join(newDir(), "jobs.json"), "utf8")).toContain("Backup");
    expect(await readFile(join(newDir(), "logs", "backup.log"), "utf8")).toBe("old log");
    expect(await readFile(join(newDir(), "runs", "backup.jsonl"), "utf8")).toBe("old runs");
    expect(await readdir(join(legacyPluginDir(), "logs"))).toEqual([]);
  });

  it("still moves the old logs when a forwarded fire has already created the new logs directory", async () => {
    await legacyInstall();
    await put(join(newDir(), "logs", "other.log"), "written through the forwarder");

    moveLegacyFiles();

    expect(await readFile(join(newDir(), "logs", "backup.log"), "utf8")).toBe("old log");
    expect(await readFile(join(newDir(), "logs", "other.log"), "utf8")).toBe("written through the forwarder");
  });

  it("puts the real runner back and stays on the legacy directory when a move fails", async () => {
    await legacyInstall();
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });

    moveLegacyFiles();

    expect(pluginDir()).toBe(legacyPluginDir());
    expect(await readFile(join(legacyPluginDir(), "runner.sh"), "utf8")).toContain('dir="$PASEO_LAUNCHD_JOBS_DIR"');
    expect(await readFile(join(legacyPluginDir(), "jobs.json"), "utf8")).toContain("Backup");
    expect(await readFile(join(legacyPluginDir(), "logs", "backup.log"), "utf8")).toBe("old log");
  });

  it("does nothing for an install that never had the old directory", async () => {
    moveLegacyFiles();

    expect(fs.existsSync(newDir())).toBe(false);
    expect(fs.existsSync(legacyPluginDir())).toBe(false);
  });
});
