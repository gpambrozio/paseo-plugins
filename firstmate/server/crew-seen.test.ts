import { describe, expect, it, vi } from "vitest";

import { CREW_LABELS, type FirstmateConfig } from "../shared/fleet";
import { MateTimelineCursor, finishedAgentIds, isClearableCrew, markCrewSeen, registerCrewSeen } from "./crew-seen";
import type { PaseoAgent, PaseoApi, TimelineItem } from "./host-types";

const CREW = { [CREW_LABELS.role]: CREW_LABELS.crewRole };

function user(text: string): TimelineItem {
  return { type: "user_message", text } as TimelineItem;
}

function assistant(text: string): TimelineItem {
  return { type: "assistant_message", text } as TimelineItem;
}

/** A note as Paseo's `formatFinishNotificationBody` and `formatSystemNotificationPrompt` write it. */
function note(agentId: string, reason: string, title = "fix the parser"): string {
  return `<paseo-system>\nAgent ${agentId} (${title}) ${reason}.\n\n<agent-response>\ndone: PR https://example.com/1\n</agent-response>\n</paseo-system>`;
}

function agent(overrides: Partial<PaseoAgent> = {}): PaseoAgent {
  return {
    id: "crew-1",
    status: "idle",
    labels: CREW,
    requiresAttention: true,
    attentionReason: "finished",
    pendingPermissions: [],
    archivedAt: null,
    ...overrides,
  } as PaseoAgent;
}

function fakePaseo(agents: Record<string, PaseoAgent>): PaseoApi {
  return {
    agents: {
      ref(id: string) {
        return {
          async refresh() {
            const found = agents[id];
            if (found === undefined) throw new Error(`Agent not found: ${id}`);
            return { agent: found };
          },
        };
      },
    },
  } as unknown as PaseoApi;
}

describe("finishedAgentIds", () => {
  it("reads the agents Paseo's notes say finished, once each", () => {
    const items = [
      user(note("crew-1", "finished")),
      assistant("Looking at crew-1."),
      user(note("crew-2", "finished", "a (tricky) title")),
      user(note("crew-1", "finished")),
    ];
    expect(finishedAgentIds(items)).toEqual(["crew-1", "crew-2"]);
  });

  it("ignores errors, permissions, closings and anything the captain typed", () => {
    const items = [
      user(note("crew-1", "errored")),
      user(note("crew-2", "needs permission")),
      user(note("crew-3", "was closed")),
      user("Agent crew-4 (typed by hand) finished."),
      assistant(note("crew-5", "finished")),
    ];
    expect(finishedAgentIds(items)).toEqual([]);
  });

  it("finds a note steered into a message with other text", () => {
    expect(finishedAgentIds([user(`first\n\n${note("crew-1", "finished")}`)])).toEqual(["crew-1"]);
  });
});

describe("isClearableCrew", () => {
  it("clears a crewmate whose only flag is a finish", () => {
    expect(isClearableCrew(agent())).toBe(true);
  });

  it("never touches an agent that is not crew", () => {
    expect(isClearableCrew(agent({ labels: {} }))).toBe(false);
    expect(isClearableCrew(agent({ labels: { [CREW_LABELS.role]: CREW_LABELS.mateRole } }))).toBe(false);
  });

  it("leaves what the captain still has to see", () => {
    expect(isClearableCrew(agent({ pendingPermissions: [{ id: "p" }] as PaseoAgent["pendingPermissions"] }))).toBe(
      false,
    );
    expect(isClearableCrew(agent({ attentionReason: "permission" }))).toBe(false);
    expect(isClearableCrew(agent({ attentionReason: "error" }))).toBe(false);
    expect(isClearableCrew(agent({ status: "error" }))).toBe(false);
    expect(isClearableCrew(agent({ status: "running" }))).toBe(false);
    expect(isClearableCrew(agent({ requiresAttention: false }))).toBe(false);
  });
});

describe("MateTimelineCursor", () => {
  it("hands each item over once", () => {
    const cursor = new MateTimelineCursor();
    const first = [user("a"), user("b")];
    expect(cursor.take("mate", first)).toEqual(first);
    const second = [...first, user("c")];
    expect(cursor.take("mate", second)).toEqual([user("c")]);
    expect(cursor.take("mate", second)).toEqual([]);
  });

  it("reads a timeline shorter than last time from the start", () => {
    const cursor = new MateTimelineCursor();
    cursor.take("mate", [user("a"), user("b"), user("c")]);
    expect(cursor.take("mate", [user("x")])).toEqual([user("x")]);
  });
});

describe("markCrewSeen", () => {
  it("clears only the crewmates that qualify, and survives a failure", async () => {
    const paseo = fakePaseo({
      "crew-1": agent({ id: "crew-1" }),
      "crew-2": agent({ id: "crew-2", attentionReason: "permission" }),
      other: agent({ id: "other", labels: {} }),
      "crew-3": agent({ id: "crew-3" }),
    });
    const clear = vi.fn(async function clear(agentId: string): Promise<void> {
      if (agentId === "crew-3") throw new Error("The daemon did not answer clear_agent_attention within 10 seconds.");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const cleared = await markCrewSeen(paseo, ["crew-1", "crew-2", "other", "crew-3", "gone"], clear);

    expect(cleared).toEqual(["crew-1"]);
    expect(clear.mock.calls.map((call) => call[0])).toEqual(["crew-1", "crew-3"]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("registerCrewSeen", () => {
  type Handler = (
    event: { agent: { id: string }; outcome: { kind: string }; timeline: readonly TimelineItem[] },
    context: { paseo: PaseoApi },
  ) => Promise<void>;

  function setup(mateAgentId = "mate") {
    let handler: Handler | null = null;
    const server = {
      on(name: string, registered: Handler) {
        expect(name).toBe("agent.turn_ended");
        handler = registered;
        return () => {};
      },
    };
    const clear = vi.fn<(agentId: string) => Promise<void>>(async function clear() {});
    const paseo = fakePaseo({ "crew-1": agent({ id: "crew-1" }), "crew-2": agent({ id: "crew-2" }) });
    registerCrewSeen(
      server as unknown as Parameters<typeof registerCrewSeen>[0],
      async function readConfig() {
        return { mateAgentId } as FirstmateConfig;
      },
      clear,
    );
    function end(agentId: string, kind: string, timeline: readonly TimelineItem[]): Promise<void> {
      if (handler === null) throw new Error("no handler registered");
      return handler({ agent: { id: agentId }, outcome: { kind }, timeline }, { paseo });
    }
    return { clear, end };
  }

  it("clears the crewmates a completed first-mate turn read about, once", async () => {
    const { clear, end } = setup();
    const timeline = [user(note("crew-1", "finished"))];
    await end("mate", "completed", timeline);
    await end("mate", "completed", [...timeline, user("captain: thanks")]);
    expect(clear.mock.calls.map((call) => call[0])).toEqual(["crew-1"]);
  });

  it("waits for a completed turn when one is cancelled or fails", async () => {
    const { clear, end } = setup();
    const timeline = [user(note("crew-1", "finished"))];
    await end("mate", "canceled", timeline);
    await end("mate", "failed", timeline);
    expect(clear).not.toHaveBeenCalled();
    await end("mate", "completed", [...timeline, user(note("crew-2", "finished"))]);
    expect(clear.mock.calls.map((call) => call[0])).toEqual(["crew-1", "crew-2"]);
  });

  it("ignores any agent but the first mate", async () => {
    const { clear, end } = setup();
    await end("crew-2", "completed", [user(note("crew-1", "finished"))]);
    expect(clear).not.toHaveBeenCalled();
  });
});
