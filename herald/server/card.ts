/**
 * The summary card in the agent's own transcript. Appended as soon as an entry
 * is recorded, so it lands right after the turn or the question it is about,
 * and appended again under the same id when the summary is ready or has
 * failed — the daemon replaces the row live and on refetch. Rows live in the
 * daemon's memory: they survive scroll and reconnect, not a daemon restart.
 */
import type { PaseoApi } from "@getpaseo/client";

import type { AttentionEntry } from "../shared/herald";
import { HERALD_CARD_KIND, HERALD_CARD_VERSION, type HeraldCard } from "../shared/timeline";
import { displayName } from "./timeline";

export function cardFor(entry: AttentionEntry): HeraldCard {
  return {
    eventId: entry.eventId,
    reason: entry.reason,
    name: displayName(entry),
    headline: entry.headline,
    detail: entry.detail,
    summary: entry.summary,
  };
}

/** Reported once per distinct cause; a host that predates the feature would otherwise say so on every event. */
const reported = new Set<string>();

export async function publishCard(paseo: PaseoApi, entry: AttentionEntry): Promise<void> {
  try {
    await paseo.agents.ref(entry.agentId).timeline.append({
      type: "plugin",
      id: `summary:${entry.eventId}`,
      kind: HERALD_CARD_KIND,
      version: HERALD_CARD_VERSION,
      data: cardFor(entry),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (reported.has(message)) return;
    reported.add(message);
    console.warn(`[herald] could not add the summary card to agent ${entry.agentId}'s transcript: ${message}`);
  }
}
