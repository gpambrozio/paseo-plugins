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

import { classifyUserMessage, clip, type ChatSource } from "../shared/chat-messages";
import { ATTACHMENTS_ONLY, endsReply, splitTopicTag, topicTag } from "../shared/topics";

type PaseoApi = ReturnType<typeof usePaseo>;
export type TimelinePage = Awaited<ReturnType<ReturnType<PaseoApi["agents"]["ref"]>["timeline"]["refetch"]>>;
export type TimelineEntry = TimelinePage["entries"][number];
type TimelineItem = TimelineEntry["item"];
type ToolCallItem = Extract<TimelineItem, { type: "tool_call" }>;

type RowBody =
  | { key: string; kind: "captain"; text: string }
  | { key: string; kind: "mate"; text: string }
  | { key: string; kind: "event"; text: string; source: ChatSource | "other" }
  | { key: string; kind: "tool"; text: string; status: ToolCallItem["status"] }
  | { key: string; kind: "error"; text: string };

/** A row, and the backlog item the conversation was about when it was said; null for the general chat. */
export type TranscriptRow = RowBody & { topicId: string | null };

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
  const rows: RowBody[] = [];
  /** A reply is open until an entry that `endsReply` comes; reasoning and plans do not end it. */
  let replying = false;
  entries.forEach((entry) => {
    const key = rowKey(entry);
    const item = entry.item;
    if (endsReply(item.type)) replying = false;
    switch (item.type) {
      case "user_message": {
        const injected = classifyUserMessage(item.text, item.clientMessageId);
        // A message of attachments alone has no words; the row still says the captain sent something.
        const text = item.text.trim() === "" ? ATTACHMENTS_ONLY : item.text;
        rows.push(
          injected === null
            ? { key, kind: "captain", text }
            : { key, kind: "event", text: injected.summary, source: injected.source },
        );
        break;
      }
      case "assistant_message": {
        const last = rows[rows.length - 1];
        if (replying && last !== undefined && last.kind === "mate") last.text += item.text;
        else rows.push({ key, kind: "mate", text: item.text });
        replying = true;
        break;
      }
      case "tool_call":
        rows.push({ key, kind: "tool", text: toolSummary(item), status: item.status });
        break;
      case "error":
        rows.push({ key, kind: "error", text: item.message });
        break;
      case "notification":
        rows.push(
          item.level === "error"
            ? { key, kind: "error", text: item.message }
            : { key, kind: "event", text: item.message, source: "other" },
        );
        break;
      case "compaction":
        pushCompaction(rows, key, item.status, (rowKey, text) => ({
          key: rowKey,
          kind: "event" as const,
          text,
          source: "other" as const,
        }));
        break;
      default:
        break;
    }
  });
  return fileRows(rows).filter((row) => row.kind !== "mate" || row.text.trim() !== "");
}

/**
 * Gives each row its topic: only a captain message or a joined reply that itself starts with a topic tag
 * is filed, and its words are shown without the tag. Everything else — an untagged message, a tool call,
 * an error, an injected note — stays in the chat. Before the empty replies are dropped, so that a reply
 * of a tag alone is not left behind as a blank row in the chat.
 */
function fileRows(rows: readonly RowBody[]): TranscriptRow[] {
  return rows.map((row) => {
    if (row.kind !== "captain" && row.kind !== "mate") return { ...row, topicId: null };
    const tagged = splitTopicTag(row.text);
    if (tagged === null) return { ...row, topicId: null };
    // A tag with nothing after it on a captain message was a message of attachments.
    const text = row.kind === "captain" && tagged.text.trim() === "" ? ATTACHMENTS_ONLY : tagged.text;
    return { ...row, text, topicId: tagged.topicId };
  });
}

/**
 * The rows the captain chose not to see: an event row of a hidden source, and every tool row when `"tool"`
 * is hidden. Everything else is kept as it is, in order.
 */
export function visibleRows(rows: readonly TranscriptRow[], hidden: readonly string[]): TranscriptRow[] {
  return rows.filter((row) => {
    if (row.kind === "tool") return !hidden.includes("tool");
    if (row.kind === "event") return !hidden.includes(row.source);
    return true;
  });
}

/**
 * The rows of the general chat. A row filed under a topic that opens as a thread (`threads`) is left to
 * the thread; any other tagged row — a mistyped id, an item no longer on the board —
 * stays, with its tag put back so the captain sees what it was about.
 */
export function chatRows(rows: readonly TranscriptRow[], threads: ReadonlySet<string>): TranscriptRow[] {
  return rows.flatMap((row) => {
    if (row.topicId === null) return [row];
    if (threads.has(row.topicId)) return [];
    return [{ ...row, text: `${topicTag(row.topicId)} ${row.text}` }];
  });
}
