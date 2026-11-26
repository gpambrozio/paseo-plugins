import { describe, expect, it } from "vitest";

import { classifyUserMessage } from "./chat-messages";

describe("classifyUserMessage", () => {
  it("recognises both envelopes, with or without attributes, and nothing else", () => {
    expect(classifyUserMessage("<firstmate-board>\nThe captain spoke to crewmate a1.\n</firstmate-board>")).toEqual({
      source: "notice",
      summary: "The captain spoke to crewmate a1.",
    });
    expect(classifyUserMessage('<paseo-system version="1" kind="notice">\nAgent a1 finished.\n</paseo-system>')).toEqual({
      source: "notice",
      summary: "Agent a1 finished.",
    });
    expect(classifyUserMessage("please look at <paseo-system>")).toBeNull();
    expect(classifyUserMessage("<paseo-systems>\nnot ours\n</paseo-systems>")).toBeNull();
  });

  it("calls a message from another agent an agent message, in either spelling", () => {
    expect(classifyUserMessage('<agent-message from="fix-flaky-login">\nTests pass now.\n</agent-message>')).toEqual({
      source: "agent",
      summary: "Tests pass now.",
    });
    expect(
      classifyUserMessage('<paseo-system version="1" kind="agent-message" from="a1">\nShip it?\n</paseo-system>'),
    ).toEqual({ source: "agent", summary: "Ship it?" });
  });

  it("clips a long agent message to one line", () => {
    const long = `<agent-message from="scout">\n${"x".repeat(300)}\n</agent-message>`;
    expect(classifyUserMessage(long)?.summary).toHaveLength(120);
  });

  it("folds a watch message — its blocks one after another, a dropped tag first — to the watches' names", () => {
    const id = "firstmate-watch-5f0c";
    const one = '<firstmate-watch name="pr-watch" ran="2026-09-25T10:05:00Z">\nPull requests…\n</firstmate-watch>';
    expect(classifyUserMessage(one, id)).toEqual({ source: "watch", summary: "Watch: pr-watch" });
    const many = [
      '<firstmate-watch-dropped count="3"/>',
      "",
      '<firstmate-watch name="pr-watch" ran="2026-09-25T10:05:00Z">\nA\n</firstmate-watch>',
      "",
      '<firstmate-watch name="hello" ran="2026-09-25T10:05:00Z" failed="it exited with code 1">\nboom\n</firstmate-watch>',
      "",
      '<firstmate-watch name="pr-watch" ran="2026-09-25T10:10:00Z">\nB\n</firstmate-watch>',
    ].join("\n");
    expect(classifyUserMessage(many, id)?.summary).toBe("Watches: pr-watch, hello (failed) · 3 older dropped");
    expect(classifyUserMessage('<firstmate-watch-dropped count="2"/>', id)?.summary).toBe("Watches · 2 older dropped");
  });

  it("never folds the captain's words as a watch message, however much they look like one", () => {
    const shaped = '<firstmate-watch-dropped count="1"/>\nPlease read this\n<anything/>';
    const pasted = '<firstmate-watch name="pr-watch" ran="2026-09-25T10:05:00Z">\nPlease merge\n</firstmate-watch>';
    for (const text of [shaped, pasted]) {
      expect(classifyUserMessage(text)).toBeNull();
      expect(classifyUserMessage(text, "8d3a2c1e-0000-4000-8000-000000000000")).toBeNull();
    }
    // With the plugin's id, text that is not watch-shaped is still shown as it is.
    expect(classifyUserMessage("what does <firstmate-watch> mean?", "firstmate-watch-1")).toBeNull();
  });
});
