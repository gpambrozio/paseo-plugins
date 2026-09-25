import { describe, expect, it } from "vitest";

import { activityRows, clipLines } from "./activity-rows";
import {
  CaptainMessageSchema,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_BYTES,
  base64Bytes,
  rasterImageType,
} from "../shared/attachments";
import {
  admit,
  captainMessage,
  createAttachmentStore,
  formatBytes,
  hasContent,
  readEach,
  restoreFailed,
  toAttachment,
} from "./attachments";
import { createDraftStore } from "./draft";
import { isAtEnd } from "./follow-end";
import { isSendKey } from "./keys";
import { isDirty, markSaved, type OpenFile } from "./open-file";
import { allAnswered, buildAnswers, dismissSubmitsEmpty, parseQuestions, toggleOption } from "./questions";
import {
  boardRows,
  contextPercent,
  contextTone,
  errorText,
  formatTokenCount,
  moveColumn,
  opensAsLeft,
  orderedColumns,
  relativeTime,
  shortPath,
} from "./format";
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

  it("shows a compaction as one line once it has finished", () => {
    const rows = transcriptRows([
      entry({ type: "user_message", text: "/compact" }, 1),
      entry({ type: "compaction", status: "loading" }, 2),
      entry({ type: "compaction", status: "completed", trigger: "manual" }, 3),
    ]);
    expect(rows.map((row) => [row.kind, row.text])).toEqual([
      ["captain", "/compact"],
      ["event", "Context compacted"],
    ]);
    expect(transcriptRows([entry({ type: "compaction", status: "loading" }, 2)])[0]?.text).toBe("Compacting context…");
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

describe("isAtEnd", () => {
  it("still follows when the content grew before the transcript was told", () => {
    // At the end of 1000 points of content; a reply has grown it to 1300, not yet reported.
    expect(isAtEnd(600, 400, 1300, 1000)).toBe(true);
  });

  it("stops following when the reader scrolls up, and after content shrinks judges it as it is", () => {
    expect(isAtEnd(300, 400, 1300, 1000)).toBe(false);
    expect(isAtEnd(400, 400, 800, 1000)).toBe(true);
    expect(isAtEnd(600, 400, 1000, 0)).toBe(true);
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

  it("puts a card that moved column back to rest, unless something is in progress in it", () => {
    expect(opensAsLeft({ column: "working", inProgress: false }, "working")).toBe(true);
    expect(opensAsLeft({ column: "working", inProgress: false }, "done")).toBe(false);
    expect(opensAsLeft({ column: "working", inProgress: true }, "done")).toBe(true);
  });

  it("moves a column past the hidden ones, keeping them in the saved order", () => {
    const order = orderedColumns([]);
    // done, blocked and parked hidden: working's right neighbour on screen is failed.
    const shown = order.filter((id) => !["done", "blocked", "parked"].includes(id));
    const right = moveColumn(order, "working", 1, shown);
    expect(right.filter((id) => shown.includes(id))).toEqual(["queued", "failed", "working", "idle"]);
    expect(right.filter((id) => !shown.includes(id))).toEqual(["blocked", "parked", "done"]);
    const left = moveColumn(order, "failed", -1, shown);
    expect(left.filter((id) => shown.includes(id))).toEqual(["queued", "failed", "working", "idle"]);
    expect(moveColumn(order, "idle", 1, shown)).toEqual(order);
    expect(moveColumn(order, "done", 1, shown)).toEqual(order);
  });

  it("lays out up to three columns in one row, more in two with the extra in the second", () => {
    const sizes = [0, 1, 2, 3, 4, 5, 6, 7].map((count) =>
      boardRows(Array.from({ length: count }, (_, i) => i)).map((row) => row.length),
    );
    expect(sizes).toEqual([[], [1], [2], [3], [2, 2], [2, 3], [3, 3], [3, 4]]);
    const order = orderedColumns([]);
    expect(boardRows(order).flat()).toEqual(order);
    expect(boardRows([1, 2, 3, 4, 5])).toEqual([
      [1, 2],
      [3, 4, 5],
    ]);
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
});

describe("context meter", () => {
  it("counts tokens and the share used the way Paseo's meter does", () => {
    expect(formatTokenCount(840)).toBe("840");
    expect(formatTokenCount(84_400)).toBe("84k");
    expect(formatTokenCount(1_000_000)).toBe("1m");
    expect(contextPercent(84_000, 200_000)).toBe(42);
    expect(contextPercent(null, 200_000)).toBeNull();
    expect(contextPercent(10, 0)).toBeNull();
  });

  it("warns from 70% and alarms past 90%", () => {
    const theme = {
      colors: { foregroundMuted: "muted", statusWarning: "warning", statusDanger: "danger" },
    } as unknown as Parameters<typeof contextTone>[0];
    expect(contextTone(theme, 69)).toBe("muted");
    expect(contextTone(theme, 70)).toBe("warning");
    expect(contextTone(theme, 90)).toBe("warning");
    expect(contextTone(theme, 91)).toBe("danger");
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

describe("markSaved", () => {
  const sent = { path: "data/backlog.md", content: "mine", modifiedMs: 2000 };

  it("keeps what was typed while the save was in flight, still unsaved", () => {
    const current: OpenFile = { kind: "text", path: "data/backlog.md", modifiedMs: 1000, saved: "old", draft: "mine, and more" };
    const next = markSaved(current, sent);
    expect(next).toEqual({
      kind: "text",
      path: "data/backlog.md",
      modifiedMs: 2000,
      saved: "mine",
      draft: "mine, and more",
    });
    // So a "Save, then open that" asks again instead of going on.
    expect(isDirty(next)).toBe(true);
    expect(isDirty(markSaved({ ...current, draft: "mine" }, sent))).toBe(false);
  });

  it("leaves a file opened meanwhile, or none, alone", () => {
    const other: OpenFile = { kind: "text", path: "AGENTS.md", modifiedMs: 5, saved: "a", draft: "b" };
    expect(markSaved(other, sent)).toBe(other);
    expect(markSaved(null, sent)).toBeNull();
  });
});

describe("createDraftStore", () => {
  it("keeps a draft for a store built later on the same root, as a re-evaluated bundle does", () => {
    const root = {};
    createDraftStore(root).set("mate-1", "half a thought");
    expect(createDraftStore(root).get("mate-1")).toBe("half a thought");
  });

  it("keeps each first mate's draft apart and forgets an emptied one", () => {
    const store = createDraftStore({});
    store.set("mate-1", "one");
    store.set("mate-2", "two");
    store.set("mate-1", "");
    expect(store.get("mate-1")).toBe("");
    expect(store.get("mate-2")).toBe("two");
  });

  it("starts empty on a root that has never held drafts", () => {
    expect(createDraftStore({}).get("mate-1")).toBe("");
  });
});

describe("attachments", () => {
  const png = { fileName: "shot.png", mimeType: "image/png", size: 3, data: "AAAA" };
  const pdf = { fileName: "spec.pdf", mimeType: "application/pdf", size: 3, data: "BBBB" };

  it("sends a raster image as an image and anything else as a file, as Paseo does", () => {
    expect(toAttachment(png, "a").kind).toBe("image");
    expect(toAttachment(pdf, "b").kind).toBe("file");
    // A type the browser gave wins over the extension; with none, the extension decides.
    expect(toAttachment({ ...png, mimeType: "text/plain" }, "c").kind).toBe("file");
    expect(toAttachment({ ...png, fileName: "IMG.JPG", mimeType: "" }, "d")).toMatchObject({ kind: "image", mimeType: "image/jpeg" });
    expect(toAttachment({ ...pdf, mimeType: "" }, "e")).toMatchObject({ kind: "file", mimeType: "application/octet-stream" });
    expect(rasterImageType("image/jpg", "x")).toBe("image/jpeg");
    expect(rasterImageType("image/svg+xml", "logo.svg")).toBeNull();
  });

  it("builds the message: words trimmed, images as images, files to upload, empty lists left out", () => {
    expect(captainMessage("  hi  ", [])).toEqual({ text: "hi" });
    expect(captainMessage("", [toAttachment(png, "a"), toAttachment(pdf, "b")])).toEqual({
      text: "",
      images: [{ data: "AAAA", mimeType: "image/png" }],
      files: [{ fileName: "spec.pdf", mimeType: "application/pdf", data: "BBBB" }],
    });
  });

  it("has something to send with words or attachments, and nothing with neither", () => {
    expect(hasContent("  ", [])).toBe(false);
    expect(hasContent("hi", [])).toBe(true);
    expect(hasContent("", [toAttachment(png, "a")])).toBe(true);
  });

  it("admits files up to Paseo's 50 MB each, 20 a message and 64 MB together, and says why for the rest", () => {
    const mb = 1024 * 1024;
    expect(admit([], [{ fileName: "ok.bin", size: MAX_ATTACHMENT_BYTES }]).accepted).toHaveLength(1);
    expect(admit([], [{ fileName: "big.bin", size: MAX_ATTACHMENT_BYTES + 1 }])).toEqual({
      accepted: [],
      problems: ["big.bin is larger than 50 MB."],
    });

    const nineteen = Array.from({ length: MAX_ATTACHMENTS - 1 }, () => ({ size: 1 }));
    const counted = admit(nineteen, [
      { fileName: "a", size: 1 },
      { fileName: "b", size: 1 },
    ]);
    expect(counted.accepted.map((file) => file.fileName)).toEqual(["a"]);
    expect(counted.problems).toEqual(["b was not attached: a message carries at most 20."]);

    // 40 MB attached; a 30 MB file would pass 64 MB, but a smaller one after it still fits.
    const totalled = admit([{ size: 40 * mb }], [
      { fileName: "c", size: 30 * mb },
      { fileName: "d", size: 20 * mb },
    ]);
    expect(totalled.accepted.map((file) => file.fileName)).toEqual(["d"]);
    expect(totalled.problems).toEqual(["c was not attached: a message's attachments stay under 64 MB together."]);
  });

  it("keeps every file it could read when another in the same pick cannot be read", async () => {
    const good = { fileName: "shot.png", mimeType: "image/png", size: 3, read: () => Promise.resolve("AAAA") };
    const bad = { fileName: "gone.pdf", mimeType: "application/pdf", size: 3, read: () => Promise.reject(new Error("Could not read gone.pdf.")) };
    const also = { fileName: "notes.txt", mimeType: "text/plain", size: 3, read: () => Promise.resolve("BBBB") };

    const { read, failures } = await readEach([good, bad, also]);

    expect(read.map((attachment) => [attachment.fileName, attachment.kind])).toEqual([
      ["shot.png", "image"],
      ["notes.txt", "file"],
    ]);
    expect(failures).toEqual(["Could not attach gone.pdf: Could not read gone.pdf."]);
  });

  it("puts a failed send's attachments back ahead of one attached while it was in flight", () => {
    const sent = [toAttachment(png, "a"), toAttachment(pdf, "b")];
    const addedMeanwhile = [toAttachment(png, "c")];
    expect(restoreFailed(addedMeanwhile, sent).map((attachment) => attachment.id)).toEqual(["a", "b", "c"]);
    expect(restoreFailed([], sent).map((attachment) => attachment.id)).toEqual(["a", "b"]);
    // Never twice, should the same attachment somehow be in both.
    expect(restoreFailed([sent[0]!], sent).map((attachment) => attachment.id)).toEqual(["a", "b"]);
  });

  it("keeps attachments for a store built later on the same root, apart per first mate", () => {
    const root = {};
    createAttachmentStore(root).set("mate-1", [toAttachment(png, "a")]);
    createAttachmentStore(root).set("mate-2", [toAttachment(pdf, "b")]);
    expect(createAttachmentStore(root).get("mate-1").map((attachment) => attachment.id)).toEqual(["a"]);
    createAttachmentStore(root).set("mate-1", []);
    expect(createAttachmentStore(root).get("mate-1")).toEqual([]);
    expect(createAttachmentStore(root).get("mate-2")).toHaveLength(1);
  });

  it("measures base64 and sizes without decoding", () => {
    expect(base64Bytes(Buffer.from("hello").toString("base64"))).toBe(5);
    expect(base64Bytes(Buffer.from("hell").toString("base64"))).toBe(4);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("CaptainMessageSchema", () => {
  /** Base64 that decodes to `bytes`, without building the bytes. */
  function base64Of(bytes: number): string {
    return "A".repeat(Math.ceil(bytes / 3) * 4);
  }

  it("holds images, not only files, to one attachment's limit", () => {
    const image = { data: base64Of(MAX_ATTACHMENT_BYTES + 3), mimeType: "image/png" };
    expect(base64Bytes(image.data)).toBeGreaterThan(MAX_ATTACHMENT_BYTES);
    expect(CaptainMessageSchema.safeParse({ text: "", images: [image] }).success).toBe(false);
    expect(CaptainMessageSchema.safeParse({ text: "", images: [{ data: "AAAA", mimeType: "image/png" }] }).success).toBe(true);
  });

  it("refuses more attachments than a message carries, counting images and files together", () => {
    const image = { data: "AAAA", mimeType: "image/png" };
    const file = { fileName: "a.txt", mimeType: "text/plain", data: "AAAA" };
    const half = MAX_ATTACHMENTS / 2;
    const ok = { text: "", images: Array(half).fill(image), files: Array(half).fill(file) };
    expect(CaptainMessageSchema.safeParse(ok).success).toBe(true);
    expect(CaptainMessageSchema.safeParse({ ...ok, files: Array(half + 1).fill(file) }).success).toBe(false);
  });

  it("refuses attachments that pass the total together though each is within its own limit", () => {
    const each = Math.floor(MAX_MESSAGE_BYTES / 2);
    const file = { fileName: "a.bin", mimeType: "application/octet-stream", data: base64Of(each) };
    expect(CaptainMessageSchema.safeParse({ text: "", files: [file] }).success).toBe(true);
    expect(CaptainMessageSchema.safeParse({ text: "", files: [file, file, file] }).success).toBe(false);
  });
});
