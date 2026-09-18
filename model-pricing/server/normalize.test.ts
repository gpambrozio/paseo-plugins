/**
 * Fixtures here are trimmed copies of what the two upstreams really answered on
 * 2026-09-18, fields and all. Nothing in this file fetches.
 */
import { describe, expect, it } from "vitest";

import { normalizeModelsDev, normalizeOpenRouter } from "./normalize";

function modelsDevDocument(): unknown {
  return {
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-opus-5": {
          id: "claude-opus-5",
          name: "Claude Opus 5",
          reasoning: true,
          tool_call: true,
          structured_output: true,
          temperature: false,
          release_date: "2026-07-24",
          limit: { context: 1_000_000, output: 128_000 },
          cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
        },
      },
    },
    "fireworks-ai": {
      id: "fireworks-ai",
      name: "Fireworks AI",
      models: {
        "accounts/fireworks/routers/kimi-latest": {
          id: "accounts/fireworks/routers/kimi-latest",
          name: "Kimi Latest",
          reasoning: true,
          tool_call: true,
          structured_output: true,
          temperature: false,
          limit: { context: 1_048_576, output: 131_072 },
          cost: { input: 3, output: 15, cache_read: 0.3 },
        },
      },
    },
    "ollama-cloud": {
      id: "ollama-cloud",
      name: "Ollama Cloud",
      models: {
        // Real shape: no `structured_output`, no `temperature`, no cache price.
        "gpt-oss:20b": {
          id: "gpt-oss:20b",
          name: "gpt-oss:20b",
          reasoning: true,
          tool_call: true,
          limit: { context: 131_072, output: 32_768 },
          cost: { input: 0.07, output: 0.3, cache_read: 0.035 },
        },
      },
    },
    // A provider this plugin does not show. Must not reach the table.
    google: {
      id: "google",
      name: "Google",
      models: { "gemini-3": { id: "gemini-3", name: "Gemini 3", cost: { input: 1, output: 2 } } },
    },
  };
}

describe("normalizeModelsDev", () => {
  it("reads the columns the table draws", () => {
    const rows = normalizeModelsDev(modelsDevDocument());
    const opus = rows.find((entry) => entry.modelId === "claude-opus-5");

    expect(opus).toEqual({
      providerId: "anthropic",
      modelId: "claude-opus-5",
      name: "Claude Opus 5",
      contextTokens: 1_000_000,
      outputTokens: 128_000,
      inputCost: 5,
      outputCost: 25,
      cacheReadCost: 0.5,
      reasoning: true,
      toolCall: true,
      structuredOutput: true,
      temperature: false,
      releaseDate: "2026-07-24",
    });
  });

  it("maps the catalog keys that are not the provider ids", () => {
    const rows = normalizeModelsDev(modelsDevDocument());
    expect(rows.find((entry) => entry.modelId.includes("kimi"))?.providerId).toBe("fireworks");
    expect(rows.find((entry) => entry.modelId === "gpt-oss:20b")?.providerId).toBe("ollama");
  });

  it("ignores the 200-odd providers this plugin does not show", () => {
    const rows = normalizeModelsDev(modelsDevDocument());
    expect(rows.some((entry) => entry.modelId === "gemini-3")).toBe(false);
  });

  it("leaves an unstated capability null rather than calling it false", () => {
    const rows = normalizeModelsDev(modelsDevDocument());
    const oss = rows.find((entry) => entry.modelId === "gpt-oss:20b");
    expect(oss?.structuredOutput).toBeNull();
    expect(oss?.temperature).toBeNull();
    expect(oss?.releaseDate).toBeNull();
    // What it *did* say is still read as stated.
    expect(oss?.reasoning).toBe(true);
  });

  it("drops a model with no price, because a priceless row cannot be ranked", () => {
    const document = modelsDevDocument() as Record<string, { models: Record<string, unknown> }>;
    const anthropic = document["anthropic"];
    if (anthropic === undefined) throw new Error("fixture changed");
    anthropic.models["preview"] = { id: "preview", name: "Unpriced preview", limit: { context: 200_000 } };

    const rows = normalizeModelsDev(document);
    expect(rows.some((entry) => entry.modelId === "preview")).toBe(false);
    expect(rows.some((entry) => entry.modelId === "claude-opus-5")).toBe(true);
  });

  it("skips one malformed model instead of losing the catalog", () => {
    const document = modelsDevDocument() as Record<string, { models: Record<string, unknown> }>;
    const anthropic = document["anthropic"];
    if (anthropic === undefined) throw new Error("fixture changed");
    anthropic.models["broken"] = "this is not a model";
    anthropic.models["negative"] = { id: "negative", cost: { input: -1, output: 5 } };

    const rows = normalizeModelsDev(document);
    expect(rows.map((entry) => entry.modelId)).toContain("claude-opus-5");
    expect(rows.map((entry) => entry.modelId)).not.toContain("negative");
  });

  it("throws only when the whole document is the wrong shape", () => {
    expect(() => normalizeModelsDev("<html>down for maintenance</html>")).toThrow(/JSON object/);
    // A provider that has gone missing is not an error; it is a provider with no rows.
    expect(normalizeModelsDev({})).toEqual([]);
  });
});

function openRouterDocument(): unknown {
  return {
    data: [
      {
        id: "anthropic/claude-fable-5.1",
        name: "Anthropic: Claude Fable 5.1",
        created: 1_766_000_000,
        context_length: 1_000_000,
        top_provider: { context_length: 1_000_000, max_completion_tokens: 128_000 },
        pricing: {
          prompt: "0.00001",
          completion: "0.00005",
          input_cache_read: "0.00000025",
          web_search: "0.01",
        },
        supported_parameters: ["max_tokens", "reasoning", "structured_outputs", "tools", "tool_choice"],
      },
      {
        // No `supported_parameters` at all: four unknowns, not four Nos.
        id: "mystery/model",
        name: "Mystery",
        context_length: 8_192,
        pricing: { prompt: "0.000001", completion: "0.000002" },
      },
      {
        // No usable price: dropped.
        id: "broken/model",
        name: "Broken",
        pricing: { prompt: "not a number", completion: "0.1" },
      },
    ],
  };
}

describe("normalizeOpenRouter", () => {
  it("converts per-token strings into dollars per 1M tokens", () => {
    const rows = normalizeOpenRouter(openRouterDocument());
    const fable = rows.find((entry) => entry.modelId === "anthropic/claude-fable-5.1");

    expect(fable?.inputCost).toBeCloseTo(10);
    expect(fable?.outputCost).toBeCloseTo(50);
    expect(fable?.cacheReadCost).toBeCloseTo(0.25);
    expect(fable?.providerId).toBe("openrouter");
  });

  it("reads the four capability columns out of supported_parameters", () => {
    const rows = normalizeOpenRouter(openRouterDocument());
    const fable = rows.find((entry) => entry.modelId === "anthropic/claude-fable-5.1");

    expect(fable?.reasoning).toBe(true);
    expect(fable?.toolCall).toBe(true);
    expect(fable?.structuredOutput).toBe(true);
    // Listed parameters are stated; `temperature` is absent from the list, so
    // this one really is a no rather than an unknown.
    expect(fable?.temperature).toBe(false);
  });

  it("takes an absent parameter list as unknown rather than as no support", () => {
    const rows = normalizeOpenRouter(openRouterDocument());
    const mystery = rows.find((entry) => entry.modelId === "mystery/model");

    expect(mystery?.reasoning).toBeNull();
    expect(mystery?.toolCall).toBeNull();
    expect(mystery?.structuredOutput).toBeNull();
    expect(mystery?.temperature).toBeNull();
  });

  it("takes the completion cap and the creation date off their own fields", () => {
    const rows = normalizeOpenRouter(openRouterDocument());
    const fable = rows.find((entry) => entry.modelId === "anthropic/claude-fable-5.1");

    expect(fable?.contextTokens).toBe(1_000_000);
    expect(fable?.outputTokens).toBe(128_000);
    expect(fable?.releaseDate).toBe("2025-12-17");
    expect(rows.find((entry) => entry.modelId === "mystery/model")?.outputTokens).toBeNull();
  });

  it("drops an unpriceable row and keeps the rest", () => {
    const rows = normalizeOpenRouter(openRouterDocument());
    expect(rows.map((entry) => entry.modelId)).toEqual(["anthropic/claude-fable-5.1", "mystery/model"]);
  });

  it("throws when there is no data array to read", () => {
    expect(() => normalizeOpenRouter({ error: "rate limited" })).toThrow(/data/);
  });
});
