import { describe, it, expect, vi } from "vitest";
import { createDraftStore } from "./draft";
import { persistDraft } from "./draft-persistence";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
describe("durable chat drafts", () => {
  it("restores from durable storage into a fresh JS runtime", async () => {
    let disk = "";
    const first = createDraftStore({});
    const save = persistDraft(first, "mate", async () => disk, async text => { disk = text; }, vi.fn());
    await save.ready;
    first.set("mate", "unfinished");
    await save.flush();
    save.stop();
    const fresh = createDraftStore({});
    const restored = persistDraft(fresh, "mate", async () => disk, async () => {}, vi.fn());
    await restored.ready;
    expect(fresh.get("mate")).toBe("unfinished");
    restored.stop();
  });
  it("typing then clearing while hydration waits wins over the old saved text", async () => {
    const read = deferred<string>();
    const store = createDraftStore({});
    const write = vi.fn(async (_text: string) => {});
    const saved = persistDraft(store, "mate", () => read.promise, write, vi.fn());
    store.set("mate", "new");
    store.set("mate", "");
    read.resolve("stale");
    await saved.ready;
    await saved.flush();
    expect(store.get("mate")).toBe("");
    expect(write).toHaveBeenLastCalledWith("");
    saved.stop();
  });
  it("serializes a clear after an in-flight save so it cannot resurrect text", async () => {
    const blocked = deferred<void>();
    const store = createDraftStore({});
    let disk = "";
    const saved = persistDraft(store, "mate", async () => disk, async text => {
      if (text) await blocked.promise;
      disk = text;
    }, vi.fn());
    await saved.ready;
    store.set("mate", "old");
    const first = saved.flush();
    store.set("mate", "");
    const clear = saved.flush();
    blocked.resolve();
    await Promise.all([first, clear]);
    expect(disk).toBe("");
    saved.stop();
  });
  it("keeps failed writes dirty for retry on reconnect or lifecycle flush", async () => {
    const store = createDraftStore({});
    const write = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const report = vi.fn();
    const saved = persistDraft(store, "mate", async () => "", write, report);
    await saved.ready;
    store.set("mate", "keep me");
    await saved.flush();
    await saved.flush();
    expect(write).toHaveBeenLastCalledWith("keep me");
    expect(write).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledTimes(1);
    saved.stop();
  });
});

it("retries failed hydration without erasing the saved draft", async () => {
  const store = createDraftStore({});
  const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("saved");
  const write = vi.fn();
  const saved = persistDraft(store, "mate", read, write, vi.fn());
  await saved.ready;
  expect(write).not.toHaveBeenCalled();
  await saved.hydrate();
  expect(store.get("mate")).toBe("saved");
  saved.stop();
});

it("a re-evaluated bundle's store notifies the existing persistence controller", async () => {
  const root = {};
  const old = createDraftStore(root);
  const write = vi.fn(async (_text: string) => {});
  const saved = persistDraft(old, "mate", async () => "", write, vi.fn());
  await saved.ready;
  createDraftStore(root).set("mate", "after reconnect");
  await saved.flush();
  expect(write).toHaveBeenLastCalledWith("after reconnect");
  saved.stop();
});
