import { describe, expect, it, vi } from "vitest";

import type { PaseoApi, TimelineEntry } from "./host-types";
import { carriedTurn, endedTurnItems, readEndedTurn } from "./turn";

function entry(item: TimelineEntry["item"], turnId?: string): TimelineEntry {
  return {
    provider: "claude",
    item,
    ...(turnId === undefined ? {} : { turnId }),
    timestamp: "2026-11-20T00:00:00.000Z",
    seqStart: 0,
    seqEnd: 0,
    sourceSeqRanges: [],
    collapsed: [],
  } as TimelineEntry;
}

const prompt = { type: "user_message", text: "Fix the login bug" } as const;
const reply = { type: "assistant_message", text: "Fixed." } as const;

describe("endedTurnItems", () => {
  it("takes an untagged turn whole, as a live 0.16 daemon returns it", () => {
    expect(endedTurnItems([entry(prompt), entry(reply)], "t1")).toEqual([prompt, reply]);
  });

  it("takes a turn tagged with this turn's id, prompt included", () => {
    expect(endedTurnItems([entry(prompt), entry(reply, "t1")], "t1")).toEqual([prompt, reply]);
  });

  it("reads nothing once a newer turn has taken the tail", () => {
    expect(endedTurnItems([entry(prompt), entry(reply, "t2")], "t1")).toEqual([]);
  });

  it("takes the tail when the event names no turn", () => {
    expect(endedTurnItems([entry(prompt), entry(reply, "t2")], null)).toEqual([prompt, reply]);
  });
});

describe("readEndedTurn", () => {
  it("asks for the latest whole turn", async () => {
    const refetch = vi.fn(async () => ({ entries: [entry(prompt), entry(reply)] }));
    const ref = vi.fn(() => ({ timeline: { refetch } }));
    const paseo = { agents: { ref } } as unknown as PaseoApi;
    expect(await readEndedTurn(paseo, "a1", "t1")).toEqual([prompt, reply]);
    expect(ref).toHaveBeenCalledWith("a1");
    expect(refetch).toHaveBeenCalledWith({ direction: "tail", limit: 1, projection: "projected", wholeTurns: true });
  });
});

describe("carriedTurn", () => {
  it("uses the history a 0.11 or 0.12 daemon put on the event", () => {
    expect(carriedTurn({ timeline: [prompt, reply] })).toEqual([prompt, reply]);
  });

  it("reads back when the field is empty, as since 0.13, or gone, as in 0.17", () => {
    expect(carriedTurn({ timeline: [] })).toBeNull();
    expect(carriedTurn({})).toBeNull();
  });
});
