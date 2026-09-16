import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AttentionEntry } from "../shared/herald";
import { AttentionStore, MAX_AGE_MS } from "./store";

function entry(overrides: Partial<AttentionEntry> = {}): AttentionEntry {
  return {
    agentId: "a1",
    workspaceId: "w1",
    agentTitle: "Login fix",
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
    const store = new AttentionStore(null, () => Date.parse("2026-09-15T12:00:00.000Z"));
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

  it("drops entries older than a day when listing", () => {
    let now = Date.parse("2026-09-15T10:30:00.000Z");
    const store = new AttentionStore(null, () => now);
    store.upsert(entry());
    expect(store.list()).toHaveLength(1);
    now += MAX_AGE_MS + 60_000;
    expect(store.list()).toHaveLength(0);
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
