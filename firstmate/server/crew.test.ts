import { describe, expect, it, vi } from "vitest";
import type { PluginHookEvents, PluginLifecycleRegistration } from "@getpaseo/plugin/server";

import { CREW_LABELS, type FirstmateConfig } from "../shared/fleet";
import { CaptainSteers, registerSteerRelay, relaunchText, relayText } from "./crew";
import type { PaseoApi, TimelineItem } from "./host-types";

describe("CaptainSteers", () => {
  it("hands a steer over only to a turn that read it, once", () => {
    const steers = new CaptainSteers();
    steers.record("a1", "use pnpm");
    steers.record("a1", "and skip the e2e suite");
    // The turn that was running when the steer was sent ends first, without it.
    expect(steers.take("a1", ["fix the login"])).toBeNull();
    expect(steers.take("a1", ["fix the login", "use pnpm"])).toEqual(["use pnpm"]);
    expect(steers.take("a1", ["use pnpm", "and skip the e2e suite"])).toEqual(["and skip the e2e suite"]);
    expect(steers.take("a1", ["use pnpm", "and skip the e2e suite"])).toBeNull();
    expect(steers.take("a2", ["anything"])).toBeNull();
  });

  it("forgets a steer whose send failed, and one nobody answered within the hour", () => {
    let now = 0;
    const steers = new CaptainSteers(() => now);
    steers.record("a1", "never delivered");
    steers.forget("a1", "never delivered");
    expect(steers.take("a1", ["never delivered"])).toBeNull();

    steers.record("a1", "too old");
    now = 61 * 60 * 1000;
    expect(steers.take("a1", ["too old"])).toBeNull();
  });
});

describe("relayText", () => {
  it("wraps the exchange for the first mate and clips a long answer", async () => {
    const text = await relayText({ id: "a1", title: "Fix login" }, ["use pnpm"], `{{title}} ${"x".repeat(5000)}`);
    expect(text.startsWith("<firstmate-board>")).toBe(true);
    expect(text).toContain("crewmate a1 (Fix login)");
    expect(text).toContain("<captain-message>\nuse pnpm\n</captain-message>");
    expect(text).toContain("[truncated; use get_agent_activity for the rest]");
    // What the crewmate said is passed on as it is, even where it looks like a placeholder.
    expect(text).toContain("<agent-response>\n{{title}} xxx");
    const silent = await relayText({ id: "a1", title: null }, ["hi"], null);
    expect(silent).toContain("(it ended the turn without a message)");
    expect(silent).toContain("crewmate a1 (a1)");
  });
});

describe("relaunchText", () => {
  it("names the task when the crewmate carries one, and its title when not", async () => {
    expect(
      await relaunchText({ id: "a1", title: "Fix", labels: { [CREW_LABELS.task]: "fix-login" } }, " tests pass now "),
    ).toBe(
      "ahoy! Relaunch the worker fix-login (crewmate a1) in the same local copy, as step 4 of your stuck-crewmate ladder says.\n" +
        "The captain's note for the new worker: tests pass now",
    );
    expect(await relaunchText({ id: "a1", title: "Fix", labels: {} }, "go")).toContain('the worker "Fix"');
  });
});

describe("registerSteerRelay", () => {
  type TurnEnded = PluginHookEvents["agent.turn.after"];

  function relay(turn: TimelineItem[]) {
    let handler: ((event: TurnEnded, context: { paseo: PaseoApi }) => Promise<void>) | undefined;
    const server = {
      addHook: (name: string, registered: typeof handler) => {
        if (name !== "agent.turn.after") throw new Error(`unexpected hook ${name}`);
        handler = registered;
        return () => {};
      },
    } as unknown as PluginLifecycleRegistration;
    const send = vi.fn(async () => {});
    const paseo = {
      agents: { ref: (id: string) => ({ refresh: async () => ({ agent: { id, archivedAt: null } }), send }) },
    } as unknown as PaseoApi;
    const steers = new CaptainSteers();
    const readTurn = vi.fn(async () => turn);
    registerSteerRelay(server, steers, async () => ({ mateAgentId: "mate" }) as FirstmateConfig, readTurn);
    // The event carries no history, as Paseo's never did; the turn comes from readTurn.
    const end = (outcome: TurnEnded["outcome"] = { kind: "completed" }) =>
      handler!({ agent: { id: "a1", title: "Fix login" }, turnId: "t1", outcome } as unknown as TurnEnded, {
        paseo,
      });
    return { steers, readTurn, send, end };
  }

  it("reads nothing back when no steer is waiting", async () => {
    const { readTurn, send, end } = relay([]);
    await end();
    expect(readTurn).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("relays the steer and the answer from the turn it reads back", async () => {
    const { steers, readTurn, send, end } = relay([
      { type: "user_message", text: "use pnpm" },
      { type: "assistant_message", text: "Switched to pnpm." },
    ]);
    steers.record("a1", "use pnpm");
    await end();
    expect(readTurn).toHaveBeenCalledWith(expect.anything(), "a1", "t1");
    expect(send).toHaveBeenCalledTimes(1);
    const [text] = send.mock.calls[0] as unknown as [string];
    expect(text).toContain("<captain-message>\nuse pnpm\n</captain-message>");
    expect(text).toContain("Switched to pnpm.");
    expect(steers.has("a1")).toBe(false);
  });

  it("keeps a steer the ended turn did not read, and skips a cancelled turn", async () => {
    const { steers, readTurn, send, end } = relay([{ type: "user_message", text: "fix the login" }]);
    steers.record("a1", "use pnpm");
    await end({ kind: "canceled", reason: "steered" });
    expect(readTurn).not.toHaveBeenCalled();
    await end();
    expect(send).not.toHaveBeenCalled();
    expect(steers.has("a1")).toBe(true);
  });
});
