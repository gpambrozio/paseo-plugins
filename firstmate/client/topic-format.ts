/**
 * What the board of topics says about a card: the lines a topic card draws, who the topic talks to, which
 * finished topics the Done column shows, and an agent's conversation as a thread. Pure.
 */
import type { FleetCard } from "../shared/fleet";
import type { TopicMessage } from "../shared/topics";
import { isHeld } from "./card-answer";
import { captainColumn, DONE_RECENT_DAYS, lastMessageLine } from "./format";
import { transcriptRows, type TimelineEntry } from "./transcript-rows";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;

/** `2026-11-25`, or a timestamp that starts with one, as "25 Nov"; any other text as written. */
export function shortDate(text: string): string {
  const date = text.trim().match(ISO_DATE);
  if (date?.index !== 0) return text;
  const month = date === null ? undefined : MONTHS[Number(date[2]) - 1];
  return date === null || month === undefined ? text : `${Number(date[3])} ${month}`;
}

/** The date an outcome such as `merged 2026-09-21` carries, or null. */
function outcomeDate(card: FleetCard): string | null {
  return ISO_DATE.exec(card.backlog?.outcome ?? "")?.[0] ?? null;
}

/** Under a card's title: its project, and when it finished, started or was last spoken about. */
export function topicMeta(card: FleetCard): string {
  const when = outcomeDate(card) ?? card.backlog?.since ?? card.lastMessage?.at ?? null;
  return [card.project, when === null ? null : shortDate(when)].filter((part) => part !== null && part !== "").join(" · ");
}

/**
 * What a topic in Needs you waits for: the question on its line, or why its agent cannot go on. Null for a
 * topic in any other column.
 */
export function topicAsk(card: FleetCard): string | null {
  if (captainColumn(card) !== "needs-you") return null;
  if (isHeld(card)) return card.backlog?.hold ?? null;
  const agent = card.agent;
  if (agent !== null && agent.pendingPermissions > 0) return `${agent.title ?? "The agent"} is waiting for a permission.`;
  return card.report?.text ?? agent?.lastError ?? "Blocked. Open it to see why.";
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The one line under a card that asks nothing: the newest words, or failing those where the topic stands. */
export function topicLastLine(card: FleetCard): string | null {
  const title = card.agent?.title ?? null;
  if (card.lastMessage !== null) return lastMessageLine(card.lastMessage, title);
  if (card.report !== null) return `${title ?? "Agent"}: ${card.report.text}`;
  const outcome = card.backlog?.outcome ?? null;
  if (outcome !== null) return `${capitalised(outcome.replace(ISO_DATE, (date) => shortDate(date)))}.`;
  if (captainColumn(card) !== "queued") return null;
  const blocker = card.backlog?.blockedBy ?? null;
  return blocker === null ? "Not started." : `Waits for ${blocker}.`;
}

/** How many finished topics the Done column draws at first, and how many more each "Show more" adds. */
export const DONE_SHOWN = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A date as the backlog writes one: the day where the captain is, not the UTC day. */
function localDate(when: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

/** How many topics finished in the last `DONE_RECENT_DAYS` days, by the date of their outcome: the header's figure for Done. */
export function doneRecently(cards: readonly FleetCard[], now: Date = new Date()): number {
  const after = localDate(new Date(now.getTime() - DONE_RECENT_DAYS * DAY_MS));
  return cards.filter((card) => captainColumn(card) === "done" && (outcomeDate(card) ?? "") > after).length;
}

/**
 * The Done column: the newest `limit` finished topics and how many older ones it leaves out. Newest
 * by the date of the outcome; topics without one keep the backlog's order, after the dated ones.
 */
export function shownDone(done: readonly FleetCard[], limit: number = DONE_SHOWN): { shown: FleetCard[]; older: number } {
  const sorted = [...done].sort((a, b) => (outcomeDate(b) ?? "").localeCompare(outcomeDate(a) ?? ""));
  return { shown: sorted.slice(0, limit), older: Math.max(0, sorted.length - limit) };
}

/** Who a message written on the topic reaches: its own agent, by title and the start of its id, or the first mate. */
export function talkingTo(card: FleetCard): string {
  const agent = card.agent;
  return agent === null ? "First mate" : `${agent.title ?? "Agent"} (${agent.id.slice(0, 8)})`;
}

/** What the board of topics remembers a topic's read mark by: its backlog id, or its agent's id when it has none. */
export function readKey(card: FleetCard): string | null {
  return card.taskId ?? card.agent?.id ?? null;
}

/**
 * Whether a topic has words the captain has not opened: its newest message is someone else's and newer
 * than the read mark. A card with no message to judge goes by its agent's own flag. Unlike `isUnread`, a
 * card with an agent is judged by its messages too, because the board of topics opens its thread and so reads it.
 */
export function topicUnread(card: FleetCard, read: Readonly<Record<string, string>>): boolean {
  const last = card.lastMessage;
  if (last === null) return card.agent?.requiresAttention === true;
  return last.from !== "captain" && last.at > (read[readKey(card) ?? ""] ?? "");
}

/**
 * A topic's thread: the messages the first mate's conversation filed under it (`filed`), and, for a topic
 * with its own agent, the words the captain and that agent exchanged (`entries`, the agent's timeline) —
 * tool calls, reasoning and the notes Paseo injects left out. Oldest first.
 */
export function threadMessages(
  filed: readonly TopicMessage[],
  entries: readonly TimelineEntry[],
  agentId: string,
): TopicMessage[] {
  const saidAt = new Map(entries.map((entry) => [String(entry.seqStart), entry.timestamp]));
  const spoken = transcriptRows(entries).flatMap((row): TopicMessage[] =>
    row.kind === "captain" || row.kind === "mate"
      ? [{ id: `${agentId}:${row.key}`, from: row.kind === "captain" ? "captain" : "agent", text: row.text, at: saidAt.get(row.key) ?? "" }]
      : [],
  );
  return [...filed, ...spoken].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
