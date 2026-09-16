import { describe, expect, it, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";

import type { AttentionEntry } from "../shared/herald";
import { LIVENESS_TTL_MS, Liveness, SEEN_GRACE_MS } from "./liveness";
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
    store.upsert(entry("asking"));
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
