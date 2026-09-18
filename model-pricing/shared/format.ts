/**
 * Every number the table prints, and the relative-cost ranking behind its last
 * column. Pure and dependency-free, so `shared/format.test.ts` covers the lot
 * without a daemon, a fetch or a renderer.
 *
 * It lives in `shared/` rather than `client/` only because that is where tests
 * can reach it; nothing on the server calls it.
 */
import type { PriceRow } from "./pricing";

/** The em dash the table shows wherever an upstream did not say. */
export const UNKNOWN = "—";

/**
 * Token counts the way the reference screenshot writes them: `1.05M`, `1M`,
 * `131K`, `128K`. Powers of two land on the odd-looking ones — a 1048576-token
 * window really is 1.05M — and that is deliberate, because rounding it to `1M`
 * would print the same string for two different windows.
 */
export function formatTokens(tokens: number | null): string {
  if (tokens === null || !Number.isFinite(tokens) || tokens <= 0) return UNKNOWN;
  // The bound is 999_500, not 1_000_000: anything above it rounds to 1000K,
  // which is a thousand thousands written the long way.
  if (tokens >= 999_500) return `${trimZeros((tokens / 1_000_000).toFixed(2))}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/**
 * USD per 1M tokens. A whole number prints bare (`$10`), anything else gets at
 * least two decimals (`$1.40`, `$0.22`) and as many more as it takes not to
 * lose the number — Nemotron Super is $0.015 and must not read as $0.02.
 */
export function formatPrice(usd: number): string {
  if (!Number.isFinite(usd)) return UNKNOWN;
  if (Number.isInteger(usd)) return `$${usd}`;
  return `$${usd.toFixed(significantDecimals(usd))}`;
}

const MAX_DECIMALS = 4;

/** The fewest decimals that still round-trip this value, never fewer than two. */
function significantDecimals(value: number): number {
  for (let decimals = 2; decimals < MAX_DECIMALS; decimals += 1) {
    if (Number(value.toFixed(decimals)) === value) return decimals;
  }
  return MAX_DECIMALS;
}

/** The PRICE column: input and output together, as `$10 / $50`. */
export function formatPricePair(input: number, output: number): string {
  return `${formatPrice(input)} / ${formatPrice(output)}`;
}

/**
 * The RELATIVE column. One decimal, so the column stays a column.
 *
 * Zero is its own word. OpenRouter carries a couple of dozen genuinely free
 * models, and `0.0×` beside a header promising "cheapest = 1.0×" reads as a
 * bug; "Free" says the row is off the scale rather than at the bottom of it.
 */
export function formatRelative(multiple: number): string {
  if (!Number.isFinite(multiple)) return UNKNOWN;
  if (multiple === 0) return "Free";
  return `${multiple.toFixed(1)}×`;
}

/** A capability flag. `null` is "the upstream did not say", not "no". */
export function formatFlag(value: boolean | null): string {
  if (value === null) return UNKNOWN;
  return value ? "Yes" : UNKNOWN;
}

/**
 * What one model costs, as a single number, under an assumed token mix:
 * `share` of the spend is input and the rest is output.
 *
 * There is no neutral choice here, which is why `shared/settings.ts` makes it a
 * setting — the ranking genuinely reorders between an input-heavy agent
 * workload and an output-heavy chat.
 */
export function blendedCost(row: PriceRow, share: number): number {
  return row.inputCost * share + row.outputCost * (1 - share);
}

/**
 * The RELATIVE column for a whole table: each row's blended cost over the
 * cheapest row's, so the cheapest is exactly `1.0×`.
 *
 * Computed over the rows *currently visible*, not the whole catalog, because
 * "1.0×" has to mean "the cheapest thing on this screen" — a baseline drawn
 * from a provider the user has switched off would be a multiple of a price
 * they cannot see.
 *
 * Keyed by `providerId/modelId`: a model id is unique only within a provider,
 * and the same model reaches this table twice when OpenRouter is on.
 */
export function relativeCosts(rows: readonly PriceRow[], share: number): Map<string, number> {
  const blended = new Map<string, number>();
  let cheapest = Infinity;
  for (const row of rows) {
    const cost = blendedCost(row, share);
    blended.set(rowKey(row), cost);
    if (cost > 0 && cost < cheapest) cheapest = cost;
  }
  // The baseline deliberately skips free rows: with a zero in it, every paid
  // model would divide by nothing. Free rows keep their 0 and print as "Free".
  //
  // No paid row at all — searching "free" narrows the table to exactly that —
  // means there is no baseline to divide by. A free row still has to answer 0
  // so it still prints "Free"; only a non-zero cost with no baseline falls back
  // to 1, and that combination cannot arise.
  if (!Number.isFinite(cheapest)) {
    return new Map([...blended].map(([key, cost]) => [key, cost === 0 ? 0 : 1]));
  }
  return new Map([...blended].map(([key, cost]) => [key, cost / cheapest]));
}

export function rowKey(row: PriceRow): string {
  return `${row.providerId}/${row.modelId}`;
}

/**
 * "just now", "3 minutes ago". Used for the header's "updated" line, so the
 * user can tell a live fetch from a day-old cache at a glance.
 */
export function relativeTime(epochMs: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - epochMs) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
