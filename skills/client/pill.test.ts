import type { PluginClientContext } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contributePills } from "./pill";

vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null }));
vi.mock("./skills-query", () => ({ useSkillsQuery: () => ({}), countEntries: () => 0 }));
// The popover draws with react-native, which does not load under node. The stand-in
// keeps the one thing the pill wires into it: the call that opens the Skills tab.
vi.mock("./popover", () => ({
  createSkillsPopover: (openTab: (target: unknown) => void) =>
    Object.assign(() => null, { openTab }),
}));

type Agent = { id: string; workspaceId?: string | null };
type Observer = {
  snapshot(list: unknown): void;
  update(message: { type: string; payload: unknown }): void;
  error?(error: unknown): void;
};

function listOf(agents: Agent[]) {
  return {
    requestId: "req",
    subscriptionId: "sub",
    entries: agents.map((agent) => ({ agent })),
    pageInfo: { hasMore: false, nextCursor: null },
  };
}

/**
 * Records what the pills ask of Paseo. `observing` makes it a 0.9 client, where
 * the feed comes from `list({ subscribe })` and a bare `agents.subscribe()`
 * would hear nothing; without it, a 0.8 client that only has the listener.
 */
type Button = {
  title: string;
  label?: string;
  behavior: { kind: string; Content?: { openTab(target: unknown): void } };
};

function fakeClient(options: { observing: boolean; agents: () => Agent[] }) {
  const pills: { agentId: string; workspaceId: string; button: Button; removed: boolean }[] = [];
  const openedPanels: unknown[][] = [];
  const lists: Record<string, unknown>[] = [];
  let observer: Observer | null = null;
  let listener: ((update: unknown) => void) | null = null;
  let released = 0;
  const agents = {
    subscribe(handler: (update: unknown) => void) {
      listener = handler;
      return () => {
        listener = null;
      };
    },
    async list(request: Record<string, unknown> = {}) {
      lists.push(request);
      if (!request.subscribe) return listOf(options.agents());
      return {
        ...listOf(options.agents()),
        subscription: {
          subscribe(next: Observer) {
            observer = next;
            next.snapshot(listOf(options.agents()));
            return () => undefined;
          },
          async release() {
            released += 1;
            observer = null;
          },
        },
      };
    },
  };
  const client = {
    paseo: options.observing ? { observeEvents() {}, agents } : { agents },
    openPanel(...args: unknown[]) {
      openedPanels.push(args);
    },
    addComposerPill(pill: { agentId: string; workspaceId: string; button: Button }) {
      const entry = {
        agentId: pill.agentId,
        workspaceId: pill.workspaceId,
        button: pill.button,
        removed: false,
      };
      pills.push(entry);
      return {
        update() {},
        remove() {
          entry.removed = true;
        },
      };
    },
  };
  return {
    client: client as unknown as PluginClientContext,
    pills,
    lists,
    openedPanels,
    live: () =>
      pills
        .filter((pill) => !pill.removed)
        .map((pill) => `${pill.agentId}@${pill.workspaceId}`)
        .sort(),
    get released() {
      return released;
    },
    get listening() {
      return listener !== null;
    },
    update(payload: unknown) {
      observer?.update({ type: "agent_update", payload });
      listener?.(payload);
    },
    reconnect(agentsNow: Agent[]) {
      observer?.snapshot(listOf(agentsNow));
    },
    fail(error: unknown) {
      const current = observer;
      observer = null;
      current?.error?.(error);
    },
  };
}

describe("composer pills on a 0.9 client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("follows an agent observation instead of a bare listener", async () => {
    let agents: Agent[] = [
      { id: "a1", workspaceId: "w1" },
      { id: "a2", workspaceId: "w2" },
      { id: "a3", workspaceId: null },
    ];
    const fake = fakeClient({ observing: true, agents: () => agents });
    const cleanup = contributePills(fake.client);
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.lists).toHaveLength(1);
    expect(fake.lists[0]?.subscribe).toEqual({});
    expect(fake.lists[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(fake.listening).toBe(false);
    expect(fake.live()).toEqual(["a1@w1", "a2@w2"]);

    // A session created after load: the case that used to need a plugin reload.
    fake.update({ kind: "upsert", agent: { id: "a4", workspaceId: "w4" } });
    expect(fake.live()).toContain("a4@w4");

    const registrations = fake.pills.length;
    fake.update({ kind: "upsert", agent: { id: "a4", workspaceId: "w4" } });
    expect(fake.pills).toHaveLength(registrations);

    fake.update({ kind: "upsert", agent: { id: "a4", workspaceId: "w9" } });
    expect(fake.live()).toContain("a4@w9");
    expect(fake.live()).not.toContain("a4@w4");

    fake.update({ kind: "remove", agentId: "a2" });
    expect(fake.live()).toEqual(["a1@w1", "a4@w9"]);

    // A reconnect snapshot replaces the set and keeps unchanged registrations.
    const beforeReconnect = fake.pills.length;
    fake.reconnect([
      { id: "a1", workspaceId: "w1" },
      { id: "a5", workspaceId: "w5" },
    ]);
    expect(fake.live()).toEqual(["a1@w1", "a5@w5"]);
    expect(fake.pills).toHaveLength(beforeReconnect + 1);

    // Paseo releases an observation whose re-request fails; it has to come back.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    agents = [{ id: "a6", workspaceId: "w6" }];
    fake.fail(new Error("reconnect request failed"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(warn).toHaveBeenCalled();
    expect(fake.lists).toHaveLength(2);
    expect(fake.live()).toEqual(["a6@w6"]);

    cleanup();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.live()).toEqual([]);
    expect(fake.lists.every((request) => (request.signal as AbortSignal).aborted)).toBe(true);
    expect(fake.released).toBeGreaterThanOrEqual(1);
    expect(vi.getTimerCount()).toBe(0);

    fake.update({ kind: "upsert", agent: { id: "a7", workspaceId: "w7" } });
    expect(fake.live()).toEqual([]);
  });
});

describe("composer pills on a 0.8 client", () => {
  it("keeps the listener and seed, and never asks for an observation", async () => {
    const fake = fakeClient({
      observing: false,
      agents: () => [{ id: "a1", workspaceId: "w1" }],
    });
    const cleanup = contributePills(fake.client);
    await Promise.resolve();
    await Promise.resolve();

    expect(fake.lists).toEqual([{}]);
    expect(fake.listening).toBe(true);
    expect(fake.live()).toEqual(["a1@w1"]);

    fake.update({ kind: "upsert", agent: { id: "a2", workspaceId: "w2" } });
    expect(fake.live()).toEqual(["a1@w1", "a2@w2"]);

    cleanup();
    expect(fake.listening).toBe(false);
    expect(fake.live()).toEqual([]);
  });
});

describe("the composer pill's button", () => {
  it("opens a popover, and the popover's tab button opens that agent's Skills tab", async () => {
    const fake = fakeClient({
      observing: false,
      agents: () => [{ id: "a1", workspaceId: "w1" }],
    });
    const cleanup = contributePills(fake.client);
    await Promise.resolve();
    await Promise.resolve();

    const button = fake.pills[0]?.button;
    expect(button?.title).toBe("Skills");
    expect(button?.label).toBe("Skills");
    expect(button?.behavior.kind).toBe("popover");
    // Pressing the pill no longer opens the tab by itself.
    expect(fake.openedPanels).toEqual([]);

    button?.behavior.Content?.openTab({ workspaceId: "w1", agentId: "a1" });
    expect(fake.openedPanels).toEqual([["skills", { workspaceId: "w1", agentId: "a1" }]]);

    cleanup();
  });
});
