import { describe, expect, it } from "vitest";

import { activityRows, clipLines } from "./activity-rows";
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

describe("activityRows", () => {
  function tool(detail: unknown, status = "completed", error: unknown = null) {
    return { type: "tool_call", callId: "c", name: "Bash", detail, status, error };
  }

  it("keeps the machinery: reasoning joined, tools with what they ran, the brief as a prompt", () => {
    const rows = activityRows([
      entry({ type: "user_message", text: "Fix the login bug." }, 1),
      entry({ type: "reasoning", text: "Look at " }, 2),
      entry({ type: "reasoning", text: "auth.ts first." }, 3),
      entry(tool({ type: "shell", command: "npm test", output: "ok\n", exitCode: 0 }), 4),
      entry({ type: "assistant_message", text: "done: " }, 5),
      entry({ type: "assistant_message", text: "ready in branch fm/1" }, 6),
      entry({ type: "user_message", text: "<firstmate-board>\nThe captain spoke to crewmate a1.\n</firstmate-board>" }, 7),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["prompt", "reasoning", "tool", "reply", "event"]);
    expect(rows[1]).toMatchObject({ text: "Look at auth.ts first." });
    expect(rows[2]).toMatchObject({ label: "Shell", summary: "npm test", detail: "$ npm test\n\nok\n\nexit 0" });
    expect(rows[3]).toMatchObject({ text: "done: ready in branch fm/1" });
  });

  it("shows only the latest plan, where it was last updated", () => {
    const rows = activityRows([
      entry({ type: "todo", items: [{ text: "Read", completed: false }] }, 1),
      entry({ type: "assistant_message", text: "Reading." }, 2),
      entry({ type: "todo", items: [{ text: "Read", completed: true }, { text: "Fix", completed: false, status: "in_progress" }] }, 3),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["reply", "plan"]);
    expect(rows[1]).toMatchObject({
      items: [
        { text: "Read", status: "completed" },
        { text: "Fix", status: "in_progress" },
      ],
    });
  });

  it("describes a failed call, an edit and an MCP tool", () => {
    const [failed, edit, mcp] = activityRows([
      entry(tool({ type: "read", filePath: "src/a.ts" }, "failed", "ENOENT"), 1),
      entry(tool({ type: "edit", filePath: "src/b.ts", oldString: "a", newString: "b" }), 2),
      entry({ ...tool({ type: "unknown", input: { title: "x" }, output: null }), name: "mcp__paseo__create_agent" }, 3),
    ]);
    expect(failed).toMatchObject({ label: "Read", status: "failed", detail: "Error: ENOENT" });
    expect(edit).toMatchObject({ label: "Edit", detail: "- a\n\n+ b" });
    expect(mcp).toMatchObject({ label: "create agent", summary: '{ "title": "x" }' });
  });

  it("keys a row by where it starts, so it stays open while it runs and as the window slides", () => {
    const running = entry(tool({ type: "shell", command: "npm test" }, "running"), 7);
    const finished = { ...entry(tool({ type: "shell", command: "npm test", output: "ok" }), 7), seqEnd: 9 };
    const before = activityRows([running]);
    const after = activityRows([entry({ type: "user_message", text: "Fix it." }, 3), finished]);
    expect(after[1]?.key).toBe(before[0]?.key);
  });

  it("drops the plan when the list is emptied", () => {
    const rows = activityRows([
      entry({ type: "todo", items: [{ text: "Read", completed: false }] }, 1),
      entry({ type: "todo", items: [] }, 2),
    ]);
    expect(rows).toEqual([]);
  });

  it("clips long output from the end it matters at", () => {
    const text = ["1", "2", "3", "4", "5"].join("\n");
    expect(clipLines(text, 2, "tail")).toBe("… 3 more lines\n4\n5");
    expect(clipLines(text, 4, "head")).toBe("1\n2\n3\n4\n… 1 more line");
    expect(clipLines(text, 5, "head")).toBe(text);
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
