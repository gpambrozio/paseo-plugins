/**
 * The summary card Herald puts in an agent's transcript. The daemon appends
 * it (`server/card.ts`), the app draws it (`client/timeline-card.tsx`), and
 * this `kind`/`version` pair is the only thing tying the two together — a
 * mismatch is not a compile error, it is a row that renders as unavailable.
 */
import { z } from "zod";

import { AttentionReasonSchema, SummaryStateSchema } from "./herald";

/** Unique within this plugin; the host scopes it by plugin id. */
export const HERALD_CARD_KIND = "herald-summary";

/** Bump when `HeraldCardSchema` changes shape. */
export const HERALD_CARD_VERSION = 1;

export const HeraldCardSchema = z.object({
  eventId: z.string(),
  reason: AttentionReasonSchema,
  /** What the work is called: the agent's title if it has one, else the workspace's. */
  name: z.string().nullable(),
  headline: z.string(),
  detail: z.string().nullable(),
  summary: SummaryStateSchema,
});
export type HeraldCard = z.infer<typeof HeraldCardSchema>;
