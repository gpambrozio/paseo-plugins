import { describe, expect, it, vi } from "vitest";
import type { PaseoApi } from "./host-types";

import type { AttentionEntry } from "../shared/herald";
import { LIVENESS_TTL_MS, Liveness, RUNNING_TTL_MS, SEEN_GRACE_MS } from "./liveness";
import { AttentionStore } from "./store";

const CREATED_AT = Date.parse("2026-09-15T10:00:00.000Z");

function entry(agentId: string, createdAt = CREATED_AT): AttentionEntry {
  return {
    agentId,
    workspaceId: "w1",
    workspaceTitle: null,
    agentTitle: agentId,
    lastRequest: null,
    cwd: "/repo",
    reason: "finished",
    eventId: `${agentId}:turn:t1`,
    requestId: null,
    createdAt: new Date(createdAt).toISOString(),
    headline: "Finished",
    detail: null,
    summary: { status: "ready", text: "Done.", model: "m" },
  };
}

interface Snapshot {
  status: string;
  archivedAt?: string | null;
  requiresAttention?: boolean;
  pendingPermissions?: Array<{ id: string }>;
  activeTurn?: { turnId: string } | null;
}

function fakePaseo(snapshots: Record<string, Snapshot | null | Error>) {
  const refresh = vi.fn(async (agentId: string) => {
    const snapshot = snapshots[agentId];
    if (snapshot instanceof Error) throw snapshot;
    return snapshot === null || snapshot === undefined ? null : { agent: snapshot, project: null };
  });
  const paseo = {
    agents: { ref: (agentId: string) => ({ refresh: () => refresh(agentId) }) },
  } as unknown as PaseoApi;
  return { paseo, refresh };
}

const LATER = CREATED_AT + SEEN_GRACE_MS + 60_000;

describe("Liveness.visible", () => {
  it("shows waiting agents, hides closed sessions, and removes archived or missing agents", async () => {
    const store = new AttentionStore(null);
    ["live", "closed", "archived", "missing", "flaky"].forEach((id) => store.upsert(entry(id)));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { paseo } = fakePaseo({
      live: { status: "idle", requiresAttention: true },
      closed: { status: "closed" },
      archived: { status: "idle", archivedAt: "2026-09-15T11:00:00.000Z" },
      missing: null,
      flaky: new Error("Transport not connected"),
    });
    const visible = await new Liveness(() => LATER).visible(store, paseo);
    warn.mockRestore();
    expect(visible.map((item) => item.agentId).sort()).toEqual(["flaky", "live"]);
    // Closed stays in the store for when the session resumes; the others are gone for good.
    expect(store.list().map((item) => item.agentId).sort()).toEqual(["closed", "flaky", "live"]);
  });

  it("removes an entry once Paseo no longer flags the agent, unless a permission is pending", async () => {
    const store = new AttentionStore(null);
    store.upsert(entry("seen"));
    // A pending question, which is what an agent with a permission up really
    // holds: the store keeps one entry per agent, so it cannot also be a
    // finish, and a finish is judged on whether the agent is working.
    store.upsert({ ...entry("asking"), reason: "question", requestId: "p1" });
    store.upsert(entry("fresh", LATER - 1_000));
    const { paseo } = fakePaseo({
      seen: { status: "idle", requiresAttention: false },
      asking: { status: "running", requiresAttention: false, pendingPermissions: [{ id: "p1" }] },
      fresh: { status: "idle", requiresAttention: false },
    });
    const visible = await new Liveness(() => LATER).visible(store, paseo);
    // "seen" was looked at; "asking" still has a question up; "fresh" is too new to judge.
    expect(visible.map((item) => item.agentId).sort()).toEqual(["asking", "fresh"]);
    expect(store.list().map((item) => item.agentId).sort()).toEqual(["asking", "fresh"]);
  });

  it("does not delete a newer event recorded while the check was in flight", async () => {
    const store = new AttentionStore(null);
    store.upsert(entry("a1"));
    const newer: AttentionEntry = { ...entry("a1"), eventId: "a1:turn:t2", headline: "Which DB?" };
    // The daemon check is where the await is, so that is where a hook can land.
    const racing = {
      agents: {
        ref: (agentId: string) => ({
          refresh: async () => {
            void agentId;
            store.upsert(newer);
            return { agent: { status: "idle", requiresAttention: false }, project: null };
          },
        }),
      },
    } as unknown as PaseoApi;
    await new Liveness(() => LATER).visible(store, racing);
    expect(store.get("a1")?.eventId).toBe("a1:turn:t2");
  });

  it("re-reads a snapshot that predates the entry before deleting it", async () => {
    const store = new AttentionStore(null);
    let now = 1_000;
    const { paseo, refresh } = fakePaseo({ a1: { status: "idle", requiresAttention: false } });
    const liveness = new Liveness(() => now);

    // Seen once while nothing was waiting, so the cache holds "not flagged".
    store.upsert(entry("a1", now));
    now += SEEN_GRACE_MS + 1;
    await liveness.visible(store, paseo);
    expect(store.get("a1")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);

    // A new event lands, and Paseo flags the agent for it. Judging that entry
    // on the earlier snapshot — still inside the 30 s cache — would delete it.
    const recordedAt = now;
    store.upsert(entry("a1", recordedAt));
    refresh.mockImplementation(async () => ({
      agent: { status: "idle", requiresAttention: true },
      project: null,
    }));
    now = recordedAt + SEEN_GRACE_MS + 1;
    expect(now - recordedAt).toBeLessThan(LIVENESS_TTL_MS);
    const visible = await liveness.visible(store, paseo);
    expect(visible.map((item) => item.eventId)).toEqual(["a1:turn:t1"]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("withholds a finish from an agent that is working again, but not a question", async () => {
    const store = new AttentionStore(null);
    store.upsert({ ...entry("finished"), reason: "finished" });
    store.upsert({ ...entry("asking"), reason: "question", requestId: "p1" });
    const { paseo } = fakePaseo({
      // The turn was reported as finished and the agent carried on.
      finished: { status: "running", requiresAttention: true },
      // Every unanswered question looks exactly like this, and must be shown.
      asking: { status: "running", requiresAttention: true, pendingPermissions: [{ id: "p1" }] },
    });
    const visible = await new Liveness(() => LATER).visible(store, paseo);
    expect(visible.map((item) => item.agentId)).toEqual(["asking"]);
    // Hidden, not removed: the hooks take it back when the summary lands.
    expect(store.list().map((item) => item.agentId).sort()).toEqual(["asking", "finished"]);
  });

  it("re-reads a finish rather than trusting a snapshot seconds old", async () => {
    const store = new AttentionStore(null);
    store.upsert({ ...entry("a1", LATER), reason: "finished" });
    let now = LATER;
    const { paseo, refresh } = fakePaseo({ a1: { status: "idle", requiresAttention: true } });
    const liveness = new Liveness(() => now);
    expect((await liveness.visible(store, paseo)).map((item) => item.agentId)).toEqual(["a1"]);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Well inside the 30 s cache, but past the window a finish is judged on.
    now += RUNNING_TTL_MS + 1;
    refresh.mockImplementation(async () => ({
      agent: { status: "running", requiresAttention: true },
      project: null,
    }));
    expect(await liveness.visible(store, paseo)).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("asks the daemon about an agent at most once per TTL", async () => {
    const store = new AttentionStore(null);
    store.upsert(entry("a1"));
    let now = LATER;
    const { paseo, refresh } = fakePaseo({ a1: { status: "idle", requiresAttention: true } });
    const liveness = new Liveness(() => now);
    await liveness.visible(store, paseo);
    await liveness.visible(store, paseo);
    expect(refresh).toHaveBeenCalledTimes(1);
    now += LIVENESS_TTL_MS + 1;
    await liveness.visible(store, paseo);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
