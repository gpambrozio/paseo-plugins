/**
 * Whether the agent behind an entry can still be answered. The hooks learn
 * that an agent moved on from its own events, but a session that simply
 * *closed* — the daemon restarted, the provider went away — fires nothing, and
 * an agent removed some other way may fire nothing either. So the list RPC
 * asks the daemon about each entry's agent before handing the list out:
 *
 * - **closed** sessions are hidden but kept, because opening the agent again
 *   resumes the session and the summary is still the right thing to show;
 * - **archived** or **missing** agents are removed, because they never come back.
 *
 * Answers are cached for a short while so the clients' polling does not turn
 * into one daemon fetch per entry per poll.
 */
import type { PaseoApi } from "@getpaseo/client";

import type { AttentionEntry } from "../shared/herald";
import type { AttentionStore } from "./store";

export const LIVENESS_TTL_MS = 30_000;

type Verdict = "live" | "closed" | "gone";

export class Liveness {
  private readonly checked = new Map<string, { at: number; verdict: Verdict }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The entries a client should see; removes the ones whose agent is gone. */
  async visible(store: AttentionStore, paseo: PaseoApi): Promise<AttentionEntry[]> {
    const entries = store.list();
    const verdicts = await Promise.all(entries.map((entry) => this.verdictFor(entry.agentId, paseo)));
    const result: AttentionEntry[] = [];
    entries.forEach((entry, index) => {
      switch (verdicts[index]) {
        case "live":
          result.push(entry);
          break;
        case "closed":
          break;
        case "gone":
          store.remove(entry.agentId);
          break;
        case undefined:
          break;
      }
    });
    return result;
  }

  private async verdictFor(agentId: string, paseo: PaseoApi): Promise<Verdict> {
    const at = this.now();
    const cached = this.checked.get(agentId);
    if (cached !== undefined && at - cached.at < LIVENESS_TTL_MS) return cached.verdict;
    let verdict: Verdict;
    try {
      const result = await paseo.agents.ref(agentId).refresh();
      if (result === null || (result.agent.archivedAt ?? null) !== null) verdict = "gone";
      else if (result.agent.status === "closed") verdict = "closed";
      else verdict = "live";
    } catch (error) {
      // Cannot tell right now — a transport hiccup, most likely. Showing an
      // entry that may be stale beats losing one that is not.
      console.warn(`[herald] could not check agent ${agentId}:`, error instanceof Error ? error.message : error);
      verdict = "live";
    }
    this.checked.set(agentId, { at, verdict });
    return verdict;
  }
}
