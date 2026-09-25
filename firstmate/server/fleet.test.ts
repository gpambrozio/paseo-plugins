import { describe, expect, it } from "vitest";

import { CREW_LABELS, type AgentSummary, type BacklogItem } from "../shared/fleet";
import { parseBacklog } from "./backlog";
import { backlogColumn, buildCards, closingText, crewColumn } from "./fleet";
import type { TimelineItem } from "./host-types";

function agent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: "a1",
    workspaceId: "w1",
    title: "Fix login",
    provider: "claude",
    model: "sonnet",
    status: "idle",
    cwd: "/wt/fix-login",
    pendingPermissions: 0,
    requiresAttention: false,
    lastError: null,
    updatedAt: "2026-09-22T10:00:00.000Z",
    labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole, [CREW_LABELS.task]: "fix-login" },
    ...overrides,
  };
}

describe("crewColumn", () => {
  it("lets what Paseo knows win while the agent is busy or stuck", () => {
    const done = { state: "done" as const, text: "PR" };
    expect(crewColumn(agent({ pendingPermissions: 1, status: "running" }), done)).toBe("blocked");
    expect(crewColumn(agent({ status: "error" }), done)).toBe("failed");
    expect(crewColumn(agent({ status: "running" }), done)).toBe("working");
  });

  it("files a stopped crewmate by its status line", () => {
    expect(crewColumn(agent(), { state: "done", text: "" })).toBe("idle");
    expect(crewColumn(agent(), { state: "resolved", text: "" })).toBe("idle");
    expect(crewColumn(agent(), { state: "blocked", text: "" })).toBe("blocked");
    expect(crewColumn(agent(), { state: "needs-decision", text: "" })).toBe("blocked");
    expect(crewColumn(agent(), { state: "paused", text: "" })).toBe("parked");
    expect(crewColumn(agent(), { state: "failed", text: "" })).toBe("failed");
    expect(crewColumn(agent(), { state: "working", text: "" })).toBe("idle");
    expect(crewColumn(agent(), null)).toBe("idle");
  });
});

describe("backlogColumn", () => {
  const item = (overrides: Partial<BacklogItem>): BacklogItem => ({
    section: "queued",
    id: "x",
    title: "X",
    project: null,
    kind: null,
    mode: null,
    agentId: null,
    hold: null,
    blockedBy: null,
    since: null,
    url: null,
    reportPath: null,
    outcome: null,
    ...overrides,
  });

  it("puts a captain's hold with the blocked work and everything else where its section says", () => {
    expect(backlogColumn(item({ kind: "captain" }))).toBe("blocked");
    expect(backlogColumn(item({ hold: "which?" }))).toBe("blocked");
    expect(backlogColumn(item({}))).toBe("queued");
    expect(backlogColumn(item({ section: "done" }))).toBe("done");
    expect(backlogColumn(item({ section: "in-flight" }))).toBe("idle");
  });
});

describe("buildCards", () => {
  const backlog = parseBacklog(`## In flight
- [ ] fix-login - Fix the login (project: web) (kind: ship)
- [ ] by-id - Found by agent id (agent: a2)
- [ ] orphan - Nobody on it
## Queued
- [ ] next - Next thing
## Done
- [x] fix-login - An older task with the same id https://github.com/o/r/pull/1 (merged 2026-09-01)
`);

  it("joins a crewmate to its item by task label or recorded agent id, and keeps the rest", () => {
    const cards = buildCards(backlog, [
      { agent: agent(), report: { state: "done", text: "PR https://github.com/o/r/pull/42" } },
      { agent: agent({ id: "a2", labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole } }), report: null },
      { agent: agent({ id: "a3", title: "Stray", labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole } }), report: null },
    ]);
    const byKey = new Map(cards.map((card) => [card.key, card]));

    expect(byKey.get("agent:a1")).toMatchObject({
      column: "idle",
      title: "Fix the login",
      project: "web",
      url: "https://github.com/o/r/pull/42",
    });
    expect(byKey.get("agent:a2")).toMatchObject({ taskId: "by-id", title: "Found by agent id" });
    expect(byKey.get("agent:a3")).toMatchObject({ taskId: null, title: "Stray", backlog: null });
    expect(cards.filter((card) => card.agent === null).map((card) => [card.taskId, card.column])).toEqual([
      ["orphan", "idle"],
      ["next", "queued"],
      ["fix-login", "done"],
    ]);
  });
});

describe("closingText", () => {
  it("joins the assistant messages that end the timeline, skipping late notices", () => {
    const items = [
      { type: "user_message", text: "go" },
      { type: "assistant_message", text: "earlier" },
      { type: "tool_call", callId: "c", name: "Bash", detail: { type: "shell", command: "ls" }, status: "completed", error: null },
      { type: "assistant_message", text: "All green.\n\ndo" },
      { type: "assistant_message", text: "ne: PR https://x/1" },
      { type: "notification", level: "info", message: "later" },
    ] as TimelineItem[];
    expect(closingText(items)).toBe("All green.\n\ndone: PR https://x/1");
    expect(closingText([{ type: "user_message", text: "hi" }] as TimelineItem[])).toBeNull();
  });
});
