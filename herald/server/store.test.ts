import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AttentionEntry } from "../shared/herald";
import { AttentionStore } from "./store";

function entry(overrides: Partial<AttentionEntry> = {}): AttentionEntry {
  return {
    agentId: "a1",
    workspaceId: "w1",
    workspaceTitle: "Shop",
    agentTitle: "Login fix",
    lastRequest: null,
    cwd: "/repo",
    reason: "question",
    eventId: "a1:permission:p1",
    requestId: "p1",
    createdAt: "2026-09-15T10:00:00.000Z",
    headline: "Which DB?",
    detail: "A / B",
    summary: { status: "pending" },
    ...overrides,
  };
}

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AttentionStore", () => {
  it("keeps one entry per agent, newest first", () => {
    const store = new AttentionStore(null);
    store.upsert(entry({ agentId: "a1", createdAt: "2026-09-15T10:00:00.000Z" }));
    store.upsert(entry({ agentId: "a2", createdAt: "2026-09-15T11:00:00.000Z" }));
    store.upsert(entry({ agentId: "a1", eventId: "a1:turn:t1", createdAt: "2026-09-15T11:30:00.000Z" }));
    expect(store.list().map((item) => `${item.agentId}:${item.eventId}`)).toEqual([
      "a1:a1:turn:t1",
      "a2:a1:permission:p1",
    ]);
  });

  it("applies a summary only to the event it was written for", () => {
    const store = new AttentionStore(null);
    store.upsert(entry());
    expect(store.updateSummary("a1", "other", { status: "ready", text: "x", model: "m" })).toBe(false);
    expect(store.get("a1")?.summary.status).toBe("pending");
    expect(store.updateSummary("a1", "a1:permission:p1", { status: "ready", text: "x", model: "m" })).toBe(true);
    expect(store.get("a1")?.summary).toEqual({ status: "ready", text: "x", model: "m" });
    expect(store.updateSummary("missing", "e", { status: "pending" })).toBe(false);
  });

  it("removes on request and by predicate", () => {
    const store = new AttentionStore(null);
    store.upsert(entry());
    expect(store.removeIf("a1", (item) => item.requestId === "nope")).toBe(false);
    expect(store.removeIf("a1", (item) => item.requestId === "p1")).toBe(true);
    expect(store.get("a1")).toBeNull();
    expect(store.remove("a1")).toBeNull();
    store.upsert(entry());
    expect(store.remove("a1")?.agentId).toBe("a1");
  });

  it("does not let a slow load undo what arrived while it was reading", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herald-store-"));
    tempDirs.push(dir);
    const path = join(dir, "attention.json");

    const seed = new AttentionStore(path);
    seed.upsert(entry({ agentId: "a1", eventId: "a1:turn:old", headline: "Older" }));
    seed.upsert(entry({ agentId: "a2" }));
    await seed.flush();

    // A contribution registers its handlers synchronously, so events arrive
    // while the file is still being read.
    const store = new AttentionStore(path);
    const loading = store.load();
    store.upsert(entry({ agentId: "a1", eventId: "a1:turn:new", headline: "Newer" }));
    store.remove("a2");
    await loading;

    expect(store.get("a1")?.eventId).toBe("a1:turn:new");
    expect(store.get("a2")).toBeNull();
  });

  it("leaves the merged map on disk, not just in memory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herald-store-"));
    tempDirs.push(dir);
    const path = join(dir, "attention.json");

    const seed = new AttentionStore(path);
    seed.upsert(entry({ agentId: "a1", eventId: "a1:turn:old" }));
    seed.upsert(entry({ agentId: "a2" }));
    seed.upsert(entry({ agentId: "a3" }));
    await seed.flush();

    // The upsert queues a write of the map as it stands then — a1 alone — and
    // the merge that follows happens only in memory. Saving that snapshot
    // would erase a2 and a3 from the very file being read.
    const store = new AttentionStore(path);
    const loading = store.load();
    store.upsert(entry({ agentId: "a1", eventId: "a1:turn:new" }));
    await loading;
    await store.flush();

    const saved = JSON.parse(await readFile(path, "utf8")) as AttentionEntry[];
    expect(saved.map((item) => item.agentId).sort()).toEqual(["a1", "a2", "a3"]);
    expect(saved.find((item) => item.agentId === "a1")?.eventId).toBe("a1:turn:new");

    // And the next process reads back exactly that.
    const reopened = new AttentionStore(path);
    await reopened.load();
    expect(reopened.list().map((item) => item.agentId).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("applies a conditional removal that arrived before its entry was read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herald-store-"));
    tempDirs.push(dir);
    const path = join(dir, "attention.json");

    const seed = new AttentionStore(path);
    seed.upsert(entry({ agentId: "a1", requestId: "p1", eventId: "a1:permission:p1" }));
    seed.upsert(entry({ agentId: "a2", requestId: "p2", eventId: "a2:permission:p2" }));
    await seed.flush();

    const store = new AttentionStore(path);
    const loading = store.load();
    // The user answers a question that is still only on disk. The test cannot
    // run yet, so it is held for the merge rather than dropped.
    expect(store.removeIf("a1", (item) => item.requestId === "p1")).toBe(false);
    // One whose test does not match must leave its row alone.
    store.removeIf("a2", (item) => item.requestId === "answered elsewhere");
    await loading;

    expect(store.get("a1")).toBeNull();
    expect(store.get("a2")?.requestId).toBe("p2");

    // And it is gone from the file, so the next start does not restore it.
    await store.flush();
    const saved = JSON.parse(await readFile(path, "utf8")) as AttentionEntry[];
    expect(saved.map((item) => item.agentId)).toEqual(["a2"]);
  });

  it("survives a reload, marking an unfinished summary as failed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herald-store-"));
    tempDirs.push(dir);
    const path = join(dir, "nested", "attention.json");

    const first = new AttentionStore(path);
    await first.load(); // no file yet is fine
    first.upsert(entry({ agentId: "a1" }));
    first.upsert(entry({ agentId: "a2", summary: { status: "ready", text: "Done.", model: "m" } }));
    await first.flush();
    expect(JSON.parse(await readFile(path, "utf8"))).toHaveLength(2);

    const second = new AttentionStore(path);
    await second.load();
    expect(second.get("a1")?.summary).toEqual({
      status: "failed",
      error: "The plugin restarted before the summary was written.",
      fallback: "Login fix has a question: Which DB? Options: A / B.",
    });
    expect(second.get("a2")?.summary).toEqual({ status: "ready", text: "Done.", model: "m" });
  });
});
