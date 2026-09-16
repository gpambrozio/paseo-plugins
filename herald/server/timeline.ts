/**
 * Turns what the hooks hand us — a timeline snapshot or a permission request —
 * into the plain text an entry carries and a summary is written from. Nothing
 * here touches the network or a model, which is what makes it the part with
 * tests.
 */
import type { AgentPermissionRequest, AgentTimelineItem } from "@getpaseo/protocol/agent-types";

import type { AttentionReason } from "../shared/herald";

/**
 * Everything the agent said after the user's last message. Only assistant text
 * and errors count: reasoning is the agent talking to itself, and tool calls
 * are how it got there, neither of which the user is being told.
 */
export function latestOutputText(timeline: readonly AgentTimelineItem[]): string {
  let output = "";
  for (const item of timeline) {
    if (item.type === "user_message") {
      output = "";
    } else if (item.type === "assistant_message") {
      output = joinText(output, item.text);
    } else if (item.type === "error" && item.message.trim() !== "") {
      output = `${output.trimEnd()}\nError: ${item.message.trim()}\n`;
    }
  }
  return output.trim();
}

/**
 * A streamed reply reaches the snapshot as several `assistant_message` items
 * that can split anywhere — between words, or in the middle of one — and the
 * whitespace is inside the chunks. So chunks are concatenated as they are,
 * which is what Paseo's own helper does. The one exception is two separate
 * messages in one turn, text before and after a tool call, which arrive
 * without a space between them: a sentence end followed by a capital letter
 * gets one. A mid-word split never looks like that.
 */
function joinText(left: string, right: string): string {
  if (left === "") return right;
  if (/[.!?]$/.test(left) && /^[A-Z]/.test(right)) return `${left} ${right}`;
  return left + right;
}

/** The user's most recent message, so the summary knows what was asked for. */
export function lastUserMessage(timeline: readonly AgentTimelineItem[]): string | null {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.type === "user_message" && item.text.trim() !== "") return item.text.trim();
  }
  return null;
}

export interface PermissionDescription {
  reason: AttentionReason;
  headline: string;
  detail: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionLabels(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => {
      if (typeof option === "string") return option.trim();
      if (isRecord(option) && typeof option.label === "string") return option.label.trim();
      return "";
    })
    .filter((label) => label !== "");
}

/**
 * The shell command behind a tool permission, wherever the provider put it.
 * Paseo's typed `detail` is preferred; the raw input keys are what Claude and
 * Codex send when the detail is absent.
 */
export function shellCommand(request: AgentPermissionRequest): string | null {
  if (request.detail?.type === "shell" && request.detail.command.trim() !== "") {
    return request.detail.command.trim();
  }
  const input = request.input;
  if (!isRecord(input)) return null;
  if (typeof input.command === "string" && input.command.trim() !== "") return input.command.trim();
  if (typeof input.cmd === "string" && input.cmd.trim() !== "") return input.cmd.trim();
  return null;
}

/**
 * What to show and say for a pause. Paseo already flattens the first
 * AskUserQuestion into `title` and `description`; the raw `questions` array is
 * read as well so the count and the options survive a provider that did not.
 */
export function describePermission(request: AgentPermissionRequest): PermissionDescription {
  if (request.kind === "question") {
    const questions = isRecord(request.input) && Array.isArray(request.input.questions)
      ? request.input.questions.filter(isRecord)
      : [];
    const first = questions[0];
    const headline =
      request.title?.trim() ||
      (typeof first?.question === "string" ? first.question.trim() : "") ||
      "Has a question for you";
    const options = optionLabels(first?.options);
    const suffix = questions.length > 1 ? ` (${questions.length} questions)` : "";
    return {
      reason: "question",
      headline: `${headline}${suffix}`,
      detail: options.length > 0 ? options.join(" / ") : request.description?.trim() || null,
    };
  }
  if (request.kind === "plan") {
    return {
      reason: "plan",
      headline: request.title?.trim() || "Plan ready for your approval",
      detail: request.description?.trim() || null,
    };
  }
  const command = shellCommand(request);
  return {
    reason: "permission",
    headline: request.title?.trim() || `Wants to use ${request.name}`,
    detail: command ?? request.description?.trim() ?? null,
  };
}

/** Markdown and code punctuation read aloud is noise; strip what a voice would spell out. */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_~>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first `maxWords` words, cut at a sentence end when one comes first. */
export function firstWords(text: string, maxWords: number): string {
  const words = plainText(text).split(" ").filter((word) => word !== "");
  if (words.length === 0) return "";
  const taken = words.slice(0, maxWords);
  const joined = taken.join(" ");
  const sentenceEnd = joined.search(/[.!?](\s|$)/);
  if (sentenceEnd > 20) return joined.slice(0, sentenceEnd + 1);
  return taken.length < words.length ? `${joined}…` : joined;
}

/** One line of at most `max` characters, for a preview under a title. */
export function preview(text: string, max = 90): string {
  const line = plainText(text);
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

export interface SpeechSource {
  workspaceTitle: string | null;
  agentTitle: string | null;
  reason: AttentionReason;
  headline: string;
  detail: string | null;
}

/** What to call the work: the agent's title if it has one, else the workspace's. */
export function displayName(source: { workspaceTitle: string | null; agentTitle: string | null }): string | null {
  return source.agentTitle?.trim() || source.workspaceTitle?.trim() || null;
}

/**
 * What is said when no model wrote a summary: the event kind stated plainly,
 * with the headline and whatever detail there is. Deliberately dull — it has
 * to be right without having read anything.
 */
export function fallbackSpeech(source: SpeechSource): string {
  const name = displayName(source) ?? "An agent";
  const headline = plainText(source.headline);
  const detail = source.detail === null ? "" : plainText(source.detail);
  switch (source.reason) {
    case "question":
      return `${name} has a question: ${headline}${detail === "" ? "" : ` Options: ${detail}.`}`;
    case "plan":
      return `${name} has a plan ready for your approval. ${headline}`;
    case "permission":
      return `${name} is asking for permission. ${headline}${detail === "" ? "" : ` Command: ${detail}.`}`;
    case "finished":
      return detail === "" ? `${name} finished.` : `${name} finished. ${firstWords(detail, 30)}`;
    case "error":
      return `${name} stopped with an error. ${headline}`;
    case "canceled":
      return `${name} was interrupted. ${headline}`;
  }
}
