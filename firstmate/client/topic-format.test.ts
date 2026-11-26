import { describe, expect, it } from "vitest";

import type { AgentSummary, BacklogItem, FleetCard } from "../shared/fleet";
import { captainColumn } from "./format";
import { needsYouCount } from "./screen";
import {
  DONE_SHOWN,
  doneRecently,
  shortDate,
  shownDone,
  talkingTo,
  threadMessages,
  topicAsk,
  topicLastLine,
  topicMeta,
  topicUnread,
} from "./topic-format";
import type { TimelineEntry } from "./transcript-rows";

function item(overrides: Partial<BacklogItem> = {}): BacklogItem {
  return {
    section: "in-flight",
    id: "fix-flaky-login",
    title: "Fix the flaky login test",
    project: "web",
    kind: null,
    mode: null,
    agentId: null,
    hold: null,
    actions: [],
    notes: [],
    blockedBy: null,
    since: null,
    url: null,
    reportPath: null,
    outcome: null,
    ...overrides,
  };
}

function agent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: "3f2a9c11-5b7d-4e8a-9c0f-1a2b3c4d5e6f",
    workspaceId: null,
    title: "Login test fixer",
    provider: "claude",
    model: "sonnet",
    status: "idle",
    cwd: "/tmp/web",
    pendingPermissions: 0,
    requiresAttention: false,
    lastError: null,
    updatedAt: "2026-09-20T10:00:00.000Z",
    labels: {},
    ...overrides,
  };
}

function card(overrides: Partial<FleetCard> = {}): FleetCard {
  const backlog = overrides.backlog === undefined ? item() : overrides.backlog;
  return {
    key: "backlog:in-flight:fix-flaky-login:0",
    column: "idle",
    taskId: backlog?.id ?? null,
    title: backlog?.title ?? "Untitled",
    project: backlog?.project ?? null,
    kind: null,
    backlog,
    agent: null,
    report: null,
    url: null,
    lastMessage: null,
    ...overrides,
  };
}

describe("a topic's column", () => {
  it("is Done once its line records an outcome, though it is still under In flight", () => {
    expect(captainColumn(card({ backlog: item({ outcome: "merged 2026-09-21" }) }))).toBe("done");
    expect(captainColumn(card())).toBe("working");
    expect(captainColumn(card({ column: "failed", backlog: item({ outcome: "failed 2026-09-21" }) }))).toBe("needs-you");
  });
});

describe("a topic card's meta line", () => {
  it("writes a date as day and month, and leaves any other text as written", () => {
    expect(shortDate("2026-11-25")).toBe("25 Nov");
    expect(shortDate("2026-01-03T09:30:00.000Z")).toBe("3 Jan");
    expect(shortDate("last week")).toBe("last week");
  });

  it("is the project and when the topic started, or was last spoken about", () => {
    expect(topicMeta(card({ backlog: item({ since: "2026-09-20" }) }))).toBe("web · 20 Sep");
    expect(
      topicMeta(card({ lastMessage: { id: "m:1", from: "mate", text: "Hi", at: "2026-09-22T08:00:00.000Z" } })),
    ).toBe("web · 22 Sep");
    expect(topicMeta(card({ backlog: item({ outcome: "merged 2026-09-21" }) }))).toBe("web · 21 Sep");
    expect(topicMeta(card({ backlog: item({ project: null }) }))).toBe("");
  });
});

describe("what a topic asks of the captain", () => {
  it("is the hold on its line", () => {
    expect(topicAsk(card({ backlog: item({ hold: "Postgres or SQLite?" }) }))).toBe("Postgres or SQLite?");
  });

  it("is the permission or the report of an agent that cannot go on", () => {
    expect(topicAsk(card({ column: "blocked", agent: agent({ pendingPermissions: 1 }) }))).toBe(
      "Login test fixer is waiting for a permission.",
    );
    expect(
      topicAsk(card({ column: "blocked", agent: agent(), report: { state: "needs-decision", text: "needs-decision: which port?" } })),
    ).toBe("needs-decision: which port?");
    expect(topicAsk(card({ column: "failed", agent: agent({ status: "error", lastError: "exit 1" }) }))).toBe("exit 1");
  });

  it("is nothing for a topic that is not waiting", () => {
    expect(topicAsk(card())).toBeNull();
    expect(topicAsk(card({ backlog: item({ hold: "Old question", outcome: "merged 2026-09-21" }) }))).toBeNull();
  });
});

describe("a topic card's last line", () => {
  it("is the newest message, with who said it", () => {
    expect(
      topicLastLine(card({ lastMessage: { id: "m:1", from: "mate", text: "Draft is\nready.", at: "2026-09-22T08:00:00.000Z" } })),
    ).toBe("First mate: Draft is ready.");
    expect(
      topicLastLine(
        card({ agent: agent(), lastMessage: { id: "a:1", from: "agent", text: "Two of three done.", at: "2026-09-22T08:00:00.000Z" } }),
      ),
    ).toBe("Login test fixer: Two of three done.");
  });

  it("falls back to the agent's report, the outcome, what it waits for, then where it stands", () => {
    expect(topicLastLine(card({ agent: agent(), report: { state: "working", text: "working: on the retry" } }))).toBe(
      "Login test fixer: working: on the retry",
    );
    expect(topicLastLine(card({ backlog: item({ section: "done", outcome: "merged 2026-09-21" }) }))).toBe("Merged 21 Sep.");
    expect(topicLastLine(card({ column: "queued", backlog: item({ section: "queued", blockedBy: "pick-db" }) }))).toBe(
      "Waits for pick-db.",
    );
    expect(topicLastLine(card({ column: "queued", backlog: item({ section: "queued" }) }))).toBe("Not started.");
    expect(topicLastLine(card())).toBeNull();
  });
});

describe("the Done column", () => {
  it("shows the newest finished topics, by the date of their outcome, and counts the rest", () => {
    const done = Array.from({ length: DONE_SHOWN + 2 }, (_, index) =>
      card({
        key: `d${index}`,
        column: "done",
        backlog: item({ section: "done", id: `d${index}`, outcome: `merged 2026-09-${String(index + 1).padStart(2, "0")}` }),
      }),
    );
    const { shown, older } = shownDone(done);
    expect(shown).toHaveLength(DONE_SHOWN);
    expect(shown[0]?.key).toBe(`d${DONE_SHOWN + 1}`);
    expect(older).toBe(2);
  });

  it("shows as many more as the captain asked for", () => {
    const done = Array.from({ length: 25 }, (_, index) =>
      card({ key: `d${index}`, column: "done", backlog: item({ section: "done", id: `d${index}` }) }),
    );
    expect(shownDone(done, 20)).toMatchObject({ older: 5 });
    expect(shownDone(done, 20).shown).toHaveLength(20);
    expect(shownDone(done, 30)).toMatchObject({ older: 0 });
  });

  it("counts what finished in the last days, by the date of the outcome", () => {
    const finished = (outcome: string | null) => card({ column: "done", backlog: item({ section: "done", outcome }) });
    const cards = [finished("merged 2026-09-21"), finished("done 2026-09-15"), finished("merged 2026-09-14"), finished(null), card()];
    expect(doneRecently(cards, new Date(2026, 8, 21, 18))).toBe(2);
  });

  it("counts the seven days by the captain's own calendar, not the UTC one", () => {
    const finished = card({ column: "done", backlog: item({ section: "done", outcome: "merged 2026-09-15" }) });
    // Late on the 21st where the captain is, whatever the UTC day: the 15th is six days back.
    expect(doneRecently([finished], new Date(2026, 8, 21, 23, 30))).toBe(1);
    expect(doneRecently([finished], new Date(2026, 8, 22, 0, 30))).toBe(0);
  });

  it("keeps the file's order for topics with no dated outcome", () => {
    const done = ["a", "b"].map((key) => card({ key, column: "done", backlog: item({ section: "done", id: key }) }));
    expect(shownDone(done).shown.map((each) => each.key)).toEqual(["a", "b"]);
  });
});

describe("who a topic talks to", () => {
  it("is its own agent, by title and short id, or the first mate", () => {
    expect(talkingTo(card({ agent: agent() }))).toBe("Login test fixer (3f2a9c11)");
    expect(talkingTo(card())).toBe("First mate");
  });
});

describe("the sidebar row's badge", () => {
  it("counts the topics that wait on the captain", () => {
    expect(needsYouCount([card({ backlog: item({ hold: "A or B?" }) }), card(), card({ column: "failed" })])).toBe(2);
  });
});

describe("a topic's unread dot", () => {
  const said = (from: "mate" | "agent" | "captain") => ({ id: "m:1", from, text: "Hi", at: "2026-09-22T08:00:00.000Z" });

  it("shows for words from someone else that are newer than the read mark, with or without an agent", () => {
    expect(topicUnread(card({ lastMessage: said("mate") }), {})).toBe(true);
    expect(topicUnread(card({ agent: agent(), lastMessage: said("agent") }), {})).toBe(true);
    expect(topicUnread(card({ lastMessage: said("mate") }), { "fix-flaky-login": "2026-09-22T08:00:00.000Z" })).toBe(false);
    expect(topicUnread(card({ lastMessage: said("captain") }), {})).toBe(false);
  });

  it("goes by the agent's own flag when the card has no message", () => {
    expect(topicUnread(card({ agent: agent({ requiresAttention: true }) }), {})).toBe(true);
    expect(topicUnread(card(), {})).toBe(false);
  });
});

describe("a topic's thread", () => {
  function entry(seqStart: number, item: Record<string, unknown>, timestamp: string): TimelineEntry {
    return { seqStart, seqEnd: seqStart, timestamp, item } as unknown as TimelineEntry;
  }

  it("is the words between the captain and the agent, without tool calls or injected notes, with the filed messages in time order", () => {
    const entries = [
      entry(1, { type: "user_message", text: "Where are we?" }, "2026-09-22T08:00:00.000Z"),
      entry(2, { type: "tool_call", name: "shell", status: "completed", detail: { type: "shell", command: "ls" } }, "2026-09-22T08:00:01.000Z"),
      entry(3, { type: "assistant_message", text: "Two of three " }, "2026-09-22T08:00:02.000Z"),
      entry(4, { type: "assistant_message", text: "done." }, "2026-09-22T08:00:03.000Z"),
      entry(5, { type: "user_message", text: "<paseo-system>\nAgent finished.\n</paseo-system>" }, "2026-09-22T08:00:04.000Z"),
    ];
    const filed = [{ id: "mate:9", from: "mate" as const, text: "I asked the fixer to start.", at: "2026-09-22T07:00:00.000Z" }];
    expect(threadMessages(filed, entries, "ag")).toEqual([
      filed[0],
      { id: "ag:1", from: "captain", text: "Where are we?", at: "2026-09-22T08:00:00.000Z" },
      { id: "ag:3", from: "agent", text: "Two of three done.", at: "2026-09-22T08:00:02.000Z" },
    ]);
  });
});
