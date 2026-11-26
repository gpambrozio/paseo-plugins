/**
 * How the board is drawn, for this daemon's clients: a host settings document
 * the app reads and writes on its own. None of it means anything to the
 * daemon, which is why it is not in `config.json` — see "Which side owns a
 * persisted value" in the root AGENTS.md.
 */
import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

import { COLUMN_IDS } from "./fleet";

export const POLL_SECONDS = [3, 5, 10, 30] as const;

/** What the chat can hide, in the order the settings screen lists them: each source of an injected message, then tool calls. */
export const CHAT_KINDS = ["agent", "notice", "watch", "tool"] as const;

export const displaySettings = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Board columns, in the order the captain arranged them. Unknown ids are dropped when read. */
    columnOrder: z.array(z.string()).default([...COLUMN_IDS]),
    /** Columns folded down to a narrow strip. */
    collapsedColumns: z.array(z.string()).default([]),
    /**
     * The chat pane's share of the surface's width. A share rather than pixels,
     * because it was chosen against one window and has to survive another.
     */
    chatWidthFraction: z.number().min(0.2).max(0.8).default(0.36),
    chatCollapsed: z.boolean().default(false),
    /** The crew panel beside the topics: hidden until asked for, so the board of topics has the width. */
    boardCollapsed: z.boolean().default(true),
    pollSeconds: z.number().int().min(1).max(120).default(5),
    /** Kinds of row the chat leaves out, from `CHAT_KINDS`. */
    hiddenChatKinds: z.array(z.string()).default([]),
    /** When the newest message the captain has had open was said, by topic id or, for a topic with no backlog item, agent id: what an unread dot is judged against. */
    topicsRead: z.record(z.string(), z.string()).default({}),
  }),
});

export type DisplaySettings = z.infer<typeof displaySettings.schema>;
