/**
 * What a card can say to the first mate: the actions it wrote on the item's
 * backlog line, and, on a held card, the captain's own answer. Both go out
 * through the board's sender — the chat's, as a suggestion does — so they
 * share its one message at a time and its failure toast. Pure, apart from the
 * answer drafts kept in module scope.
 */
import type { CardAction, FleetCard } from "../shared/fleet";

/** The board's way to the first mate; null where there is no first mate to send to. */
export interface MateAsk {
  /** A message is already on its way; every button that sends is disabled. */
  sending: boolean;
  /** Sends `text` as the captain's message; false when refused. `onFailure` runs after the failure toast. */
  send: (text: string, onFailure?: () => void) => boolean;
}

/** A card waiting on the captain: its backlog line carries a `(hold: …)`. */
export function isHeld(card: FleetCard): boolean {
  const hold = card.backlog?.hold;
  return hold !== null && hold !== undefined;
}

/** The buttons a card draws: held or not, whatever the first mate wrote. */
export function cardActions(card: FleetCard): readonly CardAction[] {
  return card.backlog?.actions ?? [];
}

/**
 * The message an Answer box sends: `<task id> — <task title>: <typed text>`,
 * the captain's words under the task they answer — the same text bb's
 * FirstMate sends, and the charter quotes it. Null for nothing typed, or a
 * card with no backlog item to name.
 */
export function answerText(card: FleetCard, typed: string): string | null {
  const text = typed.trim();
  const item = card.backlog;
  if (text === "" || item === null) return null;
  return `${item.id} — ${item.title}: ${text}`;
}

/**
 * Half-typed answers by card key. A card remounts when it changes column — a
 * crewmate stopping moves it — and the surface unmounts on navigation, so an
 * answer kept in component state would be lost exactly while it is typed.
 */
const answerDrafts = new Map<string, string>();

export function answerDraft(key: string): string {
  return answerDrafts.get(key) ?? "";
}

export function rememberAnswer(key: string, text: string): void {
  if (text === "") answerDrafts.delete(key);
  else answerDrafts.set(key, text);
}
