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

export function cardFor(entry: AttentionEntry, superseded = false): HeraldCard {
  return {
    eventId: entry.eventId,
    reason: entry.reason,
    name: displayName(entry),
    headline: entry.headline,
    detail: entry.detail,
    summary: entry.summary,
    superseded,
  };
}

/** Reported once per distinct cause; a host that predates the feature would otherwise say so on every event. */
const reported = new Set<string>();

/**
 * One chain per row. The pending append and the terminal one carry the same
 * row id and are both started fire-and-forget, so without this a pending write
 * held up by a slow round trip could land *after* the summary that replaced it
 * and leave the card reading "Writing the summary…" for ever.
 */
const chains = new Map<string, Promise<void>>();

export async function publishCard(
  paseo: PaseoApi,
  entry: AttentionEntry,
  options?: { superseded?: boolean },
): Promise<void> {
  const rowId = `summary:${entry.eventId}`;
  const superseded = options?.superseded === true;
  const next = (chains.get(rowId) ?? Promise.resolve()).then(() => append(paseo, entry, rowId, superseded));
  chains.set(rowId, next);
  try {
    await next;
  } finally {
    // Only the last link clears the row, or a later append would lose its queue.
    if (chains.get(rowId) === next) chains.delete(rowId);
  }
}

/** Never rejects: a card is a nicety, and the chain behind it has to keep moving. */
async function append(
  paseo: PaseoApi,
  entry: AttentionEntry,
  rowId: string,
  superseded: boolean,
): Promise<void> {
  try {
    await paseo.agents.ref(entry.agentId).timeline.append({
      type: "plugin",
      id: rowId,
      kind: HERALD_CARD_KIND,
      version: HERALD_CARD_VERSION,
      data: cardFor(entry, superseded),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (reported.has(message)) return;
    reported.add(message);
    console.warn(`[herald] could not add the summary card to agent ${entry.agentId}'s transcript: ${message}`);
  }
}
