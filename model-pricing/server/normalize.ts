/**
 * Third-party JSON in, `PriceRow[]` out. Pure, so `normalize.test.ts` covers
 * both upstreams from checked-in fixtures and nothing here ever fetches.
 *
 * Two rules run through all of it:
 *
 * - **A bad entry is skipped, never thrown.** These are other people's
 *   documents: 7,850 models in the models.dev catalog on the day this was
 *   written, any one of which can gain a field, lose one, or go null. Rejecting
 *   the whole catalog over one malformed model would empty the table for a
 *   typo upstream.
 * - **Absent is `null`, not `false`.** The table draws `null` as an em dash.
 *   models.dev genuinely omits `structured_output` for about a third of its
 *   models, and printing "No" for those would be an assertion nobody made.
 *
 * The one thing a row may not lack is a price, because a row with no price
 * cannot be ranked against the others; those are dropped.
 */
import type { PriceRow } from "../shared/pricing";
import { providersOfSource } from "../shared/providers";

// ---------------------------------------------------------------------------
// Defensive readers. Every one takes `unknown` and answers null rather than
// throwing, because every one of them is reading somebody else's document.

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** A finite, non-negative number. Rejects NaN, Infinity and negative prices. */
function asCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** OpenRouter prices arrive as decimal *strings* per token, e.g. `"0.00001"`. */
function asNumericString(value: unknown): number | null {
  if (typeof value === "number") return asCount(value);
  if (typeof value !== "string" || value.trim() === "") return null;
  return asCount(Number(value));
}

// ---------------------------------------------------------------------------
// models.dev — https://models.dev/api.json
//
// `{ [providerKey]: { id, name, models: { [modelId]: { … } } } }`. Its model
// shape is the closest thing to this table's columns that anyone publishes,
// which is why four of the five providers are read from it.

export function normalizeModelsDev(document: unknown): PriceRow[] {
  const root = asRecord(document);
  if (root === null) throw new Error("models.dev did not answer with a JSON object.");

  const rows: PriceRow[] = [];
  // Only the providers this plugin shows. The catalog carries 222 of them and
  // parsing the rest would be work thrown away.
  for (const provider of providersOfSource("models-dev")) {
    if (provider.catalogKey === null) continue;
    const models = asRecord(asRecord(root[provider.catalogKey])?.["models"]);
    if (models === null) continue;
    for (const raw of Object.values(models)) {
      const row = modelsDevRow(provider.id, raw);
      if (row !== null) rows.push(row);
    }
  }
  return rows;
}

function modelsDevRow(providerId: string, raw: unknown): PriceRow | null {
  const model = asRecord(raw);
  if (model === null) return null;

  const modelId = asString(model["id"]);
  if (modelId === null) return null;

  const cost = asRecord(model["cost"]);
  const inputCost = asCount(cost?.["input"]);
  const outputCost = asCount(cost?.["output"]);
  if (inputCost === null || outputCost === null) return null;

  const limit = asRecord(model["limit"]);
  return {
    providerId,
    modelId,
    name: asString(model["name"]) ?? modelId,
    contextTokens: asCount(limit?.["context"]),
    outputTokens: asCount(limit?.["output"]),
    inputCost,
    outputCost,
    reasoning: asBool(model["reasoning"]),
    toolCall: asBool(model["tool_call"]),
    structuredOutput: asBool(model["structured_output"]),
    temperature: asBool(model["temperature"]),
    releaseDate: asString(model["release_date"]),
  };
}

// ---------------------------------------------------------------------------
// OpenRouter — https://openrouter.ai/api/v1/models
//
// Read first-hand rather than through models.dev's mirror of it, which trails
// by a few dozen models. Unauthenticated, and the only vendor here that
// publishes its own prices.

/** The provider id OpenRouter rows are filed under. */
const OPENROUTER_ID = "openrouter";

/**
 * Per-token dollars → dollars per 1M tokens, which is what the table shows.
 *
 * The rounding is not cosmetic. OpenRouter states prices as decimal strings per
 * token, and multiplying one by a million lands on a float that is a hair off a
 * round number: `0.0000002 * 1e6` is `0.19999999999999998`. `formatPrice` asks
 * for the fewest decimals that round-trip *exactly*, so that value printed as
 * `$0.2000` — and a quarter of OpenRouter's prices came out four decimals wide
 * in a monospaced column meant to be scanned. Twelve significant digits is far
 * more precision than any published price carries and snaps the noise away.
 */
function perMillion(perToken: number): number {
  return Number((perToken * 1_000_000).toPrecision(12));
}

/**
 * OpenRouter has no capability booleans. What it has is `supported_parameters`,
 * a list of the request fields a model accepts, and these four entries are the
 * same four facts the other upstream states outright.
 */
const PARAMETERS = {
  reasoning: "reasoning",
  toolCall: "tools",
  structuredOutput: "structured_outputs",
  temperature: "temperature",
} as const;

export function normalizeOpenRouter(document: unknown): PriceRow[] {
  const data = asRecord(document)?.["data"];
  if (!Array.isArray(data)) throw new Error("OpenRouter did not answer with a `data` array.");

  const rows: PriceRow[] = [];
  for (const raw of data) {
    const row = openRouterRow(raw);
    if (row !== null) rows.push(row);
  }
  return rows;
}

function openRouterRow(raw: unknown): PriceRow | null {
  const model = asRecord(raw);
  if (model === null) return null;

  const modelId = asString(model["id"]);
  if (modelId === null) return null;

  const pricing = asRecord(model["pricing"]);
  const inputCost = asNumericString(pricing?.["prompt"]);
  const outputCost = asNumericString(pricing?.["completion"]);
  if (inputCost === null || outputCost === null) return null;

  const supported = model["supported_parameters"];
  // An absent list is unknown, not "supports nothing" — so every flag stays
  // null and the row draws four em dashes rather than four confident Nos.
  const accepts = Array.isArray(supported) ? new Set(supported.filter((entry) => typeof entry === "string")) : null;
  const flag = (parameter: string): boolean | null => (accepts === null ? null : accepts.has(parameter));

  return {
    providerId: OPENROUTER_ID,
    modelId,
    name: asString(model["name"]) ?? modelId,
    contextTokens: asCount(model["context_length"]),
    outputTokens: asCount(asRecord(model["top_provider"])?.["max_completion_tokens"]),
    inputCost: perMillion(inputCost),
    outputCost: perMillion(outputCost),
    reasoning: flag(PARAMETERS.reasoning),
    toolCall: flag(PARAMETERS.toolCall),
    structuredOutput: flag(PARAMETERS.structuredOutput),
    temperature: flag(PARAMETERS.temperature),
    // OpenRouter publishes `created` as epoch seconds, not a release date.
    releaseDate: epochSecondsToIso(model["created"]),
  };
}

function epochSecondsToIso(value: unknown): string | null {
  const seconds = asCount(value);
  if (seconds === null || seconds === 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : (date.toISOString().split("T")[0] ?? null);
}
