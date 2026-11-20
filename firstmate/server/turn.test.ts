import { describe, expect, it, vi } from "vitest";

import type { PaseoApi, TimelineEntry } from "./host-types";
import { endedTurnItems, readEndedTurn } from "./turn";

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

  it("reads nothing when a newer turn started before the read", async () => {
    const refetch = vi.fn(async () => ({ entries: [entry(prompt, "t2"), entry(reply, "t2")] }));
    const paseo = { agents: { ref: () => ({ timeline: { refetch } }) } } as unknown as PaseoApi;
    expect(await readEndedTurn(paseo, "a1", "t1")).toEqual([]);
  });
});
