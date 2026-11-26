import type { PluginTheme } from "@getpaseo/plugin";

import {
  COLUMN_IDS,
  CREW_LABELS,
  type AgentSummary,
  type ColumnId,
  type FleetCard,
  type WatchResult,
  type WatchSummary,
} from "../shared/fleet";
import type { TopicMessage } from "../shared/topics";
import { isHeld } from "./card-answer";

export interface ColumnMeta {
  id: ColumnId;
  title: string;
  /** Lucide icon name. */
  icon: string;
}

export const COLUMNS: Readonly<Record<ColumnId, ColumnMeta>> = {
  queued: { id: "queued", title: "Queued", icon: "Inbox" },
  working: { id: "working", title: "Working", icon: "Hammer" },
  blocked: { id: "blocked", title: "Blocked", icon: "Ban" },
  parked: { id: "parked", title: "Parked", icon: "Clock" },
  done: { id: "done", title: "Done", icon: "Check" },
  failed: { id: "failed", title: "Failed", icon: "AlertTriangle" },
  idle: { id: "idle", title: "Idle", icon: "CircleDot" },
};

/** The captain's four columns, in the one order they are drawn. */
export const CAPTAIN_COLUMN_IDS = ["needs-you", "working", "queued", "done"] as const;
export type CaptainColumnId = (typeof CAPTAIN_COLUMN_IDS)[number];

export const CAPTAIN_COLUMN_TITLES: Readonly<Record<CaptainColumnId, string>> = {
  "needs-you": "Needs you",
  working: "Working",
  queued: "Queued",
  done: "Done",
};

/** Whether a line's outcome says the work is finished: `(failed …)` and `(abandoned …)` still want the captain. */
function landed(outcome: string | null): boolean {
  return outcome !== null && /^(merged|done|landed|closed)\b/.test(outcome);
}

/**
 * Where a card sits when the board is read as "what do I have to do": a
 * finished item is Done whatever its line still says; anything held, blocked or
 * failed waits on the captain; a crewmate at work or at rest is Working; the
 * rest has not started.
 */
export function captainColumn(card: FleetCard): CaptainColumnId {
  const item = card.backlog;
  if (item?.section === "done" || landed(item?.outcome ?? null) || card.column === "done") return "done";
  if (isHeld(card) || card.column === "blocked" || card.column === "failed") return "needs-you";
  if (card.column === "working" || card.column === "idle") return "working";
  return "queued";
}

/**
 * What the board remembers an open card by: its agent's id, or its task id when it has no agent. Never
 * `card.key`, whose backlog form holds the line's index, which moves when the first mate edits the file above
 * it. The agent comes first because two crewmates can share a task label, and a Done line can share its id
 * with a live crewmate's card.
 */
export function openId(card: FleetCard): string | null {
  return card.agent?.id ?? card.taskId;
}

/**
 * Whether the captain has something to read on a card: the first mate spoke last and its message is newer
 * than the one the captain last had open (`read`, topic id to when it was said). A card with an agent goes by the agent
 * alone, since it opens the agent's transcript and never the thread that would mark the topic read.
 */
export function isUnread(card: FleetCard, read: Readonly<Record<string, string>>): boolean {
  if (card.agent !== null) return card.agent.requiresAttention === true;
  const last = card.lastMessage;
  const topicId = card.backlog?.id;
  if (last === null || last.from !== "mate" || topicId === undefined) return false;
  return last.at > (read[topicId] ?? "");
}

/** The read map with `topicId` read up to the message said at `at`; null when it already was, so nothing is saved for it. */
export function readPatch(
  read: Readonly<Record<string, string>>,
  topicId: string,
  at: string,
): Record<string, string> | null {
  if (at <= (read[topicId] ?? "")) return null;
  return { ...read, [topicId]: at };
}

/**
 * The card an open view is about. Found by the id it was opened under; failing that by the task id it had
 * then, because a backlog line that gains an `(agent: …)` changes its card's `openId` from the task id to
 * the agent's. Null only when neither is on the board any more.
 */
export function findOpenCard(cards: readonly FleetCard[], id: string, taskId: string | null): FleetCard | null {
  return (
    cards.find((card) => openId(card) === id) ??
    (taskId === null ? null : cards.find((card) => card.taskId === taskId)) ??
    null
  );
}

/**
 * A card's last message as one line: who said it, then the words with their line breaks folded away.
 * `agentTitle` names the card's agent when it is the one that spoke.
 */
export function lastMessageLine(message: TopicMessage, agentTitle: string | null = null): string {
  const who = message.from === "mate" ? "First mate" : message.from === "agent" ? agentTitle ?? "Agent" : "You";
  return `${who}: ${message.text.replace(/\s+/g, " ").trim()}`;
}

/** How far back the header's count of finished topics looks. */
export const DONE_RECENT_DAYS = 7;

/**
 * The counts under the screen's title, as the board of topics groups them. Done is what finished lately
 * (`doneRecently`), since the count of everything ever finished tells the captain nothing.
 */
export function headerCounts(cards: readonly FleetCard[], doneRecently: number): string[] {
  const groups = groupCaptainCards(cards);
  const count = (id: CaptainColumnId) => groups.get(id)?.length ?? 0;
  const needsYou = count("needs-you");
  return [`${needsYou} ${needsYou === 1 ? "needs" : "need"} you`, `${count("working")} working`, `${count("queued")} queued`, `${doneRecently} done in ${DONE_RECENT_DAYS} days`];
}

/** The saved order, known ids only, followed by any column it does not mention. */
export function orderedColumns(saved: readonly string[]): ColumnId[] {
  const known = new Set<string>(COLUMN_IDS);
  const kept = saved.filter((id): id is ColumnId => known.has(id));
  const seen = new Set<string>(kept);
  return [...new Set([...kept, ...COLUMN_IDS.filter((id) => !seen.has(id))])];
}

/**
 * Moves one column by `delta` places among the `shown` ones, clamped to the
 * ends, and returns the whole order. A column that is not shown keeps its place
 * relative to its neighbours, so hiding a column never loses where it goes; the
 * moved one lands just past the shown column it swaps with, so every press of an
 * arrow moves it on screen.
 */
export function moveColumn(
  order: readonly ColumnId[],
  id: ColumnId,
  delta: number,
  shown: readonly ColumnId[] = order,
): ColumnId[] {
  const visible = order.filter((column) => shown.includes(column));
  const from = visible.indexOf(id);
  const to = Math.max(0, Math.min(visible.length - 1, from + delta));
  const neighbour = visible[to];
  if (from === -1 || to === from || neighbour === undefined) return [...order];
  const next = order.filter((column) => column !== id);
  const past = next.indexOf(neighbour);
  next.splice(to < from ? past : past + 1, 0, id);
  return next;
}

/** The suggestions card, which sits among the wide board's columns but is not one. */
export const SUGGESTIONS_CARD = "suggestions";
/** The watches card, likewise. */
export const WATCHES_CARD = "watches";
export type BoardItem = ColumnId | typeof SUGGESTIONS_CARD | typeof WATCHES_CARD;

/**
 * What the wide board lays out: the suggestions card first, when the first mate
 * has any, then the shown columns, then the watches card when the home has any
 * watches. Each card counts toward `boardRows` like a column, but never folds or
 * moves.
 */
export function boardItems(shown: readonly ColumnId[], hasSuggestions: boolean, hasWatches = false): BoardItem[] {
  const items: BoardItem[] = hasSuggestions ? [SUGGESTIONS_CARD, ...shown] : [...shown];
  if (hasWatches) items.push(WATCHES_CARD);
  return items;
}

/** At most this many columns sit in one row; past it the board takes two. */
const ONE_ROW_MAX = 3;

/**
 * The wide board's rows: one for up to three columns, two past that, as even
 * as they go with the extra in the second — five are two over three, seven
 * three over four. Order runs across the first row and on into the second.
 */
export function boardRows<T>(items: readonly T[]): T[][] {
  return splitRows(items, items.length > ONE_ROW_MAX ? 2 : 1);
}

/** At most `rows` rows, as even as they go, with any extra in the later rows. */
function splitRows<T>(items: readonly T[], rows: number): T[][] {
  if (items.length === 0) return [];
  const count = Math.min(Math.max(1, rows), items.length);
  const base = Math.floor(items.length / count);
  const longer = items.length % count;
  const result: T[][] = [];
  let start = 0;
  for (let row = 0; row < count; row += 1) {
    const size = row < count - longer ? base : base + 1;
    result.push(items.slice(start, start + size));
    start += size;
  }
  return result;
}

/**
 * Whether a card opens the way it was left. One that has moved column since —
 * its crewmate finished, failed, started again — goes back to rest, because
 * the actions it was showing were for where it was; one with something in
 * progress in it (a steer half-typed, an End waiting to be confirmed) stays
 * open, so the move never costs the captain what they were doing.
 */
export function opensAsLeft(left: { column: ColumnId; inProgress: boolean }, column: ColumnId): boolean {
  return left.inProgress || left.column === column;
}

export function columnTone(theme: PluginTheme, column: ColumnId): string {
  switch (column) {
    case "working":
      return theme.colors.accent;
    case "blocked":
    case "parked":
      return theme.colors.statusWarning;
    case "done":
      return theme.colors.statusSuccess;
    case "failed":
      return theme.colors.statusDanger;
    default:
      return theme.colors.foregroundMuted;
  }
}

export function agentStatusLabel(agent: AgentSummary): string {
  if (agent.pendingPermissions > 0) {
    return agent.pendingPermissions === 1 ? "waiting on a permission" : `waiting on ${agent.pendingPermissions} permissions`;
  }
  switch (agent.status) {
    case "running":
      return "working";
    case "initializing":
      return "starting";
    case "error":
      return "errored";
    case "closed":
      return "closed";
    default:
      return "idle";
  }
}

export function agentStatusTone(theme: PluginTheme, agent: AgentSummary): string {
  if (agent.pendingPermissions > 0 || agent.requiresAttention) return theme.colors.statusWarning;
  if (agent.status === "error") return theme.colors.statusDanger;
  if (agent.status === "running" || agent.status === "initializing") return theme.colors.accent;
  return theme.colors.foregroundMuted;
}

/** A token count as Paseo's own context meter writes it: "840", "84k", "1m". */
export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return Math.round(value).toString();
}

/** How full a context window is, in percent, or null while the provider has not said. */
export function contextPercent(used: number | null | undefined, max: number | null | undefined): number | null {
  if (typeof used !== "number" || typeof max !== "number") return null;
  if (!Number.isFinite(used) || !Number.isFinite(max) || used < 0 || max <= 0) return null;
  return (used / max) * 100;
}

/** The meter's colour, at Paseo's own thresholds: past 90% it is danger, from 70% a warning. */
export function contextTone(theme: PluginTheme, percent: number): string {
  if (percent > 90) return theme.colors.statusDanger;
  if (percent >= 70) return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

const WATCH_RESULTS: Readonly<Record<WatchResult, string>> = {
  never: "not run yet",
  silent: "nothing new",
  queued: "waiting for the first mate",
  dropped: "dropped before the first mate could take it",
  delivered: "sent to the first mate",
  failed: "failed",
  invalid: "cannot run",
};

/** One line on how a watch stands: "every 5 min" is the schedule's, this is the rest — "off · ran 5m ago · nothing new". */
export function watchStatusText(watch: WatchSummary, now: number = Date.now()): string {
  const parts: string[] = [];
  if (!watch.enabled) parts.push("off");
  if (watch.running) parts.push("running now");
  if (watch.lastRunAt !== null && watch.lastResult !== "invalid") parts.push(`ran ${relativeTime(watch.lastRunAt, now)}`);
  parts.push(WATCH_RESULTS[watch.lastResult]);
  return parts.join(" · ");
}

export function watchTone(theme: PluginTheme, watch: WatchSummary): string {
  if (!watch.enabled) return theme.colors.foregroundMuted;
  switch (watch.lastResult) {
    case "failed":
    case "invalid":
      return theme.colors.statusDanger;
    case "queued":
    case "dropped":
      return theme.colors.statusWarning;
    case "delivered":
      return theme.colors.accent;
    default:
      return theme.colors.foregroundMuted;
  }
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * What showing the Files view changes about the saved layout: a wide layout
 * whose right pane is hidden brings it back, or opening a file there would
 * draw nothing. A phone shows Files as a tab, and a shown pane needs nothing.
 */
export function revealFilesPatch(compact: boolean, boardCollapsed: boolean): { boardCollapsed: false } | null {
  return !compact && boardCollapsed ? { boardCollapsed: false } : null;
}

/** The last `max` characters of a path, from a separator, so the end — the part that differs — survives. */
export function shortPath(path: string, max = 48): string {
  if (path.length <= max) return path;
  const tail = path.slice(-max);
  const cut = tail.indexOf("/");
  return `…${cut > 0 ? tail.slice(cut) : tail}`;
}

/** The provider and model, `claude/opus` style, or whichever of the two is known. */
export function modelLabel(agent: Pick<AgentSummary, "provider" | "model">): string {
  return agent.model === null ? agent.provider : `${agent.provider}/${agent.model}`;
}

/** Cards grouped by column, each column in the order the daemon sent them. */
export function groupCards(cards: readonly FleetCard[]): Map<ColumnId, FleetCard[]> {
  const groups = new Map<ColumnId, FleetCard[]>(COLUMN_IDS.map((id) => [id, []]));
  for (const card of cards) groups.get(card.column)?.push(card);
  return groups;
}

/** Cards grouped into the captain's four columns, each in the order the daemon sent them. */
export function groupCaptainCards(cards: readonly FleetCard[]): Map<CaptainColumnId, FleetCard[]> {
  const groups = new Map<CaptainColumnId, FleetCard[]>(CAPTAIN_COLUMN_IDS.map((id) => [id, []]));
  for (const card of cards) groups.get(captainColumn(card))?.push(card);
  return groups;
}

/**
 * The sentence a failure is worth showing. An RPC that fails in the daemon
 * reaches the app as "Request failed: <the handler's message>
 * requestType=plugin.rpc.invoke.request code=handler_error"; the wrapper is
 * for logs, and the captain gets the message the handler wrote.
 */
export function errorText(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : String(caught);
  const clean = raw
    .replace(/^Request failed:\s*/, "")
    .replace(/\s+requestType=\S+(\s+code=\S+)?\s*$/, "")
    .trim();
  return clean === "" ? raw : clean;
}

/**
 * Whether End and Relaunch are offered for this agent: only for one the first mate made as crew. A backlog
 * item's own agent has no crew label, and the daemon refuses both for it.
 */
export function canEndOrRelaunch(agent: Pick<AgentSummary, "labels">): boolean {
  return agent.labels[CREW_LABELS.role] === CREW_LABELS.crewRole;
}
