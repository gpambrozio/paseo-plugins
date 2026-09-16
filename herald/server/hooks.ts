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
import type { PaseoApi } from "@getpaseo/client";
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
import type { AttentionStore } from "./store";
import { HELPER_TITLE, type Summary, type SummaryRequest, type SummarizerDeps } from "./summarize";
import {
  describePermission,
  fallbackSpeech,
  firstWords,
  lastUserMessage,
  latestOutputText,
} from "./timeline";

export interface HookDeps {
  store: AttentionStore;
  readConfig: () => Promise<HeraldConfig>;
  summarize: (request: SummaryRequest, deps: SummarizerDeps) => Promise<Summary>;
  now?: () => Date;
  /** How many helpers may be writing at once; more agents than this wait their turn. */
  maxConcurrent?: number;
}

/** A second `turn_ended` for the same turn inside this window is a repeat, not a new turn. */
export const TURN_REPEAT_WINDOW_MS = 15_000;

/**
 * A turn that fails this soon after the user denied a permission *with
 * interrupt* failed because the user stopped it. Claude reports that as an
 * error with a diagnostic for a message; it is not news to announce.
 */
export const INTERRUPT_GRACE_MS = 10_000;

export function registerHooks(server: PluginLifecycleRegistration, deps: HookDeps): () => void {
  const now = deps.now ?? (() => new Date());
  const maxConcurrent = deps.maxConcurrent ?? 2;
  const helpers = new Set<string>();
  const recentTurns = new Map<string, number>();
  const interruptedAt = new Map<string, number>();
  let running = 0;
  const queue: Array<() => void> = [];

  function isHelper(agent: PluginHookAgent): boolean {
    return helpers.has(agent.id) || agent.title === HELPER_TITLE;
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
      agentTitle: agent.title,
      cwd: agent.cwd,
      reason,
      eventId,
      requestId,
      createdAt: now().toISOString(),
      headline,
      detail,
    };
    if (!config.announce[announceKeyFor(reason)]) {
      deps.store.upsert({ ...base, summary: { status: "off", fallback: fallbackSpeech(base) } });
      return;
    }
    deps.store.upsert({ ...base, summary: { status: "pending" } });
    const paseo: PaseoApi = context.paseo;
    schedule(async () => {
      // The user may have answered while this waited in the queue.
      if (deps.store.get(agent.id)?.eventId !== eventId) return;
      try {
        const summary = await deps.summarize(
          {
            agent: { id: agent.id, workspaceId: agent.workspaceId, cwd: agent.cwd, title: agent.title },
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
            onHelperCreated: (helperId) => helpers.add(helperId),
          },
        );
        deps.store.updateSummary(agent.id, eventId, { status: "ready", ...summary });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[herald] summary for agent ${agent.id} failed: ${message}`);
        deps.store.updateSummary(agent.id, eventId, {
          status: "failed",
          error: message,
          fallback: fallbackSpeech(base),
        });
      }
    });
  }

  const unsubscribers = [
    server.on("agent.created", (event) => {
      if (event.agent.title === HELPER_TITLE) helpers.add(event.agent.id);
    }),

    server.on("agent.permission_requested", async (event, context) => {
      if (isHelper(event.agent)) return;
      const described = describePermission(event.request);
      const config = await deps.readConfig();
      record(
        event.agent,
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
      if (event.resolution.behavior === "deny" && event.resolution.interrupt === true) {
        interruptedAt.set(event.agent.id, now().getTime());
      }
    }),

    server.on("agent.turn_started", (event) => {
      if (isHelper(event.agent)) return;
      deps.store.remove(event.agent.id);
    }),

    server.on("agent.turn_ended", async (event, context) => {
      if (isHelper(event.agent)) return;
      if (isRepeatTurn(event.agent.id, event.turnId)) return;
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
      const config = await deps.readConfig();
      record(
        event.agent,
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
      deps.store.remove(event.agent.id);
    }),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    queue.length = 0;
  };
}
