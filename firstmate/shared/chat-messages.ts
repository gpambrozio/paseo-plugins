/**
 * Which user messages in the first mate's inbox are the captain's own words and which were put there by
 * something else — another agent, Paseo, the board, a watch — and the one line that says
 * what each of the others is. Pure, and shared, because the chat, the crewmate's transcript and the topic
 * log all have to agree on it.
 */
/**
 * How a watch message is told from the captain's words in a timeline: the plugin sends it with a
 * `messageId` starting with this, which the daemon records as the timeline item's `clientMessageId`.
 * Text alone cannot tell them apart — the captain can paste a watch block — so the chat folds a message
 * as a watch message only when it carries this id.
 */
export const WATCH_MESSAGE_ID_PREFIX = "firstmate-watch-";

function isWatchMessageId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(WATCH_MESSAGE_ID_PREFIX);
}

/** What put a message that is not the captain's into the inbox; these are the kinds the chat can hide. */
export type ChatSource = "agent" | "notice" | "watch";

export type ClassifiedMessage = { source: ChatSource; summary: string };

/** Envelopes a message is wrapped in when it did not come from the captain. */
const ENVELOPES = ["paseo-system", "firstmate-board"] as const;

/** One line, at most `max` characters. */
export function clip(text: string, max = 120): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

/**
 * A watch message — `<firstmate-watch name=… ran=…>` blocks one after another, a
 * `<firstmate-watch-dropped count="N"/>` first when older ones were dropped — as one line naming the
 * watches: "Watch: pr-watch", "Watches: pr-watch, hello (failed) · 3 older dropped". Null for anything
 * else. Called only for a message the plugin sent as one (`isWatchMessageId`); a script cannot write a
 * tag into its own output (the runner escapes them), so every one found is the plugin's.
 */
function watchSummary(trimmed: string): string | null {
  if (!/^<firstmate-watch(-dropped)?[\s>/]/.test(trimmed)) return null;
  if (!/(<\/firstmate-watch>|\/>)$/.test(trimmed)) return null;
  const blocks = [...trimmed.matchAll(/<firstmate-watch name="([^"]*)"([^>]*)>/g)].map((match) => ({
    name: match[1] ?? "",
    failed: (match[2] ?? "").includes("failed="),
  }));
  const names = [...new Set(blocks.map((block) => block.name))].map((name) =>
    blocks.some((block) => block.name === name && block.failed) ? `${name} (failed)` : name,
  );
  const dropped = /<firstmate-watch-dropped count="(\d+)"\/>/.exec(trimmed)?.[1];
  const head = names.length === 0 ? "Watches" : `${names.length === 1 ? "Watch" : "Watches"}: ${names.join(", ")}`;
  return dropped === undefined ? head : `${head} · ${dropped} older dropped`;
}

/** The tag a message opens with — `<tag>` or `<tag attr="…">` — and what follows it; null when it opens with another. */
function openingTag(trimmed: string, tag: string): { attributes: string; body: string } | null {
  const match = new RegExp(`^<${tag}(\\s[^>]*)?>`).exec(trimmed);
  if (match === null) return null;
  return { attributes: match[1] ?? "", body: trimmed.slice(match[0].length).replace(new RegExp(`</${tag}>\\s*$`), "") };
}

/** The first line of an envelope's body that is words rather than a nested tag, or the envelope's name. */
function firstLineOf(body: string, tag: string): string {
  const first = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("<"));
  return first ?? tag;
}

/**
 * What put this user message into the inbox, and its first line — "Agent 3f2a… (Fix login) finished." — or
 * null for the captain's own words. `clientMessageId` is the timeline item's: only a message the plugin
 * sent as a watch message is folded as one, so the captain's words stay visible even when they look like a
 * watch note.
 */
export function classifyUserMessage(text: string, clientMessageId?: string): ClassifiedMessage | null {
  const trimmed = text.trim();
  if (isWatchMessageId(clientMessageId)) {
    const watch = watchSummary(trimmed);
    if (watch !== null) return { source: "watch", summary: watch };
  }
  const agent = openingTag(trimmed, "agent-message");
  if (agent !== null) return { source: "agent", summary: clip(firstLineOf(agent.body, "agent-message")) };
  for (const tag of ENVELOPES) {
    const opened = openingTag(trimmed, tag);
    if (opened === null) continue;
    const source = tag === "paseo-system" && /\bkind="agent-message"/.test(opened.attributes) ? "agent" : "notice";
    return { source, summary: firstLineOf(opened.body, tag) };
  }
  return null;
}
