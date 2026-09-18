import { describe, expect, it } from "vitest";

import { isDarkBackground, pickAccent, PROVIDERS, providersOfSource, sourcesFor } from "./providers";

describe("provider accents", () => {
  /**
   * The regression test for the whole reason this is a palette. The first cut
   * took colours from `theme.colors`, and in Paseo's default dark theme
   * `accent` is green — so OpenAI on `statusSuccess` and Ollama Cloud on
   * `accent` came out the same colour and could not be told apart.
   */
  it("gives every provider a colour no other provider has", () => {
    const dark = PROVIDERS.map((provider) => provider.accent.dark);
    const light = PROVIDERS.map((provider) => provider.accent.light);

    expect(new Set(dark).size).toBe(PROVIDERS.length);
    expect(new Set(light).size).toBe(PROVIDERS.length);
  });

  it("states both variants as six-digit hex, which is what pickAccent can read", () => {
    for (const provider of PROVIDERS) {
      expect(provider.accent.dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(provider.accent.light).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps the light variant darker than the dark one", () => {
    // Each pair is the same hue at two lightnesses: the `dark` value has to
    // read on a dark background and the `light` value on a light one, so
    // getting them the wrong way round is invisible until someone switches
    // theme.
    for (const provider of PROVIDERS) {
      expect(isDarkBackground(provider.accent.light)).toBe(true);
      expect(isDarkBackground(provider.accent.dark)).toBe(false);
    }
  });
});

describe("isDarkBackground", () => {
  it("reads Paseo's dark surfaces as dark and white as light", () => {
    expect(isDarkBackground("#000000")).toBe(true);
    expect(isDarkBackground("#1a1a1a")).toBe(true);
    expect(isDarkBackground("#1e1e2e")).toBe(true);
    expect(isDarkBackground("#ffffff")).toBe(false);
    expect(isDarkBackground("#f5f5f5")).toBe(false);
  });

  it("weights green the way the eye does", () => {
    // The same channel at full strength: green reads as a light background,
    // blue as a dark one. A plain average of the channels would call both the
    // same, and would put a green-tinted theme on the wrong half of the palette.
    expect(isDarkBackground("#00ff00")).toBe(false);
    expect(isDarkBackground("#0000ff")).toBe(true);
  });

  it("falls back to dark for anything it cannot parse", () => {
    // Paseo's default is dark, and a theme that hands out `rgb()` or a named
    // colour should get the more common half rather than an exception.
    expect(isDarkBackground("rgb(20, 20, 20)")).toBe(true);
    expect(isDarkBackground("")).toBe(true);
    expect(isDarkBackground("#fff")).toBe(true);
  });
});

describe("pickAccent", () => {
  const accent = { dark: "#f0916a", light: "#c2410c" };

  it("takes the variant built for the background in play", () => {
    expect(pickAccent(accent, "#1a1a1a")).toBe("#f0916a");
    expect(pickAccent(accent, "#ffffff")).toBe("#c2410c");
  });
});

describe("sourcesFor", () => {
  it("asks for one upstream per provider set, not one per provider", () => {
    expect(sourcesFor(["anthropic", "openai", "fireworks", "ollama"])).toEqual(["models-dev"]);
    expect(sourcesFor(["openrouter"])).toEqual(["openrouter"]);
    expect(sourcesFor(["anthropic", "openrouter"])).toEqual(["models-dev", "openrouter"]);
  });

  it("ignores an id no build knows about, rather than inventing a source", () => {
    expect(sourcesFor(["mystery"])).toEqual([]);
    expect(sourcesFor([])).toEqual([]);
  });
});

describe("providersOfSource", () => {
  it("knows which providers a single models.dev fetch answers for", () => {
    expect(providersOfSource("models-dev").map((provider) => provider.id)).toEqual([
      "anthropic",
      "openai",
      "fireworks",
      "ollama",
    ]);
    expect(providersOfSource("openrouter").map((provider) => provider.id)).toEqual(["openrouter"]);
  });

  it("names the catalog keys that differ from the provider ids", () => {
    const keys = providersOfSource("models-dev").map((provider) => provider.catalogKey);
    expect(keys).toEqual(["anthropic", "openai", "fireworks-ai", "ollama-cloud"]);
  });
});
