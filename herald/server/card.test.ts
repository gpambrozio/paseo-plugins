import { describe, expect, it, vi } from "vitest";
import type { PaseoApi } from "./host-types";

import type { AttentionEntry } from "../shared/herald";
import { HERALD_CARD_KIND, HERALD_CARD_VERSION } from "../shared/timeline";
import { cardFor, publishCard } from "./card";

function entry(eventId: string, summary: AttentionEntry["summary"]): AttentionEntry {
  return {
    agentId: "a1",
    workspaceId: "w1",
    workspaceTitle: "Shop",
    agentTitle: "Login fix",
    lastRequest: "Fix the login bug",
    cwd: "/repo",
    reason: "finished",
    eventId,
    requestId: null,
    createdAt: "2026-09-15T10:00:00.000Z",
    headline: "Finished",
    detail: null,
    summary,
  };
}

interface AppendedItem {
  id?: string;
  data: { summary: { status: string }; superseded: boolean };
}

function fakePaseo(append: (item: AppendedItem) => Promise<unknown>) {
  return { agents: { ref: () => ({ timeline: { append } }) } } as unknown as PaseoApi;
}

/** Lets the chained appends run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("cardFor", () => {
  it("names the work and carries the summary as it stands", () => {
    expect(cardFor(entry("e0", { status: "ready", text: "Done.", model: "m" }))).toEqual({
      eventId: "e0",
      reason: "finished",
      name: "Login fix",
      headline: "Finished",
      detail: null,
      summary: { status: "ready", text: "Done.", model: "m" },
      superseded: false,
    });
  });
});

describe("publishCard", () => {
  it("marks a superseded row, so its renderer can draw nothing", async () => {
    const append = vi.fn(async (_item: AppendedItem) => ({ seq: 1, epoch: "epoch" }));
    await publishCard(fakePaseo(append), entry("e5", { status: "off", fallback: "x" }), { superseded: true });
    expect(append.mock.calls[0]?.[0]).toMatchObject({ id: "summary:e5", data: { superseded: true } });
  });


  it("serialises the appends that share one row, whatever order they are asked in", async () => {
    const started: string[] = [];
    let releaseFirst = () => {};
    const append = vi.fn(async (item: AppendedItem) => {
      started.push(item.data.summary.status);
      if (started.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return { seq: started.length, epoch: "epoch" };
    });
    const paseo = fakePaseo(append);

    // Both are started fire-and-forget by the hooks, the pending one first.
    const pending = publishCard(paseo, entry("e1", { status: "pending" }));
    const ready = publishCard(paseo, entry("e1", { status: "ready", text: "Done.", model: "m" }));
    await settle();
    // The terminal append has not even begun while the pending one hangs, so
    // it cannot overtake it and leave the card writing for ever.
    expect(started).toEqual(["pending"]);

    releaseFirst();
    await Promise.all([pending, ready]);
    expect(started).toEqual(["pending", "ready"]);
    expect(append.mock.calls[0]?.[0]).toMatchObject({
      type: "plugin",
      id: "summary:e1",
      kind: HERALD_CARD_KIND,
      version: HERALD_CARD_VERSION,
    });
  });

  it("does not let two events queue behind each other", async () => {
    const inFlight: string[] = [];
    const append = vi.fn(async (item: AppendedItem) => {
      inFlight.push(item.id ?? "");
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { seq: 1, epoch: "epoch" };
    });
    const paseo = fakePaseo(append);
    await Promise.all([
      publishCard(paseo, entry("e2", { status: "pending" })),
      publishCard(paseo, entry("e3", { status: "pending" })),
    ]);
    expect(inFlight).toEqual(["summary:e2", "summary:e3"]);
  });

  it("keeps the chain moving when an append fails, and reports the cause once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const append = vi.fn(async () => {
      throw new Error("herald test: no plugin timeline rows here");
    });
    const paseo = fakePaseo(append);
    await publishCard(paseo, entry("e4", { status: "pending" }));
    await publishCard(paseo, entry("e4", { status: "ready", text: "Done.", model: "m" }));
    expect(append).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
