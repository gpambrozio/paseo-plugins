import type { PluginClientContext } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { watchAgents, type AgentUpdate } from "./agents";

vi.mock("./web", () => ({
  canPlayAudio: () => false,
  canSpeak: () => false,
  playAudio: async function playAudio() {},
  primeSpeech: () => undefined,
  speak: async function speak() {},
  speechPlatform: () => "desktop",
  stopAudio: () => undefined,
  stopSpeaking: () => undefined,
  vibrate: () => undefined,
}));

type Observer = {
  snapshot(list: unknown): void;
  update(message: { type: string; payload?: unknown }): void;
  error?(error: unknown): void;
};

const EMPTY_LIST = {
  requestId: "req",
  subscriptionId: "sub",
  entries: [],
  pageInfo: { hasMore: true, nextCursor: "next" },
};

/**
 * A Paseo 0.9 agents API as far as Herald touches it: `subscribe` is a local
 * listener that hears only what an observation opened by `list({ subscribe })`
 * feeds it, which is what made the bare listener deaf.
 */
function fakePaseo(options: { failLists?: number } = {}) {
  const lists: Record<string, unknown>[] = [];
  const listeners = new Set<(update: AgentUpdate) => void>();
  const observers: Observer[] = [];
  let failLists = options.failLists ?? 0;
  let released = 0;
  const agents = {
    subscribe(handler: (update: AgentUpdate) => void) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    async list(request: Record<string, unknown> = {}) {
      lists.push(request);
      if (failLists > 0) {
        failLists -= 1;
        throw new Error("list failed");
      }
      if (!request.subscribe) return EMPTY_LIST;
      return {
        ...EMPTY_LIST,
        subscription: {
          subscribe(observer: Observer) {
            observers.push(observer);
            observer.snapshot(EMPTY_LIST);
            return () => undefined;
          },
          async release() {
            released += 1;
          },
        },
      };
    },
  };
  return {
    paseo: { agents } as unknown as PluginClientContext["paseo"],
    lists,
    released: () => released,
    /** What the daemon sends down the most recent observation. */
    send(message: { type: string; payload?: unknown }) {
      const observer = observers.at(-1);
      // No observation, no stream: the local listeners hear nothing either.
      if (observer === undefined) return;
      observer.update(message);
      if (message.type === "agent_update") {
        listeners.forEach((listener) => listener(message.payload as AgentUpdate));
      }
    },
    fail(error: unknown) {
      observers.at(-1)?.error?.(error);
    },
  };
}

function attention(id: string) {
  return { kind: "upsert", agent: { id, requiresAttention: true } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("watchAgents", () => {
  it("opens an agents observation with a one-agent snapshot", async () => {
    const fake = fakePaseo();
    const stop = watchAgents(fake.paseo, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.lists).toHaveLength(1);
    expect(fake.lists[0]).toMatchObject({ subscribe: {}, page: { limit: 1 } });
    stop();
  });

  it("passes on agent updates and nothing else", async () => {
    const fake = fakePaseo();
    const seen: unknown[] = [];
    const stop = watchAgents(fake.paseo, (update) => seen.push(update));
    await vi.advanceTimersByTimeAsync(0);
    fake.send({ type: "agent_update", payload: attention("a1") });
    fake.send({ type: "workspace_update", payload: {} });
    expect(seen).toEqual([attention("a1")]);
    stop();
  });

  it("releases the observation on cleanup and hears nothing after", async () => {
    const fake = fakePaseo();
    const seen: unknown[] = [];
    const stop = watchAgents(fake.paseo, (update) => seen.push(update));
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.released()).toBe(1);
    expect(fake.lists[0]?.signal).toBeInstanceOf(AbortSignal);
    expect((fake.lists[0]?.signal as AbortSignal).aborted).toBe(true);
  });

  it("releases an observation that opens after cleanup", async () => {
    const fake = fakePaseo();
    const stop = watchAgents(fake.paseo, () => undefined);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.released()).toBe(1);
  });

  it("reopens an observation Paseo gave up on, with backoff", async () => {
    const fake = fakePaseo();
    const seen: unknown[] = [];
    const stop = watchAgents(fake.paseo, (update) => seen.push(update));
    await vi.advanceTimersByTimeAsync(0);
    fake.fail(new Error("re-request failed"));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fake.lists).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.lists).toHaveLength(2);
    fake.send({ type: "agent_update", payload: attention("a2") });
    expect(seen).toEqual([attention("a2")]);
    stop();
  });

  it("retries a failed open, doubling the wait", async () => {
    const fake = fakePaseo({ failLists: 2 });
    const stop = watchAgents(fake.paseo, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.lists).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fake.lists).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(fake.lists).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.lists).toHaveLength(3);
    stop();
  });

  it("cancels a pending retry on cleanup", async () => {
    const fake = fakePaseo({ failLists: 1 });
    const stop = watchAgents(fake.paseo, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.lists).toHaveLength(1);
  });
});

describe("startAnnouncer", () => {
  function fakeClient(fake: ReturnType<typeof fakePaseo>) {
    const polls: unknown[] = [];
    const client = {
      paseo: fake.paseo,
      async rpc(contract: { method?: string }, input: unknown) {
        polls.push(input);
        if (String(contract.method ?? "").includes("settings")) return { values: {} };
        return { entries: [] };
      },
    };
    return { client: client as unknown as PluginClientContext, polls };
  }

  it("polls within a second of Paseo flagging an agent, not at the next idle tick", async () => {
    const { startAnnouncer } = await import("./announcer");
    const fake = fakePaseo();
    const { client, polls } = fakeClient(fake);
    const announcer = startAnnouncer(client);
    await vi.advanceTimersByTimeAsync(500);
    const afterFirstPoll = polls.length;
    expect(afterFirstPoll).toBeGreaterThan(0);

    fake.send({ type: "agent_update", payload: attention("a1") });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(polls.length).toBeGreaterThan(afterFirstPoll);

    announcer.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.released()).toBe(1);
  });
});
