/**
 * The FirstMate screen's route, as Paseo 0.11 keeps it: the screen's id, the
 * param that focuses it on one crewmate, the header that names it, and which
 * crewmates the sidebar lists under the FirstMate row. Pure.
 *
 * The screen keeps the id of the sidebar item it replaced, `fleet`, so a saved
 * `/plugin/firstmate/sidebar/fleet` link still opens it, and the sidebar item
 * keeps it too, so the captain's Settings › Sidebar order and hiding survive.
 */
import type { ColumnId, Fleet, FleetCard } from "../shared/fleet";

export const FLEET_SCREEN_ID = "fleet";

/** The screen param naming the crewmate to show in the board's place, by agent id. */
export const CREW_PARAM = "crew";

const TITLE = "FirstMate";

/**
 * The screen header: "FirstMate", or the crewmate it was opened on beside it. Paseo calls this when the
 * screen opens and when its params change, never later, so a crewmate the last fleet does not have — the
 * app has just started, say — reads "FirstMate" until the screen is opened on it again.
 */
export function fleetTitle(params: Readonly<Record<string, string>>, fleet: Fleet | null): string {
  const crew = params[CREW_PARAM];
  if (crew === undefined || crew === "") return TITLE;
  const card = fleet?.cards.find((candidate) => candidate.agent?.id === crew);
  return card === undefined ? TITLE : `${TITLE} · ${card.title}`;
}

/** The crewmates the sidebar lists: every card with an agent Paseo still runs, in the board's order. */
export function sidebarCrew(cards: readonly FleetCard[]): Array<FleetCard & { agent: NonNullable<FleetCard["agent"]> }> {
  return cards.filter(
    (card): card is FleetCard & { agent: NonNullable<FleetCard["agent"]> } =>
      card.agent !== null && card.agent.status !== "closed",
  );
}

/** A crewmate row's icon, by the column its card is in, so the sidebar and the board agree. */
export function crewIcon(column: ColumnId): string {
  switch (column) {
    case "working":
      return "LoaderCircle";
    case "blocked":
      return "CircleAlert";
    case "parked":
      return "CirclePause";
    case "failed":
      return "CircleX";
    case "done":
      return "CircleCheck";
    case "queued":
      return "Clock";
    case "idle":
      return "Circle";
  }
}
