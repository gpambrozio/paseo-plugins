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
    boardCollapsed: z.boolean().default(false),
    pollSeconds: z.number().int().min(1).max(120).default(5),
  }),
});

export type DisplaySettings = z.infer<typeof displaySettings.schema>;
