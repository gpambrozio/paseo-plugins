import { describe, expect, it, vi, type Mock } from "vitest";
import type { PaseoApi } from "./host-types";
import type {
  PluginHookAgent,
  PluginHookContext,
  PluginLifecycleEvents,
  PluginLifecycleRegistration,
} from "@getpaseo/plugin/server";
import type { AgentPermissionRequest, AgentTimelineItem } from "./host-types";

import { DEFAULT_CONFIG, DEFAULT_SUMMARY_PROMPT, type AttentionEntry, type HeraldConfig } from "../shared/herald";
import { registerHooks, type HookDeps } from "./hooks";
import { AttentionStore } from "./store";
import { HELPER_TITLE, type Summary, type SummaryRequest, type SummarizerDeps } from "./summarize";

type Handler<Name extends keyof PluginLifecycleEvents> = (
  event: PluginLifecycleEvents[Name],
  context: PluginHookContext,
) => void | Promise<void>;
type Handlers = { [Name in keyof PluginLifecycleEvents]?: Handler<Name> };

function fakeServer(): { server: PluginLifecycleRegistration; emit: <Name extends keyof PluginLifecycleEvents>(name: Name, event: PluginLifecycleEvents[Name]) => Promise<void> } {
  const handlers: Handlers = {};
  const context = { paseo: {} as PaseoApi, signal: new AbortController().signal };
  const server = {
    on(name: keyof PluginLifecycleEvents, handler: Handler<keyof PluginLifecycleEvents>) {
      (handlers as Record<string, unknown>)[name] = handler;
      return () => {
        delete (handlers as Record<string, unknown>)[name];
      };
    },
    before() {
      return () => {};
    },
  } as unknown as PluginLifecycleRegistration;
  return {
    server,
    async emit(name, event) {
      const handler = handlers[name] as Handler<typeof name> | undefined;
      if (handler === undefined) throw new Error(`no handler for ${name}`);
      await handler(event, context);
    },
  };
}

const agent: PluginHookAgent = {
  id: "a1",
  workspaceId: "w1",
  parentAgentId: null,
  provider: "claude",
  cwd: "/repo",
  title: "Login fix",
};

const question: AgentPermissionRequest = {
  id: "p1",
  provider: "claude",
  name: "AskUserQuestion",
  kind: "question",
  title: "Which DB?",
  input: { questions: [{ question: "Which DB?", options: [{ label: "Postgres" }, { label: "SQLite" }] }] },
};

const timeline: AgentTimelineItem[] = [
  { type: "user_message", text: "Fix the login bug" },
  { type: "assistant_message", text: "I fixed auth.ts and added a test." },
];

/** Lets detached summaries and their store updates run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

type SummarizeMock = Mock<(request: SummaryRequest, deps: SummarizerDeps) => Promise<Summary>>;
type RunningMock = Mock<(paseo: PaseoApi, agentId: string) => Promise<boolean>>;

function setup(
  overrides: Partial<Omit<HookDeps, "summarize" | "isRunning">> & {
    summarize?: SummarizeMock;
    isRunning?: RunningMock;
  } = {},
  config: HeraldConfig = DEFAULT_CONFIG,
) {
  const store = new AttentionStore(null);
  const summarize: SummarizeMock =
    overrides.summarize ??
    vi.fn(async (_request: SummaryRequest, _deps: SummarizerDeps): Promise<Summary> => ({
      text: "Login fix asks which database to use: Postgres or SQLite.",
      model: "claude/claude-haiku-4-5",
    }));
  const publish = vi.fn(
    async (_paseo: PaseoApi, _entry: AttentionEntry, _options?: { superseded?: boolean }) => {},
  );
  const { server, emit } = fakeServer();
  const cleanup = registerHooks(server, {
    store,
    readConfig: async () => config,
    workspaceTitle: async (workspaceId) => (workspaceId === "w1" ? "Shop" : null),
    // Not running unless a test says so, so the existing ones are unaffected.
    isRunning: async () => false,
    publish,
    ...overrides,
    summarize,
  });
  return { store, summarize, publish, emit, cleanup };
}

describe("registerHooks", () => {
  it("records a question as pending, then fills in the summary", async () => {
    let release: (summary: Summary) => void = () => {};
    const { store, summarize, emit } = setup({
      summarize: vi.fn(
        () =>
          new Promise<Summary>((resolve) => {
            release = resolve;
          }),
      ),
    });
    await emit("agent.permission_requested", { agent, request: question });
    expect(store.get("a1")).toMatchObject({
      reason: "question",
      requestId: "p1",
      workspaceTitle: "Shop",
      headline: "Which DB?",
      detail: "Postgres / SQLite",
      summary: { status: "pending" },
    });
    release({ text: "Login fix asks which database to use: Postgres or SQLite.", model: "claude/claude-haiku-4-5" });
    await settle();
    expect(store.get("a1")?.summary).toEqual({
      status: "ready",
      text: "Login fix asks which database to use: Postgres or SQLite.",
      model: "claude/claude-haiku-4-5",
    });
    const [request, deps] = summarize.mock.calls[0] ?? [];
    expect(request).toMatchObject({
      reason: "question",
      agent: { id: "a1", workspaceId: "w1", workspaceTitle: "Shop" },
      output: "",
    });
    expect(deps).toMatchObject({
      provider: "claude/claude-haiku-4-5",
      timeoutMs: 90_000,
      prompt: DEFAULT_SUMMARY_PROMPT,
      deleteHelper: true,
    });
  });

  it("passes the user's choice about keeping helper sessions to the summariser", async () => {
    const config: HeraldConfig = { ...DEFAULT_CONFIG, cleanup: { deleteHelpers: false } };
    const { summarize, emit } = setup({}, config);
    await emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await settle();
    expect(summarize.mock.calls[0]?.[1]).toMatchObject({ deleteHelper: false });
  });

  it("remembers the helper it created, so the sweep does not delete one mid-sentence", async () => {
    const liveHelpers = new Set<string>();
    const { emit } = setup({
      liveHelpers,
      summarize: vi.fn(async (_request: SummaryRequest, deps: SummarizerDeps) => {
        deps.onHelperCreated?.("h1");
        return { text: "Summary.", model: "m" };
      }),
    });
    await emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await settle();
    expect(liveHelpers.has("h1")).toBe(true);
  });

  it("puts a card in the transcript when recorded and again when the summary lands", async () => {
    let release: (summary: Summary) => void = () => {};
    const { publish, emit } = setup({
      summarize: vi.fn(
        () =>
          new Promise<Summary>((resolve) => {
            release = resolve;
          }),
      ),
    });
    await emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    expect(publish.mock.calls.map((call) => call[1].summary.status)).toEqual(["pending"]);
    release({ text: "Shop finished the login fix.", model: "m" });
    await settle();
    expect(publish.mock.calls.map((call) => call[1].summary.status)).toEqual(["pending", "ready"]);
    expect(publish.mock.calls[1]?.[1]).toMatchObject({
      eventId: "a1:turn:t1",
      workspaceTitle: "Shop",
      summary: { status: "ready", text: "Shop finished the login fix." },
    });

    const failing = setup({
      summarize: vi.fn(async () => {
        throw new Error("provider down");
      }),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await failing.emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await settle();
    errorSpy.mockRestore();
    expect(failing.publish.mock.calls.map((call) => call[1].summary.status)).toEqual(["pending", "failed"]);
  });

  it("turns a finished turn into an entry and ignores a silent one", async () => {
    const { store, summarize, emit } = setup();
    await emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    expect(store.get("a1")).toMatchObject({
      reason: "finished",
      headline: "Finished",
      detail: "I fixed auth.ts and added a test.",
      eventId: "a1:turn:t1",
      lastRequest: "Fix the login bug",
    });
    await settle();
    expect(summarize.mock.calls[0]?.[0]).toMatchObject({
      output: "I fixed auth.ts and added a test.",
      lastUser: "Fix the login bug",
    });

    const quiet = setup();
    await quiet.emit("agent.turn_ended", {
      agent,
      turnId: "t2",
      outcome: { kind: "completed" },
      timeline: [{ type: "user_message", text: "compact" }],
    });
    expect(quiet.store.get("a1")).toBeNull();
    expect(quiet.summarize).not.toHaveBeenCalled();
  });

  it("names failed and canceled turns", async () => {
    const { store, emit } = setup();
    await emit("agent.turn_ended", {
      agent,
      turnId: "t1",
      outcome: { kind: "failed", error: { message: "Out of credits" } },
      timeline: [],
    });
    expect(store.get("a1")).toMatchObject({ reason: "error", headline: "Out of credits", detail: null });
    await emit("agent.turn_ended", { agent, turnId: "t2", outcome: { kind: "canceled", reason: "" }, timeline: [] });
    expect(store.get("a1")).toMatchObject({ reason: "canceled", headline: "The turn was canceled" });
  });

  it("does not announce the failure that follows the user's own interrupting deny", async () => {
    const { store, summarize, emit } = setup();
    await emit("agent.permission_requested", { agent, request: question });
    await emit("agent.permission_resolved", {
      agent,
      requestId: "p1",
      resolution: { behavior: "deny", interrupt: true, message: "stop" },
    });
    await emit("agent.turn_ended", {
      agent,
      turnId: "t1",
      outcome: { kind: "failed", error: { message: "[ede_diagnostic] stop_reason=tool_use" } },
      timeline: [],
    });
    await settle();
    expect(store.get("a1")).toBeNull();
    expect(summarize).toHaveBeenCalledTimes(1);

    // A plain deny lets the agent carry on; a failure after that is a real one.
    await emit("agent.permission_requested", { agent, request: { ...question, id: "p2" } });
    await emit("agent.permission_resolved", { agent, requestId: "p2", resolution: { behavior: "deny" } });
    await emit("agent.turn_ended", {
      agent,
      turnId: "t2",
      outcome: { kind: "failed", error: { message: "Out of credits" } },
      timeline: [],
    });
    expect(store.get("a1")).toMatchObject({ reason: "error", headline: "Out of credits" });
  });

  it("drops what it learned when the agent moved on while it was loading", async () => {
    let releaseConfig: (config: HeraldConfig) => void = () => {};
    function heldConfig(): Promise<HeraldConfig> {
      return new Promise<HeraldConfig>((resolve) => {
        releaseConfig = resolve;
      });
    }

    // A question answered while the config and workspace title were loading.
    const answered = setup({ readConfig: heldConfig });
    const askedThenAnswered = answered.emit("agent.permission_requested", { agent, request: question });
    await answered.emit("agent.permission_resolved", { agent, requestId: "p1", resolution: { behavior: "allow" } });
    releaseConfig(DEFAULT_CONFIG);
    await askedThenAnswered;
    await settle();
    expect(answered.store.get("a1")).toBeNull();
    expect(answered.summarize).not.toHaveBeenCalled();
    expect(answered.publish).not.toHaveBeenCalled();

    // A turn the user replied to while the same loading was in flight.
    const replied = setup({ readConfig: heldConfig });
    const ended = replied.emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await replied.emit("agent.turn_started", { agent, turnId: "t2" });
    releaseConfig(DEFAULT_CONFIG);
    await ended;
    await settle();
    expect(replied.store.get("a1")).toBeNull();
    expect(replied.summarize).not.toHaveBeenCalled();

    // A different pending question is not collateral damage.
    const other = setup({ readConfig: heldConfig });
    const asked = other.emit("agent.permission_requested", { agent, request: question });
    await other.emit("agent.permission_resolved", { agent, requestId: "p9", resolution: { behavior: "allow" } });
    releaseConfig(DEFAULT_CONFIG);
    await asked;
    await settle();
    expect(other.store.get("a1")).toMatchObject({ requestId: "p1" });
  });

  it("says nothing and takes the card back when the agent outran the summary", async () => {
    // A turn reported as finished, and the agent is working again by the time
    // the summary comes back.
    const running = setup({ isRunning: vi.fn(async () => true) });
    await running.emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await settle();
    expect(running.store.get("a1")).toBeNull();
    const cards = running.publish.mock.calls.map((call) => [call[1].summary.status, call[2]?.superseded]);
    expect(cards).toEqual([
      ["pending", undefined],
      ["off", true],
    ]);

    // The same when a new turn started, which needs no daemon round trip.
    const restarted = setup({
      isRunning: vi.fn(async () => false),
      summarize: vi.fn(async (_request: SummaryRequest, _deps: SummarizerDeps) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { text: "Never said.", model: "m" };
      }),
    });
    await restarted.emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await restarted.emit("agent.turn_started", { agent, turnId: "t2" });
    await settle();
    expect(restarted.store.get("a1")).toBeNull();
    expect(restarted.publish.mock.calls.at(-1)?.[2]?.superseded).toBe(true);

    // An agent that really did stop keeps its summary.
    const stopped = setup({ isRunning: vi.fn(async () => false) });
    await stopped.emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await settle();
    expect(stopped.store.get("a1")?.summary.status).toBe("ready");
    expect(stopped.publish.mock.calls.at(-1)?.[2]?.superseded).toBeUndefined();
  });

  it("asks the daemon only about a finish, and re-reads the turn after asking", async () => {
    // Every unanswered question is a *running* agent — Paseo reports
    // `status: "running"` with the request pending — so asking the daemon
    // about one would suppress the very thing the plugin is for.
    const isRunning = vi.fn(async () => true);
    const asking = setup({ isRunning });
    await asking.emit("agent.permission_requested", { agent, request: question });
    await settle();
    expect(isRunning).not.toHaveBeenCalled();
    expect(asking.store.get("a1")?.summary.status).toBe("ready");
    expect(asking.publish.mock.calls.at(-1)?.[2]?.superseded).toBeUndefined();

    // A turn that starts while the running check is in flight, answered by a
    // snapshot that predates it.
    let startTurn: (() => Promise<void>) | null = null;
    const raced = setup({
      isRunning: vi.fn(async () => {
        await startTurn?.();
        return false;
      }),
    });
    startTurn = () => raced.emit("agent.turn_started", { agent, turnId: "t2" });
    await raced.emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await settle();
    expect(raced.store.get("a1")).toBeNull();
    expect(raced.publish.mock.calls.at(-1)?.[2]?.superseded).toBe(true);
  });

  it("completes the transcript card when a queued summary is superseded", async () => {
    const releases: Array<(summary: Summary) => void> = [];
    const { store, publish, emit } = setup({
      // One at a time, so the second agent's summary is still queued when its
      // agent moves on — which is the only way to reach that branch.
      maxConcurrent: 1,
      summarize: vi.fn(
        () =>
          new Promise<Summary>((resolve) => {
            releases.push(resolve);
          }),
      ),
    });
    const second: PluginHookAgent = { ...agent, id: "a2" };
    await emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await emit("agent.turn_ended", { agent: second, turnId: "t1", outcome: { kind: "completed" }, timeline });
    // The user replies to the queued one before its summary ever starts.
    await emit("agent.turn_started", { agent: second, turnId: "t2" });
    releases[0]?.({ text: "Shop finished the login fix.", model: "m" });
    await settle();

    const cards = publish.mock.calls.map((call) => ({
      agentId: call[1].agentId,
      status: call[1].summary.status,
    }));
    expect(cards).toEqual([
      { agentId: "a1", status: "pending" },
      { agentId: "a2", status: "pending" },
      { agentId: "a1", status: "ready" },
      // Completed rather than left reading "Writing the summary…" for ever.
      { agentId: "a2", status: "off" },
    ]);
    const superseded = publish.mock.calls[3]?.[1];
    expect(superseded?.summary).toEqual({
      status: "off",
      fallback: "Login fix finished. I fixed auth.ts and added a test.",
    });
    expect(store.get("a2")).toBeNull();
  });

  it("drops a repeated turn_ended for the same turn", async () => {
    const { summarize, emit } = setup();
    const event = { agent, turnId: "t1", outcome: { kind: "completed" as const }, timeline };
    await emit("agent.turn_ended", event);
    await emit("agent.turn_ended", event);
    await settle();
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("ignores its own helpers, by reported id and by title", async () => {
    const { store, summarize, emit } = setup({
      summarize: vi.fn(async (_request: SummaryRequest, deps: SummarizerDeps) => {
        deps.onHelperCreated?.("h1");
        return { text: "Summary.", model: "m" };
      }),
    });
    await emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await settle();
    const byId: PluginHookAgent = { ...agent, id: "h1", title: null, parentAgentId: "a1" };
    const byTitle: PluginHookAgent = { ...agent, id: "h2", title: HELPER_TITLE, parentAgentId: "a1" };
    await emit("agent.turn_ended", { agent: byId, turnId: "t9", outcome: { kind: "completed" }, timeline });
    await emit("agent.turn_ended", { agent: byTitle, turnId: "t8", outcome: { kind: "completed" }, timeline });
    await emit("agent.turn_started", { agent: byTitle, turnId: "t8" });
    await settle();
    expect(store.list().map((entry) => entry.agentId)).toEqual(["a1"]);
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("records without summarising when the event kind is switched off", async () => {
    const config: HeraldConfig = { ...DEFAULT_CONFIG, announce: { ...DEFAULT_CONFIG.announce, finished: false } };
    const { store, summarize, publish, emit } = setup({}, config);
    await emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await settle();
    expect(store.get("a1")?.summary).toEqual({
      status: "off",
      fallback: "Login fix finished. I fixed auth.ts and added a test.",
    });
    expect(summarize).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("leaves an agent another agent started to the one that started it", async () => {
    const child: PluginHookAgent = { ...agent, parentAgentId: "mate" };
    const { store, summarize, publish, emit } = setup();
    await emit("agent.turn_ended", { agent: child, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await settle();
    expect(store.get("a1")?.summary).toEqual({
      status: "off",
      fallback: "Login fix finished. I fixed auth.ts and added a test.",
    });
    expect(summarize).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  // Known gap, kept on purpose: a parent id is not a subscription. Paseo stops
  // notifying the parent after the child's first finish, and never starts for a
  // child created without notifyOnFinish, but the hook payload says neither.
  it("mutes a subagent's later turns too, though its parent is no longer told", async () => {
    const child: PluginHookAgent = { ...agent, parentAgentId: "mate" };
    const { store, summarize, publish, emit } = setup();
    await emit("agent.turn_ended", { agent: child, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await emit("agent.turn_started", { agent: child, turnId: "t2" });
    await emit("agent.turn_ended", { agent: child, turnId: "t2", outcome: { kind: "completed" }, timeline });
    await settle();
    expect(store.get("a1")?.summary.status).toBe("off");
    expect(summarize).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("mutes a subagent whatever it waits on, though its parent may never be told", async () => {
    const child: PluginHookAgent = { ...agent, parentAgentId: "mate" };
    const { store, summarize, publish, emit } = setup();
    await emit("agent.permission_requested", { agent: child, request: question });
    await settle();
    expect(store.get("a1")?.summary.status).toBe("off");
    expect(summarize).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("announces subagents too when the user asks for them", async () => {
    const child: PluginHookAgent = { ...agent, parentAgentId: "mate" };
    const config: HeraldConfig = { ...DEFAULT_CONFIG, subagents: { announce: true } };
    const { store, summarize, emit } = setup({}, config);
    await emit("agent.permission_requested", { agent: child, request: question });
    await settle();
    expect(summarize).toHaveBeenCalledOnce();
    expect(store.get("a1")?.summary.status).toBe("ready");
  });

  it("clears an entry when the agent moves on", async () => {
    const { store, emit } = setup();
    await emit("agent.permission_requested", { agent, request: question });
    await emit("agent.permission_resolved", { agent, requestId: "other", resolution: { behavior: "allow" } });
    expect(store.get("a1")).not.toBeNull();
    await emit("agent.permission_resolved", { agent, requestId: "p1", resolution: { behavior: "allow" } });
    expect(store.get("a1")).toBeNull();

    await emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await emit("agent.turn_started", { agent, turnId: "t2" });
    expect(store.get("a1")).toBeNull();

    await emit("agent.turn_ended", { agent, turnId: "t3", outcome: { kind: "completed" }, timeline });
    await emit("agent.archived", { agent, archivedAt: "now" });
    expect(store.get("a1")).toBeNull();
  });

  it("keeps the fallback when the summary fails, and never overwrites a newer event", async () => {
    const failing = setup({
      summarize: vi.fn(async () => {
        throw new Error("provider down");
      }),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await failing.emit("agent.permission_requested", { agent, request: question });
    await settle();
    expect(failing.store.get("a1")?.summary).toEqual({
      status: "failed",
      error: "provider down",
      fallback: "Login fix has a question: Which DB? Options: Postgres / SQLite.",
    });
    errorSpy.mockRestore();

    const releases: Array<(summary: Summary) => void> = [];
    const slow = setup({
      summarize: vi.fn(
        () =>
          new Promise<Summary>((resolve) => {
            releases.push(resolve);
          }),
      ),
    });
    await slow.emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await slow.emit("agent.turn_started", { agent, turnId: "t2" });
    await slow.emit("agent.turn_ended", {
      agent,
      turnId: "t2",
      outcome: { kind: "failed", error: { message: "boom" } },
      timeline,
    });
    releases[0]?.({ text: "Stale.", model: "m" });
    await settle();
    expect(slow.store.get("a1")).toMatchObject({ reason: "error", eventId: "a1:turn:t2" });
    expect(slow.store.get("a1")?.summary.status).toBe("pending");
    releases[1]?.({ text: "Fresh.", model: "m" });
    await settle();
    expect(slow.store.get("a1")?.summary).toEqual({ status: "ready", text: "Fresh.", model: "m" });
  });

  it("runs at most the configured number of summaries at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const { emit } = setup({
      maxConcurrent: 1,
      summarize: vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return { text: "S.", model: "m" };
      }),
    });
    await emit("agent.turn_ended", { agent, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await emit("agent.turn_ended", { agent: { ...agent, id: "a2" }, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await emit("agent.turn_ended", { agent: { ...agent, id: "a3" }, turnId: "t1", outcome: { kind: "completed" }, timeline });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peak).toBe(1);
  });
});
