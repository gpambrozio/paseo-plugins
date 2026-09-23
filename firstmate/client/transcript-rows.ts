/**
 * The first mate's timeline, turned into the rows the chat pane draws.
 *
 * The full transcript is one click away — the pane's Open button shows the
 * first mate in Paseo itself, with every tool call and its output. This pane
 * is for the conversation with the captain, so it keeps the words and folds
 * the machinery: a tool call is one line, reasoning is left out, and the
 * notes Paseo and the board inject into the first mate's inbox are shown as
 * the one line that says what happened rather than as the raw envelope.
 */
import type { usePaseo } from "@getpaseo/plugin/client";

type PaseoApi = ReturnType<typeof usePaseo>;
export type TimelinePage = Awaited<ReturnType<ReturnType<PaseoApi["agents"]["ref"]>["timeline"]["refetch"]>>;
export type TimelineEntry = TimelinePage["entries"][number];
type TimelineItem = TimelineEntry["item"];
type ToolCallItem = Extract<TimelineItem, { type: "tool_call" }>;

export type TranscriptRow =
  | { key: string; kind: "captain"; text: string }
  | { key: string; kind: "mate"; text: string }
  | { key: string; kind: "event"; text: string }
  | { key: string; kind: "tool"; text: string; status: ToolCallItem["status"] }
  | { key: string; kind: "error"; text: string };

/** Envelopes a message is wrapped in when it did not come from the captain. */
const ENVELOPES = ["paseo-system", "firstmate-board"] as const;

/** The first line inside an injected note — "Agent 3f2a… (Fix login) finished." — or null for the captain's own words. */
export function injectedSummary(text: string): string | null {
  const trimmed = text.trim();
  for (const tag of ENVELOPES) {
    if (!trimmed.startsWith(`<${tag}>`)) continue;
    const body = trimmed.slice(tag.length + 2).replace(new RegExp(`</${tag}>\\s*$`), "");
    const first = body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "" && !line.startsWith("<"));
    return first ?? tag;
  }
  return null;
}

/** One line, at most `max` characters. */
export function clip(text: string, max = 120): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

/** One line for a tool call: what it did, in the fewest words its detail allows. */
export function toolSummary(item: ToolCallItem): string {
  const detail = item.detail;
  switch (detail.type) {
    case "shell":
      return `$ ${clip(detail.command, 100)}`;
    case "read":
      return `Read ${detail.filePath}`;
    case "edit":
      return `Edit ${detail.filePath}`;
    case "write":
      return `Write ${detail.filePath}`;
    case "search":
      return `Search ${clip(detail.query, 80)}`;
    case "fetch":
      return `Fetch ${detail.url}`;
    case "sub_agent":
      return `Agent ${clip(detail.description ?? detail.subAgentType ?? "", 80)}`.trim();
    case "plain_text":
      return clip(detail.label ?? detail.text ?? item.name, 100);
    case "plan":
      return "Plan";
    default:
      return toolDisplayName(item.name);
  }
}

/** MCP tools arrive as `mcp__paseo__create_agent`; the server name is noise. */
export function toolDisplayName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");
}

const COMPACTING = "Compacting context…";

/**
 * Adds a compaction's line to `rows`. A compaction arrives as two entries, one
 * as it starts and one as it ends, and the second takes the first's place, so
 * a finished compaction is one line rather than two.
 */
export function pushCompaction<Row extends { kind: string; text?: string; key: string }>(
  rows: Row[],
  key: string,
  status: "loading" | "completed",
  make: (key: string, text: string) => Row,
): void {
  const last = rows[rows.length - 1];
  if (status === "completed" && last !== undefined && last.kind === "event" && last.text === COMPACTING) {
    rows[rows.length - 1] = make(last.key, "Context compacted");
    return;
  }
  rows.push(make(key, status === "loading" ? COMPACTING : "Context compacted"));
}

/**
 * A row's key: where its entry starts in the timeline. The end moves while a
 * reply streams or a tool call runs, and a position in the page shifts once
 * the tail is full, so neither is in it — a key that changes remounts the row
 * and forgets that it was open.
 */
export function rowKey(entry: TimelineEntry): string {
  return String(entry.seqStart);
}

/**
 * Timeline entries to rows. Consecutive assistant messages are one row, since
 * a streamed reply can arrive in several pieces that split anywhere.
 */
export function transcriptRows(entries: readonly TimelineEntry[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  entries.forEach((entry) => {
    const key = rowKey(entry);
    const item = entry.item;
    switch (item.type) {
      case "user_message": {
        const summary = injectedSummary(item.text);
        rows.push(summary === null ? { key, kind: "captain", text: item.text } : { key, kind: "event", text: summary });
        break;
      }
      case "assistant_message": {
        const last = rows[rows.length - 1];
        if (last !== undefined && last.kind === "mate") last.text += item.text;
        else rows.push({ key, kind: "mate", text: item.text });
        break;
      }
      case "tool_call":
        rows.push({ key, kind: "tool", text: toolSummary(item), status: item.status });
        break;
      case "error":
        rows.push({ key, kind: "error", text: item.message });
        break;
      case "notification":
        rows.push({ key, kind: item.level === "error" ? "error" : "event", text: item.message });
        break;
      case "compaction":
        pushCompaction(rows, key, item.status, (rowKey, text) => ({ key: rowKey, kind: "event" as const, text }));
        break;
      default:
        break;
    }
  });
  return rows.filter((row) => row.kind !== "mate" || row.text.trim() !== "");
}
