import { describe, expect, it } from "vitest";

import { CREW_LABELS } from "../shared/fleet";
import { CaptainSteers, relaunchText, relayText } from "./crew";

describe("CaptainSteers", () => {
  it("hands back everything said to a crewmate once, then forgets it", () => {
    const steers = new CaptainSteers();
    steers.record("a1", "use pnpm");
    steers.record("a1", "and skip the e2e suite");
    expect(steers.take("a1")).toEqual(["use pnpm", "and skip the e2e suite"]);
    expect(steers.take("a1")).toBeNull();
    expect(steers.take("a2")).toBeNull();
  });
});

describe("relayText", () => {
  it("wraps the exchange for the first mate and clips a long answer", () => {
    const text = relayText({ id: "a1", title: "Fix login" }, ["use pnpm"], "x".repeat(5000));
    expect(text.startsWith("<firstmate-board>")).toBe(true);
    expect(text).toContain("<captain-message>\nuse pnpm\n</captain-message>");
    expect(text).toContain("[truncated; use get_agent_activity for the rest]");
    expect(relayText({ id: "a1", title: null }, ["hi"], null)).toContain("(it ended the turn without a message)");
  });
});

describe("relaunchText", () => {
  it("names the task when the crewmate carries one", () => {
    expect(relaunchText({ id: "a1", title: "Fix", labels: { [CREW_LABELS.task]: "fix-login" } }, " tests pass now ")).toBe(
      "ahoy! Relaunch the worker on fix-login (crewmate a1) in the same local copy, as step 4 of your stuck-crewmate ladder says.\n" +
        "The captain's note for the new worker: tests pass now",
    );
    expect(relaunchText({ id: "a1", title: "Fix", labels: {} }, "go")).toContain('the worker "Fix"');
  });
});
