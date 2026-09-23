import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CREW_LABELS } from "../shared/fleet";
import { readFirstmateConfig, updateFirstmateConfig } from "./config";
import type { PaseoApi } from "./host-types";
import { RESTART_PROMPT, compactMate, restartMate } from "./mate";

let paseoHome = "";
const previousHome = process.env.PASEO_HOME;

beforeEach(async () => {
  paseoHome = await mkdtemp(join(tmpdir(), "firstmate-mate-"));
  process.env.PASEO_HOME = paseoHome;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(paseoHome, { recursive: true, force: true });
});

interface Snapshot {
  id: string;
  provider: string;
  model: string | null;
  status: string;
  currentModeId: string | null;
  thinkingOptionId?: string | null;
  archivedAt: string | null;
}

/** Just enough of Paseo for the first mate's lifecycle, recording what was asked of it in order. */
function fakePaseo(agents: Record<string, Snapshot>) {
  const calls: string[] = [];
  const created: Array<{ config: Record<string, unknown>; title?: string; labels?: Record<string, string>; prompt?: string }> = [];
  const paseo = {
    agents: {
      ref(id: string) {
        return {
          async refresh() {
            const agent = agents[id];
            if (agent === undefined) throw new Error(`Agent not found: ${id}`);
            return { agent };
          },
          async archive() {
            calls.push(`archive ${id}`);
            const agent = agents[id];
            if (agent !== undefined) agent.archivedAt = "2026-09-23T12:00:00.000Z";
          },
          async send(text: string) {
            calls.push(`send ${id} ${text}`);
          },
        };
      },
    },
    workspaces: {
      async open(cwd: string) {
        calls.push(`open ${cwd}`);
        return {
          id: "wks_home",
          agents: {
            async create(input: (typeof created)[number]) {
              calls.push("create");
              created.push(input);
              return { id: "new-mate" };
            },
          },
        };
      },
    },
  } as unknown as PaseoApi;
  return { paseo, calls, created };
}

const oldMate: Snapshot = {
  id: "old-mate",
  provider: "claude",
  model: "claude-opus-5-5",
  status: "running",
  currentModeId: "bypassPermissions",
  thinkingOptionId: "high",
  archivedAt: null,
};

describe("restartMate", () => {
  it("archives the old first mate before starting one set up the same way", async () => {
    await updateFirstmateConfig({ mateAgentId: "old-mate", mateProvider: "claude/claude-sonnet-5", mateModeId: "" });
    const { paseo, calls, created } = fakePaseo({ "old-mate": { ...oldMate } });

    await expect(restartMate(paseo)).resolves.toEqual({ agentId: "new-mate", workspaceId: "wks_home" });

    expect(calls[0]).toBe("archive old-mate");
    expect(calls.at(-1)).toBe("create");
    // The live agent's setup wins over the config's: it may have been changed in its own tab.
    expect(created[0]).toMatchObject({
      config: { provider: "claude/claude-opus-5-5", modeId: "bypassPermissions", thinkingOptionId: "high" },
      labels: { [CREW_LABELS.role]: CREW_LABELS.mateRole },
      prompt: RESTART_PROMPT,
    });
    expect(await readFirstmateConfig()).toMatchObject({
      mateAgentId: "new-mate",
      mateProvider: "claude/claude-opus-5-5",
      mateModeId: "bypassPermissions",
    });
  });

  it("says so when there is no first mate to restart", async () => {
    const { paseo, calls } = fakePaseo({});
    await expect(restartMate(paseo)).rejects.toThrow("There is no first mate yet");
    expect(calls).toEqual([]);
  });
});

describe("compactMate", () => {
  it("sends /compact to an idle first mate and refuses one mid-turn", async () => {
    await updateFirstmateConfig({ mateAgentId: "old-mate" });
    const idle = fakePaseo({ "old-mate": { ...oldMate, status: "idle" } });
    await expect(compactMate(idle.paseo)).resolves.toBe("old-mate");
    expect(idle.calls).toEqual(["send old-mate /compact"]);

    const busy = fakePaseo({ "old-mate": { ...oldMate, status: "running" } });
    await expect(compactMate(busy.paseo)).rejects.toThrow("in the middle of a turn");
    expect(busy.calls).toEqual([]);
  });
});
