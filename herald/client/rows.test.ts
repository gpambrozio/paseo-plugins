import { describe, expect, it } from "vitest";

import type { AttentionEntry } from "../shared/herald";
import { joinRows, rowSubtitle, rowTitle, withAlpha, type FlaggedAgent } from "./rows";
import { AGENT_PARAM, focusedAgentId, heraldScreenInput, HERALD_SCREEN_ID } from "./screen";

function entry(overrides: Partial<AttentionEntry> = {}): AttentionEntry {
  return {
    agentId: "a1",
    workspaceId: "w1",
    workspaceTitle: "Stored title",
    agentTitle: null,
    lastRequest: null,
    cwd: "/Users/me/projects/app",
    reason: "question",
    eventId: "e1",
    requestId: null,
    createdAt: "2026-10-07T10:00:00.000Z",
    headline: "Which branch?",
    detail: null,
    summary: { status: "pending" },
    ...overrides,
  };
}

function flagged(overrides: Partial<FlaggedAgent> = {}): FlaggedAgent {
  return {
    id: "a2",
    title: null,
    workspaceId: "w1",
    cwd: "/Users/me/projects/app",
    status: "idle",
    attentionReason: "finished",
    at: "2026-10-07T09:00:00.000Z",
    ...overrides,
  };
}

describe("joinRows", () => {
  it("lists Herald's entry over Paseo's flag for the same agent", () => {
    const rows = joinRows([entry()], [flagged({ id: "a1" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("question");
    expect(rows[0]?.entry?.eventId).toBe("e1");
  });

  it("adds Paseo-flagged agents Herald has no entry for, newest first", () => {
    const rows = joinRows([entry()], [flagged({ at: "2026-10-07T11:00:00.000Z" })]);
    expect(rows.map((row) => row.agentId)).toEqual(["a2", "a1"]);
    expect(rows[0]?.entry).toBeNull();
  });

  it("drops a closed session and a finished turn on a running agent", () => {
    const rows = joinRows(
      [],
      [
        flagged({ id: "closed", status: "closed" }),
        flagged({ id: "outran", status: "running", attentionReason: "finished" }),
        flagged({ id: "asking", status: "running", attentionReason: "permission" }),
      ],
    );
    expect(rows.map((row) => row.agentId)).toEqual(["asking"]);
  });

  it("calls a flag with no reason plain attention", () => {
    expect(joinRows([], [flagged({ attentionReason: null })])[0]?.reason).toBe("attention");
  });
});

describe("row names", () => {
  it("prefers Paseo's current workspace title, then the stored one, then the folder", () => {
    const [row] = joinRows([entry()], []);
    if (row === undefined) throw new Error("no row");
    expect(rowTitle(row, { w1: "Live title" })).toBe("Live title");
    expect(rowTitle(row, {})).toBe("Stored title");
    expect(rowTitle({ ...row, entry: null }, {})).toBe("app");
  });

  it("subtitles with the agent's title, else what it was last asked", () => {
    const [row] = joinRows([entry({ lastRequest: "Fix the build" })], []);
    if (row === undefined) throw new Error("no row");
    expect(rowSubtitle(row)).toBe("Fix the build");
    expect(rowSubtitle({ ...row, title: "  Release  " })).toBe("Release");
    expect(rowSubtitle({ ...row, entry: null })).toBeNull();
  });
});

describe("withAlpha", () => {
  it("tints a six-digit hex and falls back for anything else", () => {
    expect(withAlpha("#ffaa00", "26")).toBe("#ffaa0026");
    expect(withAlpha("rgb(1, 2, 3)", "26", "#000000")).toBe("#000000");
  });
});

describe("screen params", () => {
  it("round-trips the focused agent through the screen input", () => {
    const input = heraldScreenInput("a1");
    expect(input).toEqual({ screenId: HERALD_SCREEN_ID, params: { [AGENT_PARAM]: "a1" } });
    expect(focusedAgentId(input.params ?? {})).toBe("a1");
  });

  it("focuses nothing without the param, or with it empty", () => {
    expect(heraldScreenInput()).toEqual({ screenId: HERALD_SCREEN_ID, params: {} });
    expect(focusedAgentId({})).toBeNull();
    expect(focusedAgentId({ [AGENT_PARAM]: "" })).toBeNull();
  });
});
