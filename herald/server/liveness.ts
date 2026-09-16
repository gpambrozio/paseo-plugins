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
          store.remove(entry.agentId);
          break;
        case undefined:
          break;
      }
    });
    return result;
  }

  private async verdictFor(entry: AttentionEntry, paseo: PaseoApi): Promise<Verdict> {
    const facts = await this.factsFor(entry.agentId, paseo);
    if (facts.kind !== "open") return facts.kind;
    if (facts.requiresAttention || facts.pendingPermissions > 0) return "live";
    const age = this.now() - new Date(entry.createdAt).getTime();
    return age >= SEEN_GRACE_MS ? "seen" : "live";
  }

  private async factsFor(agentId: string, paseo: PaseoApi): Promise<Facts> {
    const at = this.now();
    const cached = this.checked.get(agentId);
    if (cached !== undefined && at - cached.at < LIVENESS_TTL_MS) return cached.facts;
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
