/**
 * A backlog item as a topic: the tag that files a message under it, and the rule that reads the first
 * mate's conversation back into messages per topic. Pure and shared, so the daemon's log and the chat
 * agree on which message belongs where.
 */
import { z } from "zod";

import { classifyUserMessage } from "./chat-messages";

export const TopicMessageSchema = z.object({
  /**
   * `<agent id>:<seqStart>`: the agent whose timeline the message is from, and where it starts there. A
   * streaming reply keeps its id as it grows, and no two agents' messages can share one. Messages are
   * ordered by `at`, never by this.
   */
  id: z.string(),
  /** "agent" is the closing words of a card's own agent, read from its timeline; the topic log never stores it. */
  from: z.enum(["captain", "mate", "agent"]),
  /** The words, without the topic tag. */
  text: z.string(),
  /** When the timeline recorded it. */
  at: z.string(),
});
export type TopicMessage = z.infer<typeof TopicMessageSchema>;

/** What a captain message of attachments alone says, in the chat and in a thread. */
export const ATTACHMENTS_ONLY = "(attachments)";

/** The tag a message starts with to be filed under backlog item `id`. */
export function topicTag(id: string): string {
  return `[topic: ${id}]`;
}

const TAG = /^\s*\[topic:[ \t]?([\w.-]{1,64})\]\s*/i;

/** A message that starts with a topic tag, as its topic and the text after the tag; null for any other. */
export function splitTopicTag(text: string): { topicId: string; text: string } | null {
  const match = TAG.exec(text);
  if (match === null || match[1] === undefined) return null;
  return { topicId: match[1], text: text.slice(match[0].length) };
}

/** One timeline entry, reduced to what filing needs. */
export interface FilingItem {
  type: string;
  text?: string;
  clientMessageId?: string;
  seqStart: number;
  timestamp: string;
}

/**
 * Whether a timeline entry ends a reply: the kinds the chat draws a row for. Any other entry — reasoning, a
 * plan — is skipped, and the reply continues across it, so the chat and the daemon cut a reply in the same place.
 */
export function endsReply(type: string): boolean {
  return ["user_message", "tool_call", "error", "notification", "compaction"].includes(type);
}

/**
 * The messages of a conversation that belong to a topic: a captain message that Paseo or another agent did
 * not inject and that starts with a tag, and a first-mate reply that itself starts with one. Consecutive
 * assistant messages are joined first, since a streamed reply arrives in pieces. Nothing is filed by
 * inheritance from an earlier message: Paseo never records its own notes in the timeline, so an untagged
 * reply may be to one the timeline does not show.
 */
export function fileTopicMessages(
  items: readonly FilingItem[],
  mateId: string,
): { topicId: string; message: TopicMessage }[] {
  const idOf = (seqStart: number) => `${mateId}:${seqStart}`;
  const filed: { topicId: string; message: TopicMessage }[] = [];
  let reply: { text: string; seq: number; at: string } | null = null;

  function endReply(): void {
    if (reply === null) return;
    const tagged = splitTopicTag(reply.text);
    if (tagged !== null && tagged.text.trim() !== "") {
      filed.push({ topicId: tagged.topicId, message: { id: idOf(reply.seq), from: "mate", text: tagged.text, at: reply.at } });
    }
    reply = null;
  }

  for (const item of items) {
    if (item.type === "assistant_message") {
      if (reply === null) reply = { text: item.text ?? "", seq: item.seqStart, at: item.timestamp };
      else reply.text += item.text ?? "";
      continue;
    }
    if (!endsReply(item.type)) continue;
    endReply();
    if (item.type !== "user_message") continue;
    const text = item.text ?? "";
    const tagged = classifyUserMessage(text, item.clientMessageId) === null ? splitTopicTag(text) : null;
    if (tagged !== null) {
      const words = tagged.text.trim() === "" ? ATTACHMENTS_ONLY : tagged.text;
      filed.push({ topicId: tagged.topicId, message: { id: idOf(item.seqStart), from: "captain", text: words, at: item.timestamp } });
    }
  }
  endReply();
  return filed;
}
