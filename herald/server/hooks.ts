/**
 * Where events become entries. Four things every handler here has to get right:
 *
 * 1. **Return fast.** Paseo gives a hook 30 seconds and logs an error past
 *    that. A summary can take longer, so it is detached — the handler records
 *    a `pending` entry and returns; the summary lands later through the store.
 * 2. **Ignore our own helpers.** The summariser is a visible agent and fires
 *    these same hooks. It is known by the id `summarize` reports and by its
 *    title, either of which is enough — the id can be missed when `created`
 *    fires before `create()` resolves, and the title survives a plugin reload.
 * 3. **Dedupe `turn_ended`.** The docs say a turn id can repeat, and the `top`
 *    plugin has seen it fire twice for one turn; a repeat inside the window
 *    is dropped rather than summarised twice.
 * 4. **Follow the agent, not the plugin.** An entry lives until the hooks see
 *    the agent move on: a new turn, the permission answered, the agent
 *    archived. Paseo's own attention flag decides what the panel *lists*.
 */
import type { PaseoApi } from "./host-types";
import type {
  PluginHookAgent,
  PluginHookContext,
  PluginLifecycleRegistration,
} from "@getpaseo/plugin/server";

import {
  announceKeyFor,
  type AttentionEntry,
  type AttentionReason,
  type HeraldConfig,
} from "../shared/herald";
import { publishCard } from "./card";
import { isAgentRunning } from "./liveness";
import type { AttentionStore } from "./store";
import { HELPER_TITLE, type Summary, type SummaryRequest, type SummarizerDeps } from "./summarize";
import { createWorkspaceTitleLookup, type WorkspaceTitleLookup } from "./workspaces";
import {
  describePermission,
  fallbackSpeech,
  firstWords,
  lastUserMessage,
  latestOutputText,
  preview,
} from "./timeline";

export interface HookDeps {
  store: AttentionStore;
  readConfig: () => Promise<HeraldConfig>;
  summarize: (request: SummaryRequest, deps: SummarizerDeps) => Promise<Summary>;
  /** The workspace's title, for naming the work; agents are usually untitled. */
  workspaceTitle?: WorkspaceTitleLookup;
  /** Puts the summary card in the agent's transcript; once pending, again when the summary lands. */
  publish?: (paseo: PaseoApi, entry: AttentionEntry, options?: { superseded?: boolean }) => Promise<void>;
  /** Whether a turn is in flight right now; a summary the agent outran is dropped. */
  isRunning?: (paseo: PaseoApi, agentId: string) => Promise<boolean>;
  now?: () => Date;
  /** How many helpers may be writing at once; more agents than this wait their turn. */
  maxConcurrent?: number;
  /**
   * Every helper this process has seen, newest last and capped. Shared with the
   * load-time sweep in `index.server.ts` as the set it may not delete: the ones
   * still writing a summary are by definition the most recent entries.
   */
  liveHelpers?: Set<string>;
}

/** A second `turn_ended` for the same turn inside this window is a repeat, not a new turn. */
export const TURN_REPEAT_WINDOW_MS = 15_000;

/**
 * A turn that fails this soon after the user denied a permission *with
 * interrupt* failed because the user stopped it. Claude reports that as an
 * error with a diagnostic for a message; it is not news to announce.
 */
export const INTERRUPT_GRACE_MS = 10_000;

/**
 * Whether an event gets a summary, a transcript card and a voice; otherwise it
 * is only listed. An agent another agent started reports to that agent — Paseo
 * tells the parent when it finishes, fails or asks for a permission — so unless
 * the user has asked for subagents too, the parent's announcement is the one
 * they hear. Herald's own helpers have a parent as well, but never get here.
 *
 * A parent is not a subscription, and nothing in the hook payload says which
 * one this is: Paseo stops telling the parent after the child's first finish or
 * error, and never tells it about a child started without `notifyOnFinish`. Both
 * are muted anyway — a known gap, see "Agents another agent started" in AGENTS.md.
 */
export function isAnnounced(agent: PluginHookAgent, reason: AttentionReason, config: HeraldConfig): boolean {
  if (agent.parentAgentId !== null && !config.subagents.announce) return false;
  return config.announce[announceKeyFor(reason)];
}

export function registerHooks(server: PluginLifecycleRegistration, deps: HookDeps): () => void {
  const now = deps.now ?? (() => new Date());
  const maxConcurrent = deps.maxConcurrent ?? 2;
  const workspaceTitle = deps.workspaceTitle ?? createWorkspaceTitleLookup();
  const publish = deps.publish ?? publishCard;
  const isRunning = deps.isRunning ?? isAgentRunning;

  /**
   * Whether the agent has carried on since the summary was commissioned, in
   * which case there is nothing to announce.
   *
   * The generation — a turn we saw start — applies to every event. Asking the
   * daemon whether a turn is in flight applies to a *finish* only: an agent
   * waiting on a question, a plan or a permission reports `status: "running"`
   * with the request pending, so asking it here would suppress every one of
   * them, which is the whole point of the plugin.
   */
  async function outran(
    agentId: string,
    generation: number,
    paseo: PaseoApi,
    askDaemon: boolean,
  ): Promise<boolean> {
    if (generationOf(agentId) !== generation) return true;
    if (!askDaemon) return false;
    const running = await isRunning(paseo, agentId);
    // A turn can start while that round trip is in flight, and the snapshot it
    // answers with may predate it.
    return generationOf(agentId) !== generation ? true : running;
  }
  const helpers = deps.liveHelpers ?? new Set<string>();
  const recentTurns = new Map<string, number>();
  const interruptedAt = new Map<string, number>();
  /**
   * Both recording handlers await — the config file, the workspace title — and
   * the agent can move on while they do. Whatever they learned is then about a
   * question already answered or a turn already replied to, and recording it
   * would put a resolved event back on the panel. So each handler takes the
   * agent's generation before its first await and drops out if it moved.
   */
  const generations = new Map<string, number>();
  /** `${agentId}:${requestId}`, for permissions answered during that window. */
  const resolvedRequests = new Set<string>();
  let running = 0;
  const queue: Array<() => void> = [];

  function isHelper(agent: PluginHookAgent): boolean {
    return helpers.has(agent.id) || agent.title === HELPER_TITLE;
  }

  function generationOf(agentId: string): number {
    return generations.get(agentId) ?? 0;
  }

  /** The agent unmistakably moved on: a new turn, or gone for good. */
  function movedOn(agentId: string): void {
    generations.set(agentId, generationOf(agentId) + 1);
  }

  function markResolved(key: string): void {
    resolvedRequests.add(key);
    if (resolvedRequests.size > 1000) {
      const oldest = resolvedRequests.values().next();
      if (!oldest.done) resolvedRequests.delete(oldest.value);
    }
  }

  /**
   * An id is normally dropped when `agent.archived` arrives — but a *deleted*
   * helper fires no such event, and the daemon deletes one per summary when the
   * user has asked it to. So the set is capped the way `resolvedRequests` is.
   * The oldest goes first, and a helper still writing is always the newest.
   */
  function rememberHelper(helperId: string): void {
    helpers.add(helperId);
    if (helpers.size > 1000) {
      const oldest = helpers.values().next();
      if (!oldest.done) helpers.delete(oldest.value);
    }
  }

  function isRepeatTurn(agentId: string, turnId: string | null): boolean {
    if (turnId === null) return false;
    const key = `${agentId}:${turnId}`;
    const at = now().getTime();
    for (const [seenKey, seenAt] of recentTurns) {
      if (at - seenAt > TURN_REPEAT_WINDOW_MS) recentTurns.delete(seenKey);
    }
    if (recentTurns.has(key)) return true;
    recentTurns.set(key, at);
    return false;
  }

  /** Runs `task` when a slot is free; the order agents finished in is kept. */
  function schedule(task: () => Promise<void>): void {
    const start = () => {
      running += 1;
      void task().finally(() => {
        running -= 1;
        queue.shift()?.();
      });
    };
    if (running < maxConcurrent) start();
    else queue.push(start);
  }

  function record(
    agent: PluginHookAgent,
    title: string | null,
    reason: AttentionReason,
    eventId: string,
    requestId: string | null,
    headline: string,
    detail: string | null,
    config: HeraldConfig,
    context: PluginHookContext,
    text: { output: string; lastUser: string | null },
  ): void {
    const base: Omit<AttentionEntry, "summary"> = {
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      workspaceTitle: title,
      agentTitle: agent.title,
      lastRequest: text.lastUser === null ? null : preview(text.lastUser),
      cwd: agent.cwd,
      reason,
      eventId,
      requestId,
      createdAt: now().toISOString(),
      headline,
      detail,
    };
    if (!isAnnounced(agent, reason, config)) {
      // Switched off, or a subagent its parent speaks for: listed in the panel,
      // no summary, no card in the transcript.
      deps.store.upsert({ ...base, summary: { status: "off", fallback: fallbackSpeech(base) } });
      return;
    }
    const paseo: PaseoApi = context.paseo;
    const pending: AttentionEntry = { ...base, summary: { status: "pending" } };
    deps.store.upsert(pending);
    void publish(paseo, pending);
    schedule(async () => {
      // The user may have answered while this waited in the queue. The card
      // was published as pending before queuing, so it has to be completed
      // here or it reads "Writing the summary…" for ever.
      if (deps.store.get(agent.id)?.eventId !== eventId) {
        void publish(paseo, { ...base, summary: { status: "off", fallback: fallbackSpeech(base) } });
        return;
      }
      const generation = generationOf(agent.id);
      let summary: Summary | null = null;
      let failure: string | null = null;
      try {
        summary = await deps.summarize(
          {
            agent: {
              id: agent.id,
              workspaceId: agent.workspaceId,
              workspaceTitle: title,
              cwd: agent.cwd,
              title: agent.title,
            },
            reason,
            headline,
            detail,
            output: text.output,
            lastUser: text.lastUser,
          },
          {
            paseo,
            provider: config.summarizer.provider,
            timeoutMs: config.summarizer.timeoutMs,
            prompt: config.summarizer.prompt,
            deleteHelper: config.cleanup.deleteHelpers,
            onHelperCreated: rememberHelper,
          },
        );
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        console.error(`[herald] summary for agent ${agent.id} failed: ${failure}`);
      }

      // Checked after the summary rather than before it: writing one takes
      // seconds, and that is the window in which a completion turns out not to
      // have been one. Nothing is said and the card is taken back.
      if (await outran(agent.id, generation, paseo, reason === "finished")) {
        deps.store.removeIf(agent.id, (entry) => entry.eventId === eventId);
        // A complete entry even though it draws nothing: the client validates
        // every card against its schema and would show a placeholder for one
        // missing a summary.
        void publish(paseo, { ...base, summary: { status: "off", fallback: fallbackSpeech(base) } }, {
          superseded: true,
        });
        return;
      }

      const settled: AttentionEntry =
        summary !== null
          ? { ...base, summary: { status: "ready", ...summary } }
          : {
              ...base,
              summary: {
                status: "failed",
                error: failure ?? "The summary agent returned nothing.",
                fallback: fallbackSpeech(base),
              },
            };
      deps.store.updateSummary(agent.id, eventId, settled.summary);
      // The card is history and belongs to this event, so it is completed even
      // when the user has already moved on and the store refused.
      void publish(paseo, settled);
    });
  }

  const unsubscribers = [
    server.on("agent.created", (event) => {
      if (event.agent.title === HELPER_TITLE) rememberHelper(event.agent.id);
    }),

    server.on("agent.permission_requested", async (event, context) => {
      if (isHelper(event.agent)) return;
      const described = describePermission(event.request);
      const generation = generationOf(event.agent.id);
      const key = `${event.agent.id}:${event.request.id}`;
      const [config, title] = await Promise.all([
        deps.readConfig(),
        workspaceTitle(event.agent.workspaceId, context.paseo),
      ]);
      if (generationOf(event.agent.id) !== generation || resolvedRequests.has(key)) return;
      record(
        event.agent,
        title,
        described.reason,
        `${event.agent.id}:permission:${event.request.id}`,
        event.request.id,
        described.headline,
        described.detail,
        config,
        context,
        { output: "", lastUser: null },
      );
    }),

    server.on("agent.permission_resolved", (event) => {
      if (isHelper(event.agent)) return;
      deps.store.removeIf(event.agent.id, (entry) => entry.requestId === event.requestId);
      markResolved(`${event.agent.id}:${event.requestId}`);
      if (event.resolution.behavior === "deny" && event.resolution.interrupt === true) {
        interruptedAt.set(event.agent.id, now().getTime());
      }
    }),

    server.on("agent.turn_started", (event) => {
      if (isHelper(event.agent)) return;
      movedOn(event.agent.id);
      deps.store.remove(event.agent.id);
    }),

    server.on("agent.turn_ended", async (event, context) => {
      if (isHelper(event.agent)) return;
      if (isRepeatTurn(event.agent.id, event.turnId)) return;
      const generation = generationOf(event.agent.id);
      const output = latestOutputText(event.timeline);
      let reason: AttentionReason;
      let headline: string;
      switch (event.outcome.kind) {
        case "completed":
          // A turn that produced no words — a compaction, a bare tool run —
          // gives the user nothing to hear.
          if (output === "") return;
          reason = "finished";
          headline = "Finished";
          break;
        case "failed": {
          const stoppedAt = interruptedAt.get(event.agent.id);
          interruptedAt.delete(event.agent.id);
          if (stoppedAt !== undefined && now().getTime() - stoppedAt < INTERRUPT_GRACE_MS) return;
          reason = "error";
          headline = event.outcome.error.message.trim() || "The turn failed";
          break;
        }
        case "canceled":
          reason = "canceled";
          headline = event.outcome.reason.trim() || "The turn was canceled";
          break;
      }
      const [config, title] = await Promise.all([
        deps.readConfig(),
        workspaceTitle(event.agent.workspaceId, context.paseo),
      ]);
      if (generationOf(event.agent.id) !== generation) return;
      record(
        event.agent,
        title,
        reason,
        `${event.agent.id}:turn:${event.turnId ?? now().getTime()}`,
        null,
        headline,
        output === "" ? null : firstWords(output, 60),
        config,
        context,
        { output, lastUser: lastUserMessage(event.timeline) },
      );
    }),

    server.on("agent.archived", (event) => {
      helpers.delete(event.agent.id);
      interruptedAt.delete(event.agent.id);
      movedOn(event.agent.id);
      deps.store.remove(event.agent.id);
    }),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    queue.length = 0;
  };
}
