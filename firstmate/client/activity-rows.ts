/**
 * A crewmate's timeline, turned into the rows the Watch view draws.
 *
 * The chat folds the first mate's machinery away, because the captain is
 * talking to it. Watching a crewmate is the opposite: the machinery is the
 * point, so this keeps the reasoning, every tool call with what it ran and
 * what came back, and the plan — the latest one only, since each update
 * restates the whole list.
 */
import { clip, injectedSummary, rowKey, toolDisplayName, type TimelineEntry } from "./transcript-rows";

type TimelineItem = TimelineEntry["item"];
type ToolCallItem = Extract<TimelineItem, { type: "tool_call" }>;
type ToolDetail = ToolCallItem["detail"];
type TodoItem = Extract<TimelineItem, { type: "todo" }>["items"][number];

export type PlanStatus = "pending" | "in_progress" | "completed";

export type ActivityRow =
  | { key: string; kind: "prompt"; text: string }
  | { key: string; kind: "reply"; text: string }
  | { key: string; kind: "reasoning"; text: string }
  | {
      key: string;
      kind: "tool";
      /** Lucide icon name. */
      icon: string;
      label: string;
      summary: string;
      status: ToolCallItem["status"];
      /** What an expanded row shows, or null when there is nothing past the summary. */
      detail: string | null;
      /** A plan's detail is Markdown; everything else is drawn as it came. */
      markdown: boolean;
    }
  | { key: string; kind: "plan"; items: { text: string; status: PlanStatus }[] }
  | { key: string; kind: "event"; text: string }
  | { key: string; kind: "error"; text: string };

/** Longest detail an expanded tool row shows, in lines. */
const DETAIL_LINES = 40;

/** The first or last `max` lines, with a line saying how many were left out. */
export function clipLines(text: string, max: number, keep: "head" | "tail"): string {
  const lines = text.trimEnd().split("\n");
  if (lines.length <= max) return lines.join("\n");
  const left = lines.length - max;
  const note = `… ${left} more line${left === 1 ? "" : "s"}`;
  return keep === "head" ? [...lines.slice(0, max), note].join("\n") : [note, ...lines.slice(-max)].join("\n");
}

/** Joins the parts that exist with a blank line; null when none do. */
function sections(...parts: Array<string | null | undefined>): string | null {
  const present = parts.filter((part): part is string => typeof part === "string" && part.trim() !== "");
  return present.length === 0 ? null : present.join("\n\n");
}

function stringify(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const PLAIN_TEXT_ICONS: Record<string, string> = {
  wrench: "Wrench",
  square_terminal: "SquareTerminal",
  eye: "Eye",
  pencil: "Pencil",
  search: "Search",
  bot: "Bot",
  sparkles: "Sparkles",
  brain: "Brain",
  mic_vocal: "MicVocal",
};

/** A tool call's icon, name, one-line summary, and what expanding it shows. */
export function describeTool(item: ToolCallItem): Pick<
  Extract<ActivityRow, { kind: "tool" }>,
  "icon" | "label" | "summary" | "detail" | "markdown"
> {
  const detail: ToolDetail = item.detail;
  const failure = item.status === "failed" ? stringify(item.error) : null;
  const withFailure = (body: string | null) => sections(body, failure === null ? null : `Error: ${failure}`);
  switch (detail.type) {
    case "shell": {
      const exit = detail.exitCode === undefined || detail.exitCode === null ? null : `exit ${detail.exitCode}`;
      const output = detail.output === undefined ? null : clipLines(detail.output, DETAIL_LINES, "tail");
      return {
        icon: "SquareTerminal",
        label: "Shell",
        summary: clip(detail.command),
        detail: withFailure(sections(`$ ${detail.command}`, output, exit)),
        markdown: false,
      };
    }
    case "read":
      return {
        icon: "FileText",
        label: "Read",
        summary: detail.filePath,
        detail: withFailure(detail.content === undefined ? null : clipLines(detail.content, DETAIL_LINES, "head")),
        markdown: false,
      };
    case "edit": {
      const diff =
        detail.unifiedDiff ??
        sections(
          detail.oldString === undefined ? null : detail.oldString.split("\n").map((line) => `- ${line}`).join("\n"),
          detail.newString === undefined ? null : detail.newString.split("\n").map((line) => `+ ${line}`).join("\n"),
        );
      return {
        icon: "Pencil",
        label: "Edit",
        summary: detail.filePath,
        detail: withFailure(diff === null ? null : clipLines(diff, DETAIL_LINES, "head")),
        markdown: false,
      };
    }
    case "write":
      return {
        icon: "FilePlus",
        label: "Write",
        summary: detail.filePath,
        detail: withFailure(detail.content === undefined ? null : clipLines(detail.content, DETAIL_LINES, "head")),
        markdown: false,
      };
    case "search": {
      const found =
        detail.content ??
        (detail.filePaths === undefined ? null : detail.filePaths.join("\n")) ??
        (detail.webResults === undefined ? null : detail.webResults.map((result) => `${result.title} — ${result.url}`).join("\n"));
      return {
        icon: "Search",
        label: "Search",
        summary: clip(detail.query),
        detail: withFailure(found === null ? null : clipLines(found, DETAIL_LINES, "head")),
        markdown: false,
      };
    }
    case "fetch":
      return {
        icon: "Globe",
        label: "Fetch",
        summary: detail.url,
        detail: withFailure(
          sections(detail.prompt, detail.result === undefined ? null : clipLines(detail.result, DETAIL_LINES, "head")),
        ),
        markdown: false,
      };
    case "sub_agent": {
      // What the sub-agent did, one line a tool, when the provider lists it; its log otherwise.
      const actions = detail.actions?.map((action) => `${action.toolName}${action.summary === undefined ? "" : ` ${action.summary}`}`);
      return {
        icon: "Bot",
        label: "Agent",
        summary: clip(detail.description ?? detail.subAgentType ?? ""),
        detail: withFailure(clipLines(actions === undefined ? detail.log : actions.join("\n"), DETAIL_LINES, "tail")),
        markdown: false,
      };
    }
    case "worktree_setup":
      return {
        icon: "GitBranch",
        label: "Worktree",
        summary: detail.branchName,
        detail: withFailure(clipLines(detail.log, DETAIL_LINES, "tail")),
        markdown: false,
      };
    case "plan":
      return { icon: "ListChecks", label: "Plan", summary: "Proposed a plan", detail: withFailure(detail.text), markdown: true };
    case "plain_text":
      return {
        icon: PLAIN_TEXT_ICONS[detail.icon ?? ""] ?? "Wrench",
        label: detail.label ?? toolDisplayName(item.name),
        summary: detail.label === undefined ? "" : toolDisplayName(item.name),
        detail: withFailure(detail.text === undefined ? null : clipLines(detail.text, DETAIL_LINES, "head")),
        markdown: false,
      };
    default: {
      const input = stringify(detail.input);
      const output = stringify(detail.output);
      return {
        icon: "Wrench",
        label: toolDisplayName(item.name),
        summary: input === null ? "" : clip(input, 100),
        detail: withFailure(
          sections(
            input === null ? null : clipLines(input, DETAIL_LINES, "head"),
            output === null ? null : clipLines(output, DETAIL_LINES, "head"),
          ),
        ),
        markdown: false,
      };
    }
  }
}

function planStatus(item: TodoItem): PlanStatus {
  return item.status ?? (item.completed ? "completed" : "pending");
}

/**
 * Timeline entries to rows. Consecutive assistant messages are one row, and
 * so is consecutive reasoning: both stream in pieces that split anywhere.
 */
export function activityRows(entries: readonly TimelineEntry[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  entries.forEach((entry) => {
    const key = rowKey(entry);
    const item = entry.item;
    const last = rows[rows.length - 1];
    switch (item.type) {
      case "user_message": {
        const summary = injectedSummary(item.text);
        rows.push(summary === null ? { key, kind: "prompt", text: item.text } : { key, kind: "event", text: summary });
        break;
      }
      case "assistant_message":
        if (last !== undefined && last.kind === "reply") last.text += item.text;
        else rows.push({ key, kind: "reply", text: item.text });
        break;
      case "reasoning":
        if (last !== undefined && last.kind === "reasoning") last.text += item.text;
        else rows.push({ key, kind: "reasoning", text: item.text });
        break;
      case "tool_call":
        rows.push({ key, kind: "tool", status: item.status, ...describeTool(item) });
        break;
      case "todo": {
        const previous = rows.findIndex((row) => row.kind === "plan");
        if (previous !== -1) rows.splice(previous, 1);
        // An emptied list replaces the old plan with nothing, not with a bare heading.
        if (item.items.length > 0) {
          rows.push({ key, kind: "plan", items: item.items.map((todo) => ({ text: todo.text, status: planStatus(todo) })) });
        }
        break;
      }
      case "error":
        rows.push({ key, kind: "error", text: item.message });
        break;
      case "notification":
        rows.push({ key, kind: item.level === "error" ? "error" : "event", text: item.message });
        break;
      case "compaction":
        rows.push({ key, kind: "event", text: item.status === "loading" ? "Compacting context…" : "Context compacted" });
        break;
      default:
        break;
    }
  });
  return rows.filter((row) => (row.kind !== "reply" && row.kind !== "reasoning") || row.text.trim() !== "");
}
