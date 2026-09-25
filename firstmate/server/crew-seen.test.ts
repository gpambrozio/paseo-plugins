import { afterEach, describe, expect, it, vi } from "vitest";

import { CREW_LABELS, type FirstmateConfig } from "../shared/fleet";
import { isClearableCrew, markCrewSeen, registerCrewSeen } from "./crew-seen";
import type { PaseoAgent, PaseoApi, TimelineItem } from "./host-types";

const MATE = "020789e4-a3ca-4b30-894e-f5b3af46818f";
const CREW = { [CREW_LABELS.role]: CREW_LABELS.crewRole, "paseo.parent-agent-id": MATE };
const FINISHED_AT = "2026-09-25T00:50:28.202Z";
const LATER = new Date("2026-09-25T01:29:30.000Z");

/** A crewmate as the daemon reported 5bd93f94 after its finish note reached the first mate. */
function agent(overrides: Partial<PaseoAgent> = {}): PaseoAgent {
  return {
    id: "5bd93f94-ac32-4e02-93c0-670b98bf563e",
    status: "idle",
    labels: { ...CREW, [CREW_LABELS.task]: "fix-cafe-scan-description" },
    requiresAttention: true,
    attentionReason: "finished",
    attentionTimestamp: FINISHED_AT,
    pendingPermissions: [],
    archivedAt: null,
    ...overrides,
  } as PaseoAgent;
}

function fakePaseo(agents: readonly PaseoAgent[]): PaseoApi {
  return {
    agents: {
      async list(options: { filter?: { labels?: Record<string, string> } }) {
        const wanted = Object.entries(options.filter?.labels ?? {});
        const entries = agents
          .filter((found) => wanted.every(([key, value]) => found.labels[key] === value))
          .map((found) => ({ agent: found }));
        return { entries, pageInfo: { nextCursor: null, hasMore: false } };
      },
    },
  } as unknown as PaseoApi;
}

describe("isClearableCrew", () => {
  it("clears a crewmate of this first mate whose only flag is a finish from before the turn", () => {
    expect(isClearableCrew(agent(), MATE, LATER)).toBe(true);
    expect(isClearableCrew(agent(), MATE, new Date(FINISHED_AT))).toBe(true);
  });

  it("never touches an agent that is not this first mate's crew", () => {
    expect(isClearableCrew(agent({ labels: {} }), MATE, LATER)).toBe(false);
    expect(isClearableCrew(agent({ labels: { ...CREW, [CREW_LABELS.role]: CREW_LABELS.mateRole } }), MATE, LATER)).toBe(
      false,
    );
    expect(isClearableCrew(agent({ labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole } }), MATE, LATER)).toBe(false);
    expect(isClearableCrew(agent(), "another-mate", LATER)).toBe(false);
  });

  it("waits for a turn that started after the finish", () => {
    expect(isClearableCrew(agent(), MATE, new Date("2026-09-25T00:50:28.000Z"))).toBe(false);
    expect(isClearableCrew(agent({ attentionTimestamp: null }), MATE, LATER)).toBe(false);
  });

  it("leaves what the captain still has to see", () => {
    const permission = { pendingPermissions: [{ id: "p" }] as PaseoAgent["pendingPermissions"] };
    expect(isClearableCrew(agent(permission), MATE, LATER)).toBe(false);
    expect(isClearableCrew(agent({ attentionReason: "permission" }), MATE, LATER)).toBe(false);
    expect(isClearableCrew(agent({ attentionReason: "error" }), MATE, LATER)).toBe(false);
    expect(isClearableCrew(agent({ status: "error" }), MATE, LATER)).toBe(false);
    expect(isClearableCrew(agent({ status: "running" }), MATE, LATER)).toBe(false);
    expect(isClearableCrew(agent({ requiresAttention: false }), MATE, LATER)).toBe(false);
  });
});

describe("markCrewSeen", () => {
  it("clears only the crewmates that qualify, and survives a failure", async () => {
    const paseo = fakePaseo([
      agent({ id: "crew-1" }),
      agent({ id: "crew-2", attentionReason: "permission" }),
      agent({ id: "other", labels: {} }),
      agent({ id: "crew-3" }),
    ]);
    const clear = vi.fn(async function clear(agentId: string): Promise<void> {
      if (agentId === "crew-3") throw new Error("The daemon did not answer clear_agent_attention within 10 seconds.");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const cleared = await markCrewSeen(paseo, MATE, LATER, clear);

    expect(cleared).toEqual(["crew-1"]);
    expect(clear.mock.calls.map((call) => call[0])).toEqual(["crew-1", "crew-3"]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("does not throw when the crew cannot be listed", async () => {
    const paseo = {
      agents: {
        async list() {
          throw new Error("Transport not connected");
        },
      },
    } as unknown as PaseoApi;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(markCrewSeen(paseo, MATE, LATER, vi.fn())).resolves.toEqual([]);
    error.mockRestore();
  });
});

describe("registerCrewSeen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  type Handler = (
    event: { agent: { id: string }; outcome?: { kind: string }; timeline?: readonly TimelineItem[] },
    context: { paseo: PaseoApi },
  ) => void | Promise<void>;

  /**
   * The first mate's timeline as the daemon hands it to `turn_ended`: Paseo
   * keeps every `<paseo-system>` note out of it, so the turn that read
   * 5bd93f94's finish shows only the captain, the tools and the replies.
   */
  const REAL_TIMELINE = [
    { type: "user_message", text: "land 42" },
    { type: "tool_call", name: "Bash", status: "completed" },
    { type: "assistant_message", text: "Landed #42." },
    { type: "assistant_message", text: "Worker 5bd93f9 finished: PR opened." },
  ] as unknown as TimelineItem[];

  function setup(agents: readonly PaseoAgent[] = [agent()]) {
    const handlers = new Map<string, Handler>();
    const server = {
      on(name: string, registered: Handler) {
        handlers.set(name, registered);
        return () => handlers.delete(name);
      },
    };
    const clear = vi.fn<(agentId: string) => Promise<void>>(async function clear() {});
    const paseo = fakePaseo(agents);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let clock = LATER;
    const unregister = registerCrewSeen(
      server as unknown as Parameters<typeof registerCrewSeen>[0],
      async function readConfig() {
        return { mateAgentId: MATE } as FirstmateConfig;
      },
      clear,
      () => clock,
    );
    function handler(name: string): Handler {
      const found = handlers.get(name);
      if (found === undefined) throw new Error(`no ${name} handler registered`);
      return found;
    }
    async function start(agentId: string, at: Date): Promise<void> {
      clock = at;
      await handler("agent.turn_started")({ agent: { id: agentId } }, { paseo });
    }
    async function end(agentId: string, kind: string): Promise<void> {
      const event = { agent: { id: agentId }, outcome: { kind }, timeline: REAL_TIMELINE };
      await handler("agent.turn_ended")(event, { paseo });
    }
    return { clear, start, end, log, handlers, unregister };
  }

  it("clears a crewmate whose finish note never reached the timeline once a later first-mate turn completes", async () => {
    const { clear, start, end, log } = setup();
    await start(MATE, LATER);
    await end(MATE, "completed");
    expect(clear.mock.calls.map((call) => call[0])).toEqual(["5bd93f94-ac32-4e02-93c0-670b98bf563e"]);
    expect(log).toHaveBeenCalledWith("[firstmate] cleared 1 crewmates the first mate has read about");
  });

  it("leaves a crewmate that finished during the turn for the next one", async () => {
    const { clear, start, end } = setup();
    await start(MATE, new Date("2026-09-25T00:50:00.000Z"));
    await end(MATE, "completed");
    expect(clear).not.toHaveBeenCalled();
    await start(MATE, LATER);
    await end(MATE, "completed");
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("waits for a completed turn when one is cancelled or fails", async () => {
    const { clear, start, end } = setup();
    await start(MATE, LATER);
    await end(MATE, "canceled");
    await start(MATE, LATER);
    await end(MATE, "failed");
    expect(clear).not.toHaveBeenCalled();
    await start(MATE, LATER);
    await end(MATE, "completed");
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("skips a turn whose start it did not see, as after a reload", async () => {
    const { clear, end } = setup();
    await end(MATE, "completed");
    expect(clear).not.toHaveBeenCalled();
  });

  it("ignores any agent but the first mate", async () => {
    const { clear, start, end } = setup();
    await start("crew-2", LATER);
    await end("crew-2", "completed");
    expect(clear).not.toHaveBeenCalled();
  });

  it("unregisters both hooks", () => {
    const { handlers, unregister } = setup();
    unregister();
    expect(handlers.size).toBe(0);
  });
});
