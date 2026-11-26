/**
 * The FirstMate screen's id, and the count its sidebar row shows. Pure.
 *
 * The screen keeps the id of the sidebar item it replaced, `fleet`, so a saved
 * `/plugin/firstmate/sidebar/fleet` link still opens it, and the sidebar item
 * keeps it too, so the captain's Settings › Sidebar order and hiding survive.
 */
import type { FleetCard } from "../shared/fleet";
import { captainColumn } from "./format";

export const FLEET_SCREEN_ID = "fleet";

/** The sidebar row's badge: the topics in Needs you. */
export function needsYouCount(cards: readonly FleetCard[]): number {
  return cards.filter((card) => captainColumn(card) === "needs-you").length;
}
