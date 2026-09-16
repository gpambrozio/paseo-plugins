/**
 * Whether the agent behind an entry is still waiting on the user. The hooks
 * learn that an agent moved on from its own events, but two things fire
 * nothing: a session *closing* (the daemon restarted, the provider went
 * away), and the user *looking* — Paseo clears its `requiresAttention` flag
 * when the agent is viewed or its tab is closed, and that is the signal the
 * panel should follow. So the list RPC asks the daemon about each entry's
 * agent before handing the list out:
 *
 * - **closed** sessions are hidden but kept, because opening the agent again
 *   resumes the session and the summary is still the right thing to show;
 * - **seen** agents — no attention flag, no pending permission, and the entry
 *   old enough that Paseo has had time to set the flag — are removed; the
 *   user has been there;
 * - **archived** or **missing** agents are removed, because they never come back.
 *
 * Answers are cached for a short while so the clients' polling does not turn
 * into one daemon fetch per entry per poll.
 */
import type { PaseoApi } from "@getpaseo/client";

import type { AttentionEntry } from "../shared/herald";
import type { AttentionStore } from "./store";

export const LIVENESS_TTL_MS = 30_000;

/**
 * Paseo sets its flag within milliseconds of the event Herald recorded, but
 * not before; an entry younger than this is never judged "seen".
 */
export const SEEN_GRACE_MS = 15_000;

type Facts =
  | { kind: "gone" }
  | { kind: "closed" }
  | { kind: "open"; requiresAttention: boolean; pendingPermissions: number };

type Verdict = "live" | "closed" | "gone" | "seen";

/**
 * Whether a turn is in flight right now. Uncached and deliberately so: it
 * decides whether a summary just written is still worth saying, and a cached
 * answer from half a minute ago cannot.
 *
 * An agent that cannot be read is reported as not running, so a transport
 * hiccup loses no summary.
 */
export async function isAgentRunning(paseo: PaseoApi, agentId: string): Promise<boolean> {
  try {
    const result = await paseo.agents.ref(agentId).refresh();
    if (result === null) return false;
    return result.agent.status === "running" || (result.agent.activeTurn ?? null) !== null;
  } catch (error) {
    console.warn(
      `[herald] could not check whether agent ${agentId} is running:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

export class Liveness {
  private readonly checked = new Map<string, { at: number; facts: Facts }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The entries a client should see; removes the ones whose agent is gone or has been seen. */
  async visible(store: AttentionStore, paseo: PaseoApi): Promise<AttentionEntry[]> {
    const entries = store.list();
    const verdicts = await Promise.all(entries.map((entry) => this.verdictFor(entry, paseo)));
    const result: AttentionEntry[] = [];
    entries.forEach((entry, index) => {
      switch (verdicts[index]) {
        case "live":
          result.push(entry);
          break;
        case "closed":
          break;
        case "gone":
        case "seen":
          // By event, not by agent: the entries were snapshotted before the
          // daemon checks, and a newer one may have been recorded since.
          store.removeIf(entry.agentId, (current) => current.eventId === entry.eventId);
          break;
        case undefined:
          break;
      }
    });
    return result;
  }

  private async verdictFor(entry: AttentionEntry, paseo: PaseoApi): Promise<Verdict> {
    const createdAt = new Date(entry.createdAt).getTime();
    /**
     * A snapshot older than this — the event, plus the grace Paseo needs to
     * raise its flag — cannot speak for this entry however fresh the cache is.
     */
    const judgeableFrom = (Number.isFinite(createdAt) ? createdAt : 0) + SEEN_GRACE_MS;

    const cached = await this.factsFor(entry.agentId, paseo, 0);
    if (cached.kind !== "open") return cached.kind;
    if (cached.requiresAttention || cached.pendingPermissions > 0) return "live";
    if (this.now() < judgeableFrom) return "live";

    // About to delete on the strength of a flag that is *absent*, so the
    // snapshot has to be new enough to have carried it. Re-reads only when the
    // cached one predates the event; usually this is the same answer again.
    const facts = await this.factsFor(entry.agentId, paseo, judgeableFrom);
    if (facts.kind !== "open") return facts.kind;
    if (facts.requiresAttention || facts.pendingPermissions > 0) return "live";
    return "seen";
  }

  private async factsFor(agentId: string, paseo: PaseoApi, notBefore: number): Promise<Facts> {
    const at = this.now();
    const cached = this.checked.get(agentId);
    if (cached !== undefined && at - cached.at < LIVENESS_TTL_MS && cached.at >= notBefore) {
      return cached.facts;
    }
    let facts: Facts;
    try {
      const result = await paseo.agents.ref(agentId).refresh();
      if (result === null || (result.agent.archivedAt ?? null) !== null) facts = { kind: "gone" };
      else if (result.agent.status === "closed") facts = { kind: "closed" };
      else {
        facts = {
          kind: "open",
          requiresAttention: result.agent.requiresAttention === true,
          pendingPermissions: result.agent.pendingPermissions?.length ?? 0,
        };
      }
    } catch (error) {
      // Cannot tell right now — a transport hiccup, most likely. Showing an
      // entry that may be stale beats losing one that is not.
      console.warn(`[herald] could not check agent ${agentId}:`, error instanceof Error ? error.message : error);
      facts = { kind: "open", requiresAttention: true, pendingPermissions: 0 };
    }
    this.checked.set(agentId, { at, facts });
    return facts;
  }
}
