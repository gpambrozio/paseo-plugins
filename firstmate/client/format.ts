import type { PluginTheme } from "@getpaseo/plugin";

import { COLUMN_IDS, type AgentSummary, type ColumnId, type FleetCard } from "../shared/fleet";

export interface ColumnMeta {
  id: ColumnId;
  title: string;
  /** Lucide icon name. */
  icon: string;
  /** What an empty column says, in the captain's terms. */
  empty: string;
}

export const COLUMNS: Readonly<Record<ColumnId, ColumnMeta>> = {
  queued: { id: "queued", title: "Queued", icon: "Inbox", empty: "Nothing is queued." },
  working: { id: "working", title: "Working", icon: "Loader", empty: "Nobody is working." },
  blocked: { id: "blocked", title: "Blocked", icon: "Ban", empty: "Nothing is waiting on a call." },
  parked: { id: "parked", title: "Parked", icon: "Clock", empty: "Nothing is parked." },
  done: { id: "done", title: "Done", icon: "Check", empty: "Nothing has landed yet." },
  failed: { id: "failed", title: "Failed", icon: "AlertTriangle", empty: "Nothing has failed." },
  idle: { id: "idle", title: "Idle", icon: "CircleDot", empty: "No stopped workers." },
};

/** The saved order, known ids only, followed by any column it does not mention. */
export function orderedColumns(saved: readonly string[]): ColumnId[] {
  const known = new Set<string>(COLUMN_IDS);
  const kept = saved.filter((id): id is ColumnId => known.has(id));
  const seen = new Set<string>(kept);
  return [...new Set([...kept, ...COLUMN_IDS.filter((id) => !seen.has(id))])];
}

/** Moves one entry by `delta`, clamped to the ends. */
export function moveColumn(order: readonly ColumnId[], id: ColumnId, delta: number): ColumnId[] {
  const from = order.indexOf(id);
  if (from === -1) return [...order];
  const to = Math.max(0, Math.min(order.length - 1, from + delta));
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
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
