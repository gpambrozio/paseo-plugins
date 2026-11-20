/**
 * The turn an `agent.turn.after` hook is about, read back from the agent's
 * timeline.
 *
 * The hook carries no history — its `timeline` has been empty since Paseo
 * 0.13 and is off the SDK's types since 0.16 — so the turn is read back: the
 * latest whole turn (`direction: "tail", limit: 1, wholeTurns: true`), Paseo's
 * documented way in, which widens the page from one row back to the turn's
 * first row.
 */
import type { AgentTimelineItem, PaseoApi, TimelineEntry } from "./host-types";

/**
 * What was said in the turn `turnId`, given the timeline's latest whole turn.
 *
 * Paseo's example keeps only the entries tagged with `turnId`, but not every
 * provider tags its rows: a live 0.16 daemon returned whole turns with no
 * `turnId` on any entry, which that filter would empty. So the tags are used
 * only to notice a turn that started after this one ended — the page then
 * belongs to it, and there is nothing to read. Untagged pages are taken whole.
 */
export function endedTurnItems(
  entries: readonly TimelineEntry[],
  turnId: string | null,
): AgentTimelineItem[] {
  const tags = entries.flatMap((entry) => (entry.turnId === undefined ? [] : [entry.turnId]));
  if (turnId !== null && tags.length > 0 && !tags.includes(turnId)) return [];
  return entries.map((entry) => entry.item);
}

/** Reads the turn that just ended. */
export async function readEndedTurn(
  paseo: PaseoApi,
  agentId: string,
  turnId: string | null,
): Promise<AgentTimelineItem[]> {
  const page = await paseo.agents
    .ref(agentId)
    .timeline.refetch({ direction: "tail", limit: 1, projection: "projected", wholeTurns: true });
  return endedTurnItems(page.entries, turnId);
}
