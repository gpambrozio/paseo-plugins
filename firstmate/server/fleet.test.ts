import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CREW_LABELS, FirstmateConfigSchema, type AgentSummary, type BacklogItem } from "../shared/fleet";
import { parseBacklog } from "./backlog";
import { ReportCache, backlogColumn, buildCards, closingMessage, closingText, crewColumn, loadFleet, ownAgentIds } from "./fleet";
import type { PaseoApi, TimelineItem } from "./host-types";
import type { TopicLog } from "./topic-log";

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
    actions: [],
    notes: [],
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

describe("buildCards' last message", () => {
  const backlog = parseBacklog(`## In flight
- [ ] fix-login - Fix the login (project: web)
## Queued
- [ ] next - Next thing
- [ ] quiet - Nothing said yet
`);
  const said = (text: string) => ({ id: "m1:4", from: "mate" as const, text, at: "2026-09-22T10:00:00.000Z" });

  it("gives a card the newest message filed under its backlog item, whether or not a crewmate is on it", () => {
    const cards = buildCards(
      backlog,
      [{ agent: agent(), report: null }],
      new Map([
        ["fix-login", said("Tests pass.")],
        ["next", said("Queued behind login.")],
        ["gone", said("About nothing on the board.")],
      ]),
    );
    expect(cards.map((card) => [card.taskId, card.lastMessage?.text ?? null])).toEqual([
      ["fix-login", "Tests pass."],
      ["next", "Queued behind login."],
      ["quiet", null],
    ]);
  });
});

describe("buildCards' agent message", () => {
  const backlog = parseBacklog("## In flight\n- [ ] fix-login - Fix the login (agent: a1)\n");
  const closing = (at: string) => ({ id: "a1:9", from: "agent" as const, text: "Tests pass; waiting on you.", at });
  const said = { id: "m1:4", from: "mate" as const, text: "Queued.", at: "2026-09-22T10:00:00.000Z" };
  const lastOf = (member: { report: { state: "done"; text: string } | null; closing: ReturnType<typeof closing> | null }, latest = new Map<string, typeof said>()) =>
    buildCards(backlog, [{ agent: agent(), ...member }], latest)[0]?.lastMessage ?? null;

  it("gives a card with no status line what its agent last said", () => {
    expect(lastOf({ report: null, closing: closing("2026-09-22T11:00:00.000Z") })?.from).toBe("agent");
  });

  it("leaves a card with a status line to the status line", () => {
    expect(lastOf({ report: { state: "done", text: "PR" }, closing: closing("2026-09-22T11:00:00.000Z") })).toBeNull();
  });

  it("shows the newer of the agent's words and the first mate's", () => {
    const latest = new Map([["fix-login", said]]);
    expect(lastOf({ report: null, closing: closing("2026-09-22T11:00:00.000Z") }, latest)?.from).toBe("agent");
    expect(lastOf({ report: null, closing: closing("2026-09-22T09:00:00.000Z") }, latest)?.from).toBe("mate");
  });
});

describe("closingMessage", () => {
  it("is the closing text with where it started and when", () => {
    const entry = (seqStart: number, timestamp: string, item: unknown) => ({ seqStart, timestamp, item }) as never;
    expect(
      closingMessage("a1", [
        entry(1, "2026-09-22T10:00:00.000Z", { type: "user_message", text: "go" }),
        entry(2, "2026-09-22T10:01:00.000Z", { type: "assistant_message", text: "All " }),
        entry(3, "2026-09-22T10:02:00.000Z", { type: "assistant_message", text: "green." }),
      ]),
    ).toEqual({ id: "a1:2", from: "agent", text: "All green.", at: "2026-09-22T10:01:00.000Z" });
    expect(closingMessage("a1", [entry(1, "2026-09-22T10:00:00.000Z", { type: "user_message", text: "go" })])).toBeNull();
  });
});

describe("ownAgentIds", () => {
  const OWN = "3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f";
  const backlog = parseBacklog(`## In flight
- [ ] own - Has its own agent (agent: ${OWN})
- [ ] crewed - Already on the crew (agent: a1)
- [ ] prefix - A prefix only (agent: 3f2a9c1e)
- [ ] remote - Another daemon (agent: ${OWN.replace("3f2a", "9999")} on srv_abc)
## Done
- [x] finished - Done long ago (agent: 0a1b2c3d-5b7d-4e8a-9c0f-1a2b3c4d5e6f)
`);

  it("names the full UUIDs of unfinished items that no crewmate already covers, once each", () => {
    expect(ownAgentIds(backlog, new Set(["a1"]))).toEqual([OWN]);
    expect(ownAgentIds([...backlog, ...backlog], new Set())).toEqual([OWN]);
    expect(ownAgentIds(backlog, new Set([OWN]))).toEqual([]);
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

describe("loadFleet's topics", () => {
  it("turns a failed filing into a board warning and still draws the board", async () => {
    const home = await mkdtemp(join(tmpdir(), "fm-fleet-"));
    const mate = { id: "m1", status: "idle", cwd: home, updatedAt: "t1", archivedAt: null, labels: {}, pendingPermissions: [] };
    const paseo = {
      agents: {
        async list() {
          return { entries: [], pageInfo: { nextCursor: null, hasMore: false } };
        },
        ref: () => ({ async refresh() { return { agent: mate }; } }),
      },
      config: { async get() { return { config: { mcp: { injectIntoAgents: true } } }; } },
    } as unknown as PaseoApi;
    const topics = { sync: async () => { throw new Error("disk full"); }, latest: async () => new Map() } as unknown as TopicLog;
    const config = FirstmateConfigSchema.parse({ home, mateAgentId: "m1" });

    const fleet = await loadFleet(paseo, config, new ReportCache(), async () => [], topics);

    expect(fleet.warnings).toEqual(["The topics could not be filed: disk full"]);
    expect(fleet.mate?.id).toBe("m1");
  });

  it("draws an unfinished item's own live agent as its card's agent, and ignores one Paseo has gone", async () => {
    const OWN = "3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f";
    const GONE = "9a8b7c6d-5b7d-4e8a-9c0f-1a2b3c4d5e6f";
    const home = await mkdtemp(join(tmpdir(), "fm-fleet-"));
    await mkdir(join(home, "data"));
    await writeFile(
      join(home, "data", "backlog.md"),
      `## In flight\n- [ ] fix-flaky-login - Fix the login (agent: ${OWN})\n- [ ] add-dark-mode - Dark mode (agent: ${GONE})\n`,
    );
    const live = { id: OWN, title: "Login fixer", status: "running", cwd: "/wt/login", updatedAt: "t1", archivedAt: null, labels: {}, pendingPermissions: [] };
    const paseo = {
      agents: {
        async list() {
          return { entries: [], pageInfo: { nextCursor: null, hasMore: false } };
        },
        ref: (id: string) => ({
          async refresh() {
            if (id === OWN) return { agent: live };
            throw new Error(`Agent not found: ${id}`);
          },
        }),
      },
      config: { async get() { return { config: { mcp: { injectIntoAgents: true } } }; } },
    } as unknown as PaseoApi;

    const fleet = await loadFleet(paseo, FirstmateConfigSchema.parse({ home }), new ReportCache());

    expect(fleet.warnings).toEqual([]);
    expect(fleet.cards.map((card) => [card.taskId, card.agent?.id ?? null, card.column])).toEqual([
      ["fix-flaky-login", OWN, "working"],
      ["add-dark-mode", null, "idle"],
    ]);
  });

  it("never turns the first mate into an item's agent, even when a backlog line names it", async () => {
    const MATE = "3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f";
    const home = await mkdtemp(join(tmpdir(), "fm-fleet-"));
    await mkdir(join(home, "data"));
    await writeFile(join(home, "data", "backlog.md"), `## In flight\n- [ ] fix-flaky-login - Fix the login (agent: ${MATE})\n`);
    const mate = { id: MATE, title: "First mate", status: "idle", cwd: home, updatedAt: "t1", archivedAt: null, labels: {}, pendingPermissions: [] };
    const paseo = {
      agents: {
        async list() {
          return { entries: [], pageInfo: { nextCursor: null, hasMore: false } };
        },
        ref: () => ({ async refresh() { return { agent: mate }; } }),
      },
      config: { async get() { return { config: { mcp: { injectIntoAgents: true } } }; } },
    } as unknown as PaseoApi;

    const fleet = await loadFleet(paseo, FirstmateConfigSchema.parse({ home, mateAgentId: MATE }), new ReportCache());

    expect(fleet.cards.map((card) => [card.taskId, card.agent])).toEqual([["fix-flaky-login", null]]);
  });
});
