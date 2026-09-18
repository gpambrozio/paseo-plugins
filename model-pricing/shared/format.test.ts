import { describe, expect, it } from "vitest";

import {
  blendedCost,
  formatFlag,
  formatPrice,
  formatPricePair,
  formatRelative,
  formatTokens,
  relativeCosts,
  relativeTime,
  UNKNOWN,
} from "./format";
import type { PriceRow } from "./pricing";

function row(overrides: Partial<PriceRow> = {}): PriceRow {
  return {
    providerId: "anthropic",
    modelId: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    contextTokens: 1_000_000,
    outputTokens: 128_000,
    inputCost: 2,
    outputCost: 10,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    temperature: null,
    releaseDate: null,
    ...overrides,
  };
}

describe("formatTokens", () => {
  it("writes millions and thousands the way the table's other rows do", () => {
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_048_576)).toBe("1.05M");
    expect(formatTokens(262_144)).toBe("262K");
    expect(formatTokens(131_072)).toBe("131K");
    expect(formatTokens(196_608)).toBe("197K");
  });

  it("does not write a thousand thousands as 1000K", () => {
    expect(formatTokens(999_999)).toBe("1M");
    expect(formatTokens(999_499)).toBe("999K");
  });

  it("keeps a power of two distinct from the round number near it", () => {
    // Rounding 1048576 to "1M" would print one string for two windows.
    expect(formatTokens(1_048_576)).not.toBe(formatTokens(1_000_000));
  });

  it("is an em dash for anything missing or nonsensical", () => {
    expect(formatTokens(null)).toBe(UNKNOWN);
    expect(formatTokens(0)).toBe(UNKNOWN);
    expect(formatTokens(Number.NaN)).toBe(UNKNOWN);
  });
});

describe("formatPrice", () => {
  it("prints whole dollars bare and fractions to two places", () => {
    expect(formatPrice(10)).toBe("$10");
    expect(formatPrice(1.4)).toBe("$1.40");
    expect(formatPrice(0.22)).toBe("$0.22");
    expect(formatPrice(0.2)).toBe("$0.20");
    expect(formatPrice(3.96)).toBe("$3.96");
  });

  it("keeps the decimals a cheap model actually needs", () => {
    // Nemotron Super is $0.015; two places would read as $0.02, a 33% lie.
    expect(formatPrice(0.015)).toBe("$0.015");
    expect(formatPrice(1.475)).toBe("$1.475");
    expect(formatPrice(0.005)).toBe("$0.005");
  });

  it("pairs input and output for the price column", () => {
    expect(formatPricePair(10, 50)).toBe("$10 / $50");
    expect(formatPricePair(1.4, 4.4)).toBe("$1.40 / $4.40");
  });
});

describe("formatFlag", () => {
  it("treats an unstated capability as unknown, not as a no", () => {
    expect(formatFlag(true)).toBe("Yes");
    expect(formatFlag(null)).toBe(UNKNOWN);
    expect(formatFlag(false)).toBe(UNKNOWN);
  });
});

describe("blendedCost", () => {
  it("weights input and output by the chosen share", () => {
    const model = row({ inputCost: 10, outputCost: 50 });
    expect(blendedCost(model, 0.8)).toBeCloseTo(18);
    expect(blendedCost(model, 0.5)).toBeCloseTo(30);
    expect(blendedCost(model, 1)).toBeCloseTo(10);
    expect(blendedCost(model, 0)).toBeCloseTo(50);
  });
});

describe("relativeCosts", () => {
  const cheap = row({ providerId: "ollama", modelId: "flash", inputCost: 0.22, outputCost: 0.66 });
  const dear = row({ providerId: "anthropic", modelId: "fable", inputCost: 10, outputCost: 50 });

  it("makes the cheapest row exactly 1.0x", () => {
    const relative = relativeCosts([cheap, dear], 0.8);
    expect(relative.get("ollama/flash")).toBeCloseTo(1);
  });

  it("reorders when the weighting changes, which is why it is a setting", () => {
    const inputHeavy = relativeCosts([cheap, dear], 0.8).get("anthropic/fable") ?? 0;
    const outputHeavy = relativeCosts([cheap, dear], 0.2).get("anthropic/fable") ?? 0;
    expect(inputHeavy).toBeCloseTo(18 / 0.308);
    expect(outputHeavy).toBeCloseTo(42 / 0.572);
    expect(inputHeavy).not.toBeCloseTo(outputHeavy);
  });

  it("keys by provider and model, so the same model through two providers is two rows", () => {
    const viaOpenRouter = row({ providerId: "openrouter", modelId: "claude-sonnet-5", inputCost: 3, outputCost: 15 });
    const relative = relativeCosts([row(), viaOpenRouter], 0.8);
    expect(relative.size).toBe(2);
    expect(relative.get("anthropic/claude-sonnet-5")).toBeCloseTo(1);
    expect(relative.get("openrouter/claude-sonnet-5")).toBeCloseTo(1.5);
  });

  it("does not divide by a free model, and never answers NaN", () => {
    const free = row({ providerId: "ollama", modelId: "free", inputCost: 0, outputCost: 0 });
    const relative = relativeCosts([free, dear], 0.8);
    expect(relative.get("ollama/free")).toBe(0);
    expect(Number.isFinite(relative.get("anthropic/fable") ?? Number.NaN)).toBe(true);
  });

  it("still calls a free row free when there is no paid row to rank against", () => {
    // Reachable in one keystroke: typing "free" in the search box narrows the
    // table to OpenRouter's free models and nothing else. Mapping the lot to 1
    // put "1.0×" on every row under a header promising "cheapest = 1.0×".
    const free = row({ providerId: "ollama", modelId: "free", inputCost: 0, outputCost: 0 });
    const other = row({ providerId: "openrouter", modelId: "also-free", inputCost: 0, outputCost: 0 });
    const relative = relativeCosts([free, other], 0.8);

    expect(relative.get("ollama/free")).toBe(0);
    expect(relative.get("openrouter/also-free")).toBe(0);
    expect(formatRelative(relative.get("ollama/free") ?? -1)).toBe("Free");
  });

  it("is empty for no rows rather than throwing", () => {
    expect(relativeCosts([], 0.8).size).toBe(0);
  });
});

describe("formatRelative", () => {
  it("always shows one decimal so the column stays a column", () => {
    expect(formatRelative(1)).toBe("1.0×");
    expect(formatRelative(58.7)).toBe("58.7×");
    expect(formatRelative(9.09)).toBe("9.1×");
  });

  it("calls a free model free rather than putting 0.0x under a 1.0x baseline", () => {
    expect(formatRelative(0)).toBe("Free");
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 8, 18, 12, 0, 0);

  it("reads as a person would say it", () => {
    expect(relativeTime(now - 5_000, now)).toBe("just now");
    expect(relativeTime(now - 3 * 60_000, now)).toBe("3 minutes ago");
    expect(relativeTime(now - 60 * 60_000, now)).toBe("1 hour ago");
    expect(relativeTime(now - 26 * 60 * 60_000, now)).toBe("1 day ago");
  });

  it("does not go backwards when clocks disagree", () => {
    expect(relativeTime(now + 10_000, now)).toBe("just now");
  });
});
