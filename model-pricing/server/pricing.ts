/**
 * The `pricing.load` handler: decide which upstreams the requested providers
 * need, load each from cache or network, and hand back one flat list of rows
 * plus a status per source.
 *
 * **One source failing must not blank the table.** Each source is settled on
 * its own and its error travels back as a string beside the rows instead of
 * being thrown, so OpenRouter being down leaves the Anthropic and OpenAI rows
 * on screen under a banner. A failure also falls back to a stale cache when
 * there is one — yesterday's prices, clearly labelled, beat an empty table.
 */
import type { z } from "zod";

import { isFresh, type PricingCache } from "./cache";
import { DEFAULT_DEPS, fetchSource, SOURCE_LABELS, type FetchDeps } from "./sources";
import type { PriceRow, SourceStatus, loadPricing } from "../shared/pricing";
import { sourcesFor, type SourceId } from "../shared/providers";

type Input = z.output<typeof loadPricing.input>;
type Output = z.input<typeof loadPricing.output>;

interface SourceLoad {
  rows: readonly PriceRow[];
  status: SourceStatus;
}

export function createPricingHandler(
  cache: PricingCache,
  deps: FetchDeps = DEFAULT_DEPS,
): (input: Input) => Promise<Output> {
  /**
   * One fetch per source at a time. The surface and the settings screen can
   * both ask while the first answer is still in flight, and four of the five
   * providers share the models.dev document — without this, toggling providers
   * quickly would download it several times over.
   */
  const inFlight = new Map<SourceId, Promise<SourceLoad>>();

  function load(source: SourceId, refresh: boolean): Promise<SourceLoad> {
    const running = inFlight.get(source);
    // A refresh must not be answered by a load already in flight: the user
    // pressed Refresh precisely because they doubt what is on screen.
    if (running !== undefined && !refresh) return running;

    const started = loadSource(cache, deps, source, refresh).finally(() => {
      if (inFlight.get(source) === started) inFlight.delete(source);
    });
    inFlight.set(source, started);
    return started;
  }

  return async function loadPricingHandler({ providers, refresh }: Input): Promise<Output> {
    const wanted = new Set(providers);
    const loads = await Promise.all(sourcesFor(providers).map((source) => load(source, refresh)));

    // A source serves several providers, so its rows are filtered down to the
    // ones actually asked for — switching Anthropic off still fetches
    // models.dev while OpenAI is on, but must not return Anthropic's rows.
    const rows = loads.flatMap((entry) => entry.rows.filter((row) => wanted.has(row.providerId)));
    return { rows, sources: loads.map((entry) => entry.status) };
  };
}

async function loadSource(
  cache: PricingCache,
  deps: FetchDeps,
  source: SourceId,
  refresh: boolean,
): Promise<SourceLoad> {
  const cached = await cache.read(source);
  if (cached !== null && !refresh && isFresh(cached)) {
    return { rows: cached.rows, status: status(source, cached.fetchedAt, true, null) };
  }

  try {
    const result = await fetchSource(deps, source, cached?.etag ?? null);
    const fetchedAt = Date.now();

    // A 304 means the rows in hand are still current. Restamping them is the
    // point: without it every mount past the TTL would revalidate again.
    const rows = result.rows ?? cached?.rows ?? [];
    cache.write(source, { rows: [...rows], fetchedAt, etag: result.etag });
    return { rows, status: status(source, fetchedAt, result.rows === null, null) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cached !== null) {
      return { rows: cached.rows, status: status(source, cached.fetchedAt, true, message) };
    }
    console.error(`[model-pricing] ${SOURCE_LABELS[source]} failed with nothing cached:`, error);
    return { rows: [], status: status(source, 0, false, message) };
  }
}

function status(id: SourceId, fetchedAt: number, cached: boolean, error: string | null): SourceStatus {
  return { id, fetchedAt, cached, error };
}
