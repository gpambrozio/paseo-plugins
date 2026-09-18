/**
 * What one priced model looks like on the wire, and the single RPC that loads
 * them.
 *
 * Both upstreams are normalized to this shape in `server/normalize.ts` before
 * anything is cached or sent, which is what keeps the 4.7 MB models.dev
 * document out of both the cache file and the RPC payload.
 *
 * **`null` means "the upstream does not say", not "no".** The table draws it as
 * an em dash, the same way the reference screenshot does. Only `inputCost` and
 * `outputCost` are required: a model with no published price cannot be ranked
 * and is dropped while normalizing rather than carried as a hole.
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const PriceRowSchema = z.object({
  /** A `PROVIDERS` id from `shared/providers.ts`, not the upstream's own name. */
  providerId: z.string(),
  /** The upstream's model id. Unique only within a provider. */
  modelId: z.string(),
  name: z.string(),
  /** Total context window in tokens. */
  contextTokens: z.number().nullable(),
  /** Maximum tokens in one completion. */
  outputTokens: z.number().nullable(),
  /** USD per 1M tokens. */
  inputCost: z.number(),
  outputCost: z.number(),
  cacheReadCost: z.number().nullable(),
  reasoning: z.boolean().nullable(),
  toolCall: z.boolean().nullable(),
  structuredOutput: z.boolean().nullable(),
  temperature: z.boolean().nullable(),
  /** ISO date, when the upstream publishes one. */
  releaseDate: z.string().nullable(),
});
export type PriceRow = z.infer<typeof PriceRowSchema>;

/**
 * How one upstream fetch went, per source. Reported alongside the rows rather
 * than thrown, because one source failing must leave the other's rows on
 * screen — the surface shows a banner over a table that still works.
 */
export const SourceStatusSchema = z.object({
  id: z.string(),
  /** Epoch ms the rows were fetched. For a stale-cache fallback, when the *cache* was fetched. */
  fetchedAt: z.number(),
  /** Whether these rows came from disk rather than the network on this call. */
  cached: z.boolean(),
  /** Set when the fetch failed. Rows may still be present, from a stale cache. */
  error: z.string().nullable(),
});
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const loadPricing = defineRpc({
  name: "pricing.load",
  input: z.object({
    /** Provider ids to include. The daemon fetches only the sources these need. */
    providers: z.array(z.string()),
    /** Bypass the cache TTL. The Refresh button, not a mount. */
    refresh: z.boolean().default(false),
  }),
  output: z.object({
    rows: z.array(PriceRowSchema),
    sources: z.array(SourceStatusSchema),
  }),
});
