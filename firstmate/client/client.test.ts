import { describe, expect, it } from "vitest";

import { ahoyPrompt, bearingsPrompt } from "./commands";
import { moveColumn, orderedColumns, relativeTime, shortPath } from "./format";
import { injectedSummary, transcriptRows, type TimelineEntry } from "./transcript-rows";

function entry(item: unknown, seq: number): TimelineEntry {
  return {
    provider: "claude",
    item,
    timestamp: "2026-09-22T10:00:00.000Z",
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [],
    collapsed: [],
  } as unknown as TimelineEntry;
}

describe("transcriptRows", () => {
  it("folds injected notes to one line and joins a streamed reply", () => {
    const rows = transcriptRows([
      entry({ type: "user_message", text: "fix the login" }, 1),
      entry({ type: "tool_call", callId: "c", name: "mcp__paseo__create_agent", detail: { type: "unknown", input: {}, output: {} }, status: "completed", error: null }, 2),
      entry({ type: "assistant_message", text: "Aye, " }, 3),
      entry({ type: "assistant_message", text: "captain." }, 4),
      entry({ type: "user_message", text: "<paseo-system>\nAgent a1 (Fix login) finished.\n<agent-response>\ndone: PR x\n</agent-response>\n</paseo-system>" }, 5),
      entry({ type: "reasoning", text: "hmm" }, 6),
    ]);
    expect(rows.map((row) => [row.kind, row.text])).toEqual([
      ["captain", "fix the login"],
      ["tool", "create agent"],
      ["mate", "Aye, captain."],
      ["event", "Agent a1 (Fix login) finished."],
    ]);
  });

  it("recognises both envelopes and nothing else", () => {
    expect(injectedSummary("<firstmate-board>\nThe captain spoke to crewmate a1.\n</firstmate-board>")).toBe(
      "The captain spoke to crewmate a1.",
    );
    expect(injectedSummary("please look at <paseo-system>")).toBeNull();
  });
});

describe("columns", () => {
  it("keeps the saved order, drops unknown ids and appends missing ones", () => {
    expect(orderedColumns(["done", "bogus", "queued"])).toEqual([
      "done",
      "queued",
      "working",
      "blocked",
      "parked",
      "failed",
      "idle",
    ]);
  });

  it("moves a column and clamps at the ends", () => {
    const order = orderedColumns([]);
    expect(moveColumn(order, "working", -1).slice(0, 2)).toEqual(["working", "queued"]);
    expect(moveColumn(order, "queued", -1)).toEqual(order);
  });
});

describe("formatting", () => {
  it("says how long ago in the fewest words", () => {
    const now = Date.parse("2026-09-22T12:00:00.000Z");
    expect(relativeTime("2026-09-22T11:59:50.000Z", now)).toBe("just now");
    expect(relativeTime("2026-09-22T11:55:00.000Z", now)).toBe("5m ago");
    expect(relativeTime("2026-09-22T09:00:00.000Z", now)).toBe("3h ago");
    expect(relativeTime("2026-09-19T12:00:00.000Z", now)).toBe("3d ago");
  });

  it("keeps the end of a long path", () => {
    expect(shortPath("/Users/me/.paseo/plugins/firstmate/home", 24)).toBe("…/plugins/firstmate/home");
  });

  it("turns the commands into plain requests", () => {
    expect(bearingsPrompt("")).toBe("Bearings, please.");
    expect(bearingsPrompt(" file include PRs ")).toBe("Bearings, please — file include PRs.");
    expect(ahoyPrompt("")).toBe("Ahoy!");
  });
});
