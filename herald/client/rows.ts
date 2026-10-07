/**
 * Who is waiting, as rows: Paseo's attention list joined with Herald's
 * entries, and how a row is named and drawn. Pure — the screen, the sidebar
 * row's badge and its popover all read the same join, so they cannot disagree
 * about the count.
 */
import type { PluginTheme } from "@getpaseo/plugin";

import type { AttentionEntry, AttentionReason } from "../shared/herald";

/** A row's reason: one of Herald's, or "attention" when only Paseo's flag is known. */
export type RowReason = AttentionReason | "attention";

export interface Row {
  agentId: string;
  title: string | null;
  workspaceId: string | null;
  cwd: string;
  reason: RowReason;
  /** ISO time the row sorts by: the event, or when Paseo flagged the agent. */
  at: string;
  entry: AttentionEntry | null;
}

/** The fields the join reads off a Paseo agent snapshot. */
export interface FlaggedAgent {
  id: string;
  title: string | null;
  workspaceId: string | null;
  cwd: string;
  status: string;
  attentionReason: "finished" | "error" | "permission" | null;
  at: string;
}

/**
 * A Paseo-flagged agent worth a row: one whose session is still open. Paseo
 * keeps an agent flagged until the user's next message, however long ago the
 * turn ended, and that is right — a question asked a week ago is still
 * unanswered. A *closed* session is not waiting on anyone until it is opened
 * again, and a turn reported as finished on an agent that is *running* was
 * not the end of anything — some providers say a turn is done and carry on.
 * Those two are the cases dropped here.
 */
function isCurrent(agent: FlaggedAgent): boolean {
  if (agent.status === "closed") return false;
  if (agent.attentionReason === "finished" && agent.status === "running") return false;
  return true;
}

/**
 * Herald's entries win over Paseo's flags for the same agent, since they carry
 * the reason and the sentence. A *finished* entry on an agent that is working
 * again is already withheld by the daemon, which knows each entry's agent
 * without having to enumerate every running one — see `Liveness`.
 */
export function joinRows(entries: AttentionEntry[], flagged: FlaggedAgent[]): Row[] {
  const byAgent = new Map<string, Row>();
  entries.forEach((entry) => {
    byAgent.set(entry.agentId, {
      agentId: entry.agentId,
      title: entry.agentTitle,
      workspaceId: entry.workspaceId,
      cwd: entry.cwd,
      reason: entry.reason,
      at: entry.createdAt,
      entry,
    });
  });
  flagged.forEach((agent) => {
    if (byAgent.has(agent.id) || !isCurrent(agent)) return;
    byAgent.set(agent.id, {
      agentId: agent.id,
      title: agent.title,
      workspaceId: agent.workspaceId,
      cwd: agent.cwd,
      reason: agent.attentionReason ?? "attention",
      at: agent.at,
      entry: null,
    });
  });
  return [...byAgent.values()].sort((a, b) => b.at.localeCompare(a.at));
}

function basename(path: string): string {
  const parts = path.split("/").filter((part) => part !== "");
  return parts[parts.length - 1] ?? path;
}

/**
 * Agents are usually untitled; the workspace names the work. Paseo's current
 * workspace title first, then the one Herald stored with the entry, then the
 * folder.
 */
export function rowTitle(row: Row, workspaceNames: Record<string, string>): string {
  const live = row.workspaceId === null ? undefined : workspaceNames[row.workspaceId];
  return live ?? row.entry?.workspaceTitle ?? basename(row.cwd);
}

/**
 * The line under the title: the agent's own title or, failing that, what it
 * was last asked — which is what tells two untitled agents in one workspace
 * apart.
 */
export function rowSubtitle(row: Row): string | null {
  return row.title?.trim() || row.entry?.lastRequest || null;
}

export interface ReasonLook {
  icon: string;
  label: string;
  tone: "accent" | "success" | "warning" | "danger" | "muted";
}

export function lookOf(reason: RowReason): ReasonLook {
  switch (reason) {
    case "question":
      return { icon: "MessageCircle", label: "Question", tone: "accent" };
    case "plan":
      return { icon: "ClipboardList", label: "Plan to approve", tone: "accent" };
    case "permission":
      return { icon: "Shield", label: "Permission", tone: "warning" };
    case "finished":
      return { icon: "Check", label: "Finished", tone: "success" };
    case "error":
      return { icon: "X", label: "Error", tone: "danger" };
    case "canceled":
      return { icon: "Ban", label: "Interrupted", tone: "muted" };
    case "attention":
      return { icon: "Megaphone", label: "Needs you", tone: "accent" };
  }
}

export function toneColor(theme: PluginTheme, tone: ReasonLook["tone"]): string {
  const { colors } = theme;
  switch (tone) {
    case "accent":
      return colors.accent;
    case "success":
      return colors.statusSuccess;
    case "warning":
      return colors.statusWarning;
    case "danger":
      return colors.statusDanger;
    case "muted":
      return colors.foregroundMuted;
  }
}

/** `color` at `alpha` (two hex digits), or `fallback` when `color` is not `#rrggbb`. */
export function withAlpha(color: string, alpha: string, fallback = color): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : fallback;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
