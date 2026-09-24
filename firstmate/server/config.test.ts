import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pluginDir, readFirstmateConfig, updateFirstmateConfig } from "./config";

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
