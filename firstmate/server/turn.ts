/**
 * The turn an `agent.turn_ended` event is about, read back from the agent's
 * timeline.
 *
 * Paseo 0.11 and 0.12 put the agent's timeline on the event; 0.13 left the
 * field empty to keep the payload small, and 0.17 removed it. So the event's
 * own history is used while it has one, and otherwise the turn is read back:
 * the latest whole turn (`direction: "tail", limit: 1, wholeTurns: true`),
 * Paseo's documented way in, which daemons since 0.14 widen from one row back
 * to the turn's first row. A 0.13 daemon ignores `wholeTurns` and returns the
 * last row alone, which is less, not wrong.
 */
import type { PaseoApi, TimelineEntry, TimelineItem } from "./host-types";

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
): TimelineItem[] {
  const tags = entries.flatMap((entry) => (entry.turnId === undefined ? [] : [entry.turnId]));
  if (turnId !== null && tags.length > 0 && !tags.includes(turnId)) return [];
  return entries.map((entry) => entry.item);
}

// Declared apart from the call so the 0.11 SDK, whose refetch options predate
// `wholeTurns`, still accepts it; the daemon client passes it through.
const LATEST_TURN = { direction: "tail", limit: 1, projection: "projected", wholeTurns: true } as const;

/** The history a 0.11 or 0.12 daemon put on the event; null when it sent none. */
export function carriedTurn(event: object): TimelineItem[] | null {
  const timeline = (event as { timeline?: readonly TimelineItem[] }).timeline;
  return timeline === undefined || timeline.length === 0 ? null : [...timeline];
}

/** Reads the turn that just ended. */
export async function readEndedTurn(
  paseo: PaseoApi,
  agentId: string,
  turnId: string | null,
): Promise<TimelineItem[]> {
  const page = await paseo.agents.ref(agentId).timeline.refetch(LATEST_TURN);
  return endedTurnItems(page.entries, turnId);
}
