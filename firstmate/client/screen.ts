/**
 * The FirstMate screen's id, and the count its sidebar row shows. Pure.
 *
 * The screen keeps the id of the sidebar item it replaced, `fleet`, so a saved
 * `/plugin/firstmate/sidebar/fleet` link still opens it, and the sidebar item
 * keeps it too, so the captain's Settings › Sidebar order and hiding survive.
 */
import type { FleetCard } from "../shared/fleet";

export const FLEET_SCREEN_ID = "fleet";

/**
 * The sidebar row's badge: how many crewmates Paseo still runs have their card in the Working or the
 * Idle column — busy, or waiting for their next word — counted the way the board places them.
 */
export function activeCrewCount(cards: readonly FleetCard[]): number {
  return cards.filter(
    (card) =>
      card.agent !== null && card.agent.status !== "closed" && (card.column === "working" || card.column === "idle"),
  ).length;
}
