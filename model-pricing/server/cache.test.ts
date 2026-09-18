import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isFresh, PricingCache, TTL_MS, type CacheEntry } from "./cache";
import type { PriceRow } from "../shared/pricing";

function row(overrides: Partial<PriceRow> = {}): PriceRow {
  return {
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
    ...overrides,
  };
}

function entry(overrides: Partial<CacheEntry> = {}): CacheEntry {
  return { rows: [row()], fetchedAt: Date.now(), etag: '"abc123"', ...overrides };
}

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "model-pricing-cache-"));
  tempDirs.push(dir);
  return dir;
}

describe("PricingCache without a directory", () => {
  it("keeps entries in memory and never touches the disk", async () => {
    const cache = new PricingCache(null);
    expect(await cache.read("models-dev")).toBeNull();

    cache.write("models-dev", entry());
    expect((await cache.read("models-dev"))?.rows).toHaveLength(1);
    await cache.flush();
  });
});

describe("PricingCache on disk", () => {
  it("writes one file per source and reads it back in a fresh cache", async () => {
    const dir = await scratch();
    const writer = new PricingCache(dir);
    writer.write("models-dev", entry({ fetchedAt: 1_700_000_000_000 }));
    writer.write("openrouter", entry({ rows: [row({ providerId: "openrouter" })], etag: null }));
    await writer.flush();

    expect(JSON.parse(await readFile(join(dir, "models-dev.json"), "utf8")).etag).toBe('"abc123"');

    const reader = new PricingCache(dir);
    const modelsDev = await reader.read("models-dev");
    expect(modelsDev?.fetchedAt).toBe(1_700_000_000_000);
    expect(modelsDev?.rows[0]?.name).toBe("Claude Opus 5");
    expect((await reader.read("openrouter"))?.etag).toBeNull();
  });

  it("serialises writes to the same source so a file is never half-written", async () => {
    const dir = await scratch();
    const cache = new PricingCache(dir);
    cache.write("models-dev", entry({ rows: [row({ modelId: "first" })] }));
    cache.write("models-dev", entry({ rows: [row({ modelId: "second" })] }));
    cache.write("models-dev", entry({ rows: [row({ modelId: "third" })] }));
    await cache.flush();

    const stored = JSON.parse(await readFile(join(dir, "models-dev.json"), "utf8")) as CacheEntry;
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.modelId).toBe("third");
  });

  it("treats a missing file as a miss, quietly", async () => {
    const dir = await scratch();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await new PricingCache(dir).read("openrouter")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("treats a corrupt file as a miss so a refetch can fix it", async () => {
    const dir = await scratch();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await writeFile(join(dir, "openrouter.json"), "{ this is not json", "utf8");

    expect(await new PricingCache(dir).read("openrouter")).toBeNull();
  });

  it("rejects a file whose rows no longer match the row shape", async () => {
    const dir = await scratch();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A cache written by an older build, before `inputCost` was required.
    await writeFile(
      join(dir, "models-dev.json"),
      JSON.stringify({ fetchedAt: Date.now(), etag: null, rows: [{ modelId: "old", name: "Old" }] }),
      "utf8",
    );

    expect(await new PricingCache(dir).read("models-dev")).toBeNull();
  });

  it("only looks for a missing file once", async () => {
    const dir = await scratch();
    const cache = new PricingCache(dir);
    await cache.read("models-dev");
    // A hit written after the miss is served from memory, not re-read.
    cache.write("models-dev", entry({ rows: [row({ modelId: "fresh" })] }));
    expect((await cache.read("models-dev"))?.rows[0]?.modelId).toBe("fresh");
  });

  it("reports a failed write without throwing, because the rows in hand are still good", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // A path under a file, so mkdir fails.
    const dir = await scratch();
    await writeFile(join(dir, "wall"), "", "utf8");

    const cache = new PricingCache(join(dir, "wall", "nested"));
    cache.write("models-dev", entry());
    await expect(cache.flush()).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    // Memory still has it, which is the point.
    expect(await cache.read("models-dev")).not.toBeNull();
  });
});

describe("isFresh", () => {
  it("is the twelve-hour window a mount reuses", () => {
    const now = 1_700_000_000_000;
    expect(isFresh(entry({ fetchedAt: now - 1_000 }), now)).toBe(true);
    expect(isFresh(entry({ fetchedAt: now - TTL_MS + 1_000 }), now)).toBe(true);
    expect(isFresh(entry({ fetchedAt: now - TTL_MS - 1_000 }), now)).toBe(false);
  });
});
