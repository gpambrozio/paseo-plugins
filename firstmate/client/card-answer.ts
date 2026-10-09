/**
 * What a card can say to the first mate: the actions it wrote on the item's
 * backlog line, and, on a held card, the captain's own answer. Both go out
 * through the board's sender — the chat's, as a suggestion does — so they
 * share its one message at a time and its failure toast. Pure, apart from the
 * answer drafts kept on `globalThis`.
 */
import type { CardAction, FleetCard } from "../shared/fleet";
import { createDraftStore, type DraftStore } from "./draft";

/** The board's way to the first mate; null where there is no first mate to send to. */
export interface MateAsk {
  /** A message is already on its way; every button that sends is disabled. */
  sending: boolean;
  /**
   * Sends `text` as the captain's message; false when refused. `onFailure` runs after the failure
   * toast, `onSent` once the daemon has taken it.
   */
  send: (text: string, onFailure?: () => void, onSent?: () => void) => boolean;
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
 * Half-typed answers, by `answerKey`. A card remounts when it changes column —
 * a crewmate stopping moves it — and the surface unmounts on navigation, a
 * phone's switch to the chat after a send included, so an answer kept in
 * component state would be lost exactly while it is typed or on its way. The
 * chat's own draft store, on `globalThis`, so a lost connection keeps it too.
 */
export const answers: DraftStore = createDraftStore(globalThis);

/** Prefixed, so a card's answer never shares a slot with a first mate's chat draft. */
export function answerKey(card: FleetCard): string {
  return `answer:${card.key}`;
}

/**
 * Sends a card's typed answer. It stays in the box — which is disabled while
 * any message is on its way — until the first mate has it, and is cleared
 * then, whether the card is still on screen or not; a failure leaves it there
 * to send again. False when there is nothing to send or the send was refused.
 */
export function submitAnswer(card: FleetCard, toMate: MateAsk, store: DraftStore = answers): boolean {
  const key = answerKey(card);
  const text = answerText(card, store.get(key));
  if (text === null || toMate.sending) return false;
  return toMate.send(text, undefined, () => store.set(key, ""));
}
