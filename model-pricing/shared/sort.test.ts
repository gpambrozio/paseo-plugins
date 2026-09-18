import { describe, expect, it } from "vitest";

import type { PriceRow } from "./pricing";
import { compareRows, type Sort, type TableRow } from "./sort";

function entry(overrides: Partial<PriceRow> = {}, relative = 1): TableRow {
  return {
    row: {
      providerId: "anthropic",
      modelId: "m",
      name: "Model",
      contextTokens: 1_000_000,
      outputTokens: 128_000,
      inputCost: 5,
      outputCost: 25,
      reasoning: true,
      toolCall: true,
      structuredOutput: true,
      temperature: false,
      releaseDate: null,
      ...overrides,
    },
    relative,
  };
}

/** The table's own pipeline: sort a set and read back the identifying field. */
function order(rows: TableRow[], sort: Sort, field: (entry: TableRow) => string): string[] {
  return [...rows].sort((a, b) => compareRows(a, b, sort)).map(field);
}

const byId = (item: TableRow): string => item.row.modelId;

describe("compareRows", () => {
  it("orders by name in both directions", () => {
    const rows = [entry({ modelId: "b", name: "Beta" }), entry({ modelId: "a", name: "Alpha" })];
    expect(order(rows, { key: "name", descending: false }, byId)).toEqual(["a", "b"]);
    expect(order(rows, { key: "name", descending: true }, byId)).toEqual(["b", "a"]);
  });

  it("orders by each numeric column", () => {
    const rows = [
      entry({ modelId: "small", contextTokens: 8_000, outputTokens: 1_000, inputCost: 1 }, 1),
      entry({ modelId: "large", contextTokens: 1_000_000, outputTokens: 100_000, inputCost: 50 }, 50),
    ];
    expect(order(rows, { key: "context", descending: true }, byId)).toEqual(["large", "small"]);
    expect(order(rows, { key: "output", descending: false }, byId)).toEqual(["small", "large"]);
    expect(order(rows, { key: "price", descending: true }, byId)).toEqual(["large", "small"]);
    expect(order(rows, { key: "relative", descending: false }, byId)).toEqual(["small", "large"]);
  });

  /**
   * The contract most likely to be got wrong: a model that publishes no context
   * window is not the model with the smallest one, so it belongs at the bottom
   * whichever way the arrow points. Doing the null test inside the direction
   * multiply would float every em dash to the top on one of the two presses.
   */
  it("sorts unknowns last in BOTH directions", () => {
    const rows = [
      entry({ modelId: "unknown", contextTokens: null }),
      entry({ modelId: "small", contextTokens: 8_000 }),
      entry({ modelId: "large", contextTokens: 1_000_000 }),
    ];
    expect(order(rows, { key: "context", descending: true }, byId)).toEqual(["large", "small", "unknown"]);
    expect(order(rows, { key: "context", descending: false }, byId)).toEqual(["small", "large", "unknown"]);
  });

  it("treats two unknowns as equal rather than ordering them arbitrarily", () => {
    const rows = [entry({ modelId: "a", outputTokens: null }), entry({ modelId: "b", outputTokens: null })];
    expect(order(rows, { key: "output", descending: true }, byId)).toEqual(["a", "b"]);
    expect(order(rows, { key: "output", descending: false }, byId)).toEqual(["a", "b"]);
  });

  it("orders by the provider's label, not its id", () => {
    // `fireworks` sorts after `openai` by id and before it by label
    // ("Fireworks AI" < "OpenAI"), so this fails if the id leaks through.
    const rows = [entry({ modelId: "o", providerId: "openai" }), entry({ modelId: "f", providerId: "fireworks" })];
    expect(order(rows, { key: "provider", descending: false }, byId)).toEqual(["f", "o"]);
  });

  it("breaks a provider tie by name, so pressing twice does not shuffle the group", () => {
    const rows = [
      entry({ modelId: "z", providerId: "anthropic", name: "Zeta" }),
      entry({ modelId: "a", providerId: "anthropic", name: "Alpha" }),
    ];
    expect(order(rows, { key: "provider", descending: false }, byId)).toEqual(["a", "z"]);
  });

  it("ranks a free model below every paid one, not above", () => {
    // Free rows carry a relative of 0 (they print "Free"), so an ascending
    // sort must not present them as the cheapest thing worth buying.
    const rows = [entry({ modelId: "free" }, 0), entry({ modelId: "cheap" }, 1), entry({ modelId: "dear" }, 50)];
    expect(order(rows, { key: "relative", descending: true }, byId)).toEqual(["dear", "cheap", "free"]);
  });
});
