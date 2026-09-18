/**
 * The two HTTP fetches, and nothing else. Parsing lives in `normalize.ts` and
 * storage in `cache.ts`, so this module is only ever about the request.
 *
 * `fetch` arrives in a deps bag rather than being read off the global, which is
 * how the tests drive both sources without a network — the same seam herald
 * uses for its hooks.
 */
import { normalizeModelsDev, normalizeOpenRouter } from "./normalize";
import type { PriceRow } from "../shared/pricing";
import type { SourceId } from "../shared/providers";

export interface FetchDeps {
  fetch: typeof globalThis.fetch;
}

export const DEFAULT_DEPS: FetchDeps = {
  fetch: (...args) => globalThis.fetch(...args),
};

export interface SourceResult {
  /** Absent when the upstream answered 304: the caller keeps what it had. */
  rows: PriceRow[] | null;
  etag: string | null;
}

const MODELS_DEV_URL = "https://models.dev/api.json";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

/** Neither upstream is slow; a minute means something is wrong, not busy. */
const TIMEOUT_MS = 60_000;

export const SOURCE_LABELS: Record<SourceId, string> = {
  "models-dev": "models.dev",
  openrouter: "OpenRouter",
};

/**
 * models.dev, which serves the Anthropic, OpenAI, Fireworks and Ollama Cloud
 * prices. Its only JSON endpoint is the whole 4.7 MB catalog — the per-provider
 * paths some of its docs mention redirect to the homepage — but it honours
 * `If-None-Match`, so a refresh that changes nothing costs one round trip and
 * no parse at all.
 */
export async function fetchModelsDev(deps: FetchDeps, etag: string | null): Promise<SourceResult> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (etag !== null) headers["if-none-match"] = etag;

  const answer = await request(deps, MODELS_DEV_URL, headers, SOURCE_LABELS["models-dev"]);
  // Keep the ETag we sent if the 304 did not repeat it; losing it would turn
  // every later refresh back into a full 4.7 MB download.
  if (answer.status === 304) return { rows: null, etag: answer.etag ?? etag };

  return { rows: normalizeModelsDev(answer.json), etag: answer.etag };
}

/**
 * OpenRouter's own catalog. No ETag, but it is 75 KB gzipped and CDN-cached for
 * two minutes, so an unconditional fetch is the whole story.
 */
export async function fetchOpenRouter(deps: FetchDeps): Promise<SourceResult> {
  const answer = await request(deps, OPENROUTER_URL, { accept: "application/json" }, SOURCE_LABELS.openrouter);
  return { rows: normalizeOpenRouter(answer.json), etag: answer.etag };
}

export function fetchSource(deps: FetchDeps, source: SourceId, etag: string | null): Promise<SourceResult> {
  return source === "models-dev" ? fetchModelsDev(deps, etag) : fetchOpenRouter(deps);
}

interface Answer {
  status: number;
  etag: string | null;
  /** Null on a 304, where there is no body to read. */
  json: unknown;
}

/**
 * One request, with the body read inside the same deadline as the headers —
 * `AbortSignal.timeout` would be shorter, but it is not in this tsconfig's
 * `lib` and a 4.7 MB body is worth covering anyway.
 *
 * Every non-2xx becomes a sentence naming the upstream, because that string is
 * what the surface puts in front of the user: "models.dev answered 503" tells
 * them which half of the table to distrust, and that it is not their fault.
 */
async function request(deps: FetchDeps, url: string, headers: Record<string, string>, label: string): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await deps.fetch(url, { headers, redirect: "follow", signal: controller.signal });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach ${label}: ${reason}`);
    }

    const etag = response.headers.get("etag");
    if (response.status === 304) return { status: 304, etag, json: null };
    if (!response.ok) throw new Error(`${label} answered ${response.status} ${response.statusText}`.trimEnd());

    try {
      return { status: response.status, etag, json: await response.json() };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} answered with something that is not JSON: ${reason}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
