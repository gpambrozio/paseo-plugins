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
 * The longest crew row label, in characters. Paseo's sidebar row draws its label as a plain `Text` with no
 * line limit and `SidebarRow` takes only a string, so a long one wraps into a paragraph; this keeps it to
 * one line in the default 320-point sidebar, beside the icon and the permission mark. A sidebar dragged
 * narrower can still wrap it.
 */
export const CREW_LABEL_MAX = 30;

/**
 * What a crewmate is called: its agent's own title, or else the card's — the backlog line's title — with
 * the notes the first mate keeps in parentheses taken out. Whitespace, line breaks included, is one space.
 */
export function crewName(card: FleetCard): string {
  const agentTitle = oneLine(card.agent?.title ?? "");
  if (agentTitle !== "") return agentTitle;
  const title = oneLine(card.title);
  let stripped = title;
  for (let previous = ""; previous !== stripped; ) {
    previous = stripped;
    stripped = stripped.replace(/\s*\([^()]*\)/g, "");
  }
  stripped = oneLine(stripped);
  return stripped === "" ? title : stripped;
}

/** `text` cut to `max` characters, an ellipsis in the last, never splitting a character in two. */
export function truncateLabel(text: string, max: number = CREW_LABEL_MAX): string {
  const characters = Array.from(text);
  if (characters.length <= max) return text;
  return `${characters.slice(0, max - 1).join("").trimEnd()}…`;
}

/** A crewmate's sidebar row label: its name, on one line. */
export function crewRowLabel(card: FleetCard): string {
  return truncateLabel(crewName(card));
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The screen header: "FirstMate", or the name of the crewmate it was opened on beside it. Paseo calls
 * this when the screen opens and when its params change, never later, so a crewmate the last fleet does
 * not have — the app has just started, say — reads "FirstMate" until the screen is opened on it again.
 */
export function fleetTitle(params: Readonly<Record<string, string>>, fleet: Fleet | null): string {
  const crew = params[CREW_PARAM];
  if (crew === undefined || crew === "") return TITLE;
  const card = fleet?.cards.find((candidate) => candidate.agent?.id === crew);
  return card === undefined ? TITLE : `${TITLE} · ${crewName(card)}`;
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
