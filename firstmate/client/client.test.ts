import { describe, expect, it } from "vitest";

import { isSendKey } from "./keys";
import { allAnswered, buildAnswers, dismissSubmitsEmpty, parseQuestions, toggleOption } from "./questions";
import { ahoyPrompt, bearingsPrompt } from "./commands";
import { errorText, moveColumn, orderedColumns, relativeTime, shortPath, splitRows } from "./format";
import { injectedSummary, transcriptRows, type TimelineEntry } from "./transcript-rows";

function entry(item: unknown, seq: number): TimelineEntry {
  return {
    provider: "claude",
    item,
    timestamp: "2026-09-22T10:00:00.000Z",
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [],
    collapsed: [],
  } as unknown as TimelineEntry;
}

describe("transcriptRows", () => {
  it("folds injected notes to one line and joins a streamed reply", () => {
    const rows = transcriptRows([
      entry({ type: "user_message", text: "fix the login" }, 1),
      entry({ type: "tool_call", callId: "c", name: "mcp__paseo__create_agent", detail: { type: "unknown", input: {}, output: {} }, status: "completed", error: null }, 2),
      entry({ type: "assistant_message", text: "Aye, " }, 3),
      entry({ type: "assistant_message", text: "captain." }, 4),
      entry({ type: "user_message", text: "<paseo-system>\nAgent a1 (Fix login) finished.\n<agent-response>\ndone: PR x\n</agent-response>\n</paseo-system>" }, 5),
      entry({ type: "reasoning", text: "hmm" }, 6),
    ]);
    expect(rows.map((row) => [row.kind, row.text])).toEqual([
      ["captain", "fix the login"],
      ["tool", "create agent"],
      ["mate", "Aye, captain."],
      ["event", "Agent a1 (Fix login) finished."],
    ]);
  });

  it("recognises both envelopes and nothing else", () => {
    expect(injectedSummary("<firstmate-board>\nThe captain spoke to crewmate a1.\n</firstmate-board>")).toBe(
      "The captain spoke to crewmate a1.",
    );
    expect(injectedSummary("please look at <paseo-system>")).toBeNull();
  });
});

describe("columns", () => {
  it("keeps the saved order, drops unknown ids and appends missing ones", () => {
    expect(orderedColumns(["done", "bogus", "queued"])).toEqual([
      "done",
      "queued",
      "working",
      "blocked",
      "parked",
      "failed",
      "idle",
    ]);
  });

  it("moves a column and clamps at the ends", () => {
    const order = orderedColumns([]);
    expect(moveColumn(order, "working", -1).slice(0, 2)).toEqual(["working", "queued"]);
    expect(moveColumn(order, "queued", -1)).toEqual(order);
  });

  it("splits the board three over four, the extra in the later row", () => {
    const rows = splitRows(orderedColumns([]), 2);
    expect(rows.map((row) => row.length)).toEqual([3, 4]);
    expect(rows.flat()).toEqual(orderedColumns([]));
    expect(splitRows([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(splitRows([1], 2)).toEqual([[1]]);
    expect(splitRows([], 2)).toEqual([]);
  });
});

describe("formatting", () => {
  it("says how long ago in the fewest words", () => {
    const now = Date.parse("2026-09-22T12:00:00.000Z");
    expect(relativeTime("2026-09-22T11:59:50.000Z", now)).toBe("just now");
    expect(relativeTime("2026-09-22T11:55:00.000Z", now)).toBe("5m ago");
    expect(relativeTime("2026-09-22T09:00:00.000Z", now)).toBe("3h ago");
    expect(relativeTime("2026-09-19T12:00:00.000Z", now)).toBe("3d ago");
  });

  it("keeps the end of a long path", () => {
    expect(shortPath("/Users/me/.paseo/plugins/firstmate/home", 24)).toBe("…/plugins/firstmate/home");
  });

  it("turns the commands into plain requests", () => {
    expect(bearingsPrompt("")).toBe("Bearings, please.");
    expect(bearingsPrompt(" file include PRs ")).toBe("Bearings, please — file include PRs.");
    expect(ahoyPrompt("")).toBe("Ahoy!");
  });
});

describe("isSendKey", () => {
  it("sends on Enter, not on Shift+Enter, another key, or an input method confirming a word", () => {
    expect(isSendKey({ key: "Enter" })).toBe(true);
    expect(isSendKey({ key: "Enter", shiftKey: true })).toBe(false);
    expect(isSendKey({ key: "a" })).toBe(false);
    expect(isSendKey({ key: "Enter", isComposing: true })).toBe(false);
    expect(isSendKey({ key: "Enter", keyCode: 229 })).toBe(false);
  });
});

describe("questions", () => {
  // The shape the daemon hands over for Claude's AskUserQuestion, allowOther added by the daemon.
  const input = {
    questions: [
      {
        header: "Agents",
        question: "Which models should run the review/fix loop?",
        multiSelect: false,
        allowOther: true,
        options: [
          { label: "Codex reviews, Claude fixes (Recommended)", description: "Cross-family review." },
          { label: "Claude reviews, Codex fixes" },
        ],
      },
      { header: "Reviews", question: "How many rounds?", multiSelect: true, options: [{ label: "One" }, { label: "Three" }] },
    ],
  };

  it("reads the form and keeps what the daemon added", () => {
    const questions = parseQuestions(input);
    expect(questions?.map((question) => [question.header, question.allowOther, question.multiSelect, question.options.length])).toEqual([
      ["Agents", true, false, 2],
      ["Reviews", false, true, 2],
    ]);
    expect(parseQuestions({ command: "ls" })).toBeNull();
    expect(parseQuestions({ questions: [{ header: "x" }] })).toBeNull();
  });

  it("answers by header, a typed answer winning over a choice and choices joined", () => {
    const questions = parseQuestions(input) ?? [];
    const selections = { 0: new Set([0]), 1: new Set([0, 1]) };
    expect(allAnswered(questions, selections, {})).toBe(true);
    expect(buildAnswers(questions, selections, {})).toEqual({
      Agents: "Codex reviews, Claude fixes (Recommended)",
      Reviews: "One, Three",
    });
    expect(buildAnswers(questions, selections, { 0: "  Fable reviews, Opus fixes " })).toMatchObject({
      Agents: "Fable reviews, Opus fixes",
    });
    expect(allAnswered(questions, { 0: new Set([1]) }, {})).toBe(false);
  });

  it("toggles one choice or many, and dismisses an all-optional form by submitting it", () => {
    expect([...toggleOption(new Set([0]), 1, false)]).toEqual([1]);
    expect([...toggleOption(new Set([1]), 1, false)]).toEqual([]);
    expect([...toggleOption(new Set([0]), 1, true)].sort()).toEqual([0, 1]);
    expect(dismissSubmitsEmpty(parseQuestions(input) ?? [])).toBe(false);
    expect(dismissSubmitsEmpty([{ question: "Notes?", header: "Notes", options: [], multiSelect: false, allowOther: false, allowEmpty: true }])).toBe(true);
  });
});

describe("errorText", () => {
  it("keeps the handler's sentence and drops the RPC wrapper", () => {
    expect(
      errorText(
        new Error(
          'Request failed: "data/captain.md" changed since you opened it. requestType=plugin.rpc.invoke.request code=handler_error',
        ),
      ),
    ).toBe('"data/captain.md" changed since you opened it.');
    expect(errorText(new Error("Transport not connected"))).toBe("Transport not connected");
    expect(errorText("plain")).toBe("plain");
  });
});
