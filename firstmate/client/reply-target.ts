/**
 * Who a reply written on a card goes to. A card with an agent steers that agent directly; any other card
 * goes to the first mate, with the item's tag in front so the board files the exchange under the card.
 * Pure, so the words and the draft's slot are tested without a screen.
 */
import type { FleetCard } from "../shared/fleet";
import { topicTag } from "../shared/topics";

export type ReplyTarget = { kind: "agent"; agentId: string; title: string } | { kind: "mate"; topicId: string };

/** Null for a card with nothing to reply to: no agent, and no backlog item to file a message under. */
export function replyTarget(card: FleetCard): ReplyTarget | null {
  if (card.agent !== null) return { kind: "agent", agentId: card.agent.id, title: card.agent.title ?? card.title };
  if (card.backlog !== null) return { kind: "mate", topicId: card.backlog.id };
  return null;
}

/** The line above the box that says who gets the message. */
export function replyLabel(target: ReplyTarget): string {
  return target.kind === "agent" ? `Sends to ${target.title}` : `Sends to the first mate, tagged ${topicTag(target.topicId)}`;
}

/** What goes to the first mate for a reply on topic `topicId`. */
export function mateReplyText(topicId: string, text: string): string {
  return `${topicTag(topicId)} ${text}`;
}

/** Prefixed, so a reply never shares a slot with a card's answer or a first mate's chat draft. */
export function replyKey(target: ReplyTarget): string {
  return target.kind === "agent" ? `reply:agent:${target.agentId}` : `reply:topic:${target.topicId}`;
}
