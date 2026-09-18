/**
 * The handler's job is arbitration, not parsing: which sources to fetch, when
 * a cache answers instead, and what the table shows when one upstream is down.
 * Every test here drives it through a fake `fetch` in the deps bag.
 */
import { describe, expect, it, vi } from "vitest";

import { PricingCache, TTL_MS } from "./cache";
import { createPricingHandler } from "./pricing";
import type { FetchDeps } from "./sources";

const MODELS_DEV = "https://models.dev/api.json";
const OPENROUTER = "https://openrouter.ai/api/v1/models";

const MODELS_DEV_BODY = {
  anthropic: {
    models: {
      "claude-opus-5": {
        id: "claude-opus-5",
        name: "Claude Opus 5",
        tool_call: true,
        limit: { context: 1_000_000, output: 128_000 },
        cost: { input: 5, output: 25 },
      },
    },
  },
  "fireworks-ai": {
    models: {
      "kimi-k3": { id: "kimi-k3", name: "Kimi K3", tool_call: true, cost: { input: 3, output: 15 } },
    },
  },
};

const OPENROUTER_BODY = {
  data: [
    {
      id: "z-ai/glm-5.3",
      name: "Z.AI: GLM 5.3",
      context_length: 1_048_576,
      pricing: { prompt: "0.0000014", completion: "0.0000044" },
      supported_parameters: ["tools", "reasoning"],
    },
  ],
};

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

interface Recorder extends FetchDeps {
  calls: { url: string; headers: Record<string, string> }[];
}

/** A fetch that answers per host, recording what it was asked and with what. */
function recordingFetch(answer: (url: string) => Response | Promise<Response>): Recorder {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const deps: Recorder = {
    calls,
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return answer(url);
    },
  };
  return deps;
}

function bothSourcesOk(): Recorder {
  return recordingFetch((url) => (url === MODELS_DEV ? json(MODELS_DEV_BODY, { etag: '"v1"' }) : json(OPENROUTER_BODY)));
}

describe("createPricingHandler", () => {
  it("fetches only the upstreams the requested providers need", async () => {
    const deps = bothSourcesOk();
    const load = createPricingHandler(new PricingCache(null), deps);

    await load({ providers: ["openrouter"], refresh: false });

    expect(deps.calls.map((call) => call.url)).toEqual([OPENROUTER]);
  });

  it("shares one models.dev fetch across the four providers that live in it", async () => {
    const deps = bothSourcesOk();
    const load = createPricingHandler(new PricingCache(null), deps);

    const result = await load({ providers: ["anthropic", "fireworks"], refresh: false });

    expect(deps.calls.filter((call) => call.url === MODELS_DEV)).toHaveLength(1);
    expect(result.rows.map((row) => row.providerId).sort()).toEqual(["anthropic", "fireworks"]);
  });

  it("returns only the providers asked for, even though the fetch carried more", async () => {
    const deps = bothSourcesOk();
    const load = createPricingHandler(new PricingCache(null), deps);

    const result = await load({ providers: ["anthropic"], refresh: false });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.providerId).toBe("anthropic");
  });

  it("asks for nothing when no provider is enabled", async () => {
    const deps = bothSourcesOk();
    const load = createPricingHandler(new PricingCache(null), deps);

    const result = await load({ providers: [], refresh: false });

    expect(deps.calls).toEqual([]);
    expect(result).toEqual({ rows: [], sources: [] });
  });

  it("serves a second call from the cache rather than fetching again", async () => {
    const deps = bothSourcesOk();
    const load = createPricingHandler(new PricingCache(null), deps);

    await load({ providers: ["anthropic"], refresh: false });
    const second = await load({ providers: ["anthropic"], refresh: false });

    expect(deps.calls).toHaveLength(1);
    expect(second.sources[0]?.cached).toBe(true);
    expect(second.rows).toHaveLength(1);
  });

  it("refetches a cache older than the TTL", async () => {
    const deps = bothSourcesOk();
    const cache = new PricingCache(null);
    cache.write("models-dev", { rows: [], fetchedAt: Date.now() - TTL_MS - 1, etag: null });
    const load = createPricingHandler(cache, deps);

    await load({ providers: ["anthropic"], refresh: false });

    expect(deps.calls).toHaveLength(1);
  });

  it("bypasses a fresh cache when the user presses Refresh", async () => {
    const deps = bothSourcesOk();
    const load = createPricingHandler(new PricingCache(null), deps);

    await load({ providers: ["anthropic"], refresh: false });
    const refreshed = await load({ providers: ["anthropic"], refresh: true });

    expect(deps.calls).toHaveLength(2);
    expect(refreshed.sources[0]?.cached).toBe(false);
  });

  it("revalidates with the stored ETag and keeps the rows on a 304", async () => {
    const deps = recordingFetch((url) => {
      if (url !== MODELS_DEV) return json(OPENROUTER_BODY);
      // The first call is the full body; every later one is unchanged.
      return deps.calls.length === 1 ? json(MODELS_DEV_BODY, { etag: '"v1"' }) : new Response(null, { status: 304 });
    });
    const load = createPricingHandler(new PricingCache(null), deps);

    await load({ providers: ["anthropic"], refresh: false });
    const revalidated = await load({ providers: ["anthropic"], refresh: true });

    expect(deps.calls[1]?.headers["if-none-match"]).toBe('"v1"');
    expect(revalidated.rows).toHaveLength(1);
    expect(revalidated.sources[0]?.cached).toBe(true);
    // Restamped, so the next mount does not revalidate all over again.
    expect(revalidated.sources[0]?.fetchedAt).toBeGreaterThan(0);
    expect(revalidated.sources[0]?.error).toBeNull();
  });

  /**
   * The trap in finding #5: a degraded-but-valid 200 (the catalog served
   * without its provider keys) normalizes to no rows. Storing its ETag would
   * mean every later call — Refresh included — is answered 304 and keeps the
   * empty table, with no way out from the UI.
   */
  it("never stores an ETag beside an empty row set, so an empty cache is recoverable", async () => {
    let body: unknown = { anthropic: { models: {} } };
    const deps = recordingFetch((url) => (url === MODELS_DEV ? json(body, { etag: '"empty"' }) : json(OPENROUTER_BODY)));
    const load = createPricingHandler(new PricingCache(null), deps);

    const empty = await load({ providers: ["anthropic"], refresh: false });
    expect(empty.rows).toEqual([]);

    // The upstream recovers. The second call must ask unconditionally.
    body = MODELS_DEV_BODY;
    const recovered = await load({ providers: ["anthropic"], refresh: true });

    expect(deps.calls[1]?.headers["if-none-match"]).toBeUndefined();
    expect(recovered.rows).toHaveLength(1);
  });

  it("keeps one upstream's rows when the other is down", async () => {
    const deps = recordingFetch((url) => {
      if (url === MODELS_DEV) return json(MODELS_DEV_BODY);
      return new Response("nope", { status: 503, statusText: "Service Unavailable" });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const load = createPricingHandler(new PricingCache(null), deps);

    const result = await load({ providers: ["anthropic", "openrouter"], refresh: false });

    expect(result.rows.map((row) => row.providerId)).toEqual(["anthropic"]);
    const failed = result.sources.find((source) => source.id === "openrouter");
    expect(failed?.error).toContain("OpenRouter answered 503");
    expect(result.sources.find((source) => source.id === "models-dev")?.error).toBeNull();
    vi.restoreAllMocks();
  });

  it("falls back to a stale cache when a refresh fails, and says so", async () => {
    let fail = false;
    const deps = recordingFetch((url) => {
      if (fail) throw new TypeError("network unreachable");
      return url === MODELS_DEV ? json(MODELS_DEV_BODY) : json(OPENROUTER_BODY);
    });
    const load = createPricingHandler(new PricingCache(null), deps);

    const first = await load({ providers: ["anthropic"], refresh: false });
    fail = true;
    const second = await load({ providers: ["anthropic"], refresh: true });

    expect(second.rows).toEqual(first.rows);
    expect(second.sources[0]?.error).toContain("Could not reach models.dev");
    expect(second.sources[0]?.cached).toBe(true);
    // The timestamp is the *cache's*, so the surface can say how old it is.
    expect(second.sources[0]?.fetchedAt).toBe(first.sources[0]?.fetchedAt);
  });

  it("reports an empty table when a source fails with nothing cached", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = recordingFetch(() => {
      throw new TypeError("network unreachable");
    });
    const load = createPricingHandler(new PricingCache(null), deps);

    const result = await load({ providers: ["openrouter"], refresh: false });

    expect(result.rows).toEqual([]);
    expect(result.sources[0]?.error).toContain("Could not reach OpenRouter");
    expect(result.sources[0]?.fetchedAt).toBe(0);
    expect(errors).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("does not download the catalog twice for two calls in flight at once", async () => {
    // A box rather than a bare `let`, so the assignment inside the executor is
    // visible to the type checker at the call below.
    const gate: { open: () => void } = { open: () => {} };
    const held = new Promise<void>((resolve) => {
      gate.open = resolve;
    });
    const deps = recordingFetch(async () => {
      await held;
      return json(MODELS_DEV_BODY);
    });
    const load = createPricingHandler(new PricingCache(null), deps);

    const both = Promise.all([
      load({ providers: ["anthropic"], refresh: false }),
      load({ providers: ["anthropic"], refresh: false }),
    ]);
    gate.open();
    const [first, second] = await both;

    expect(deps.calls).toHaveLength(1);
    expect(first.rows).toEqual(second.rows);
  });

  it("still refetches for a Refresh that arrives while a load is in flight", async () => {
    const deps = bothSourcesOk();
    const load = createPricingHandler(new PricingCache(null), deps);

    await Promise.all([
      load({ providers: ["anthropic"], refresh: false }),
      load({ providers: ["anthropic"], refresh: true }),
    ]);

    expect(deps.calls.length).toBeGreaterThan(1);
  });
});
