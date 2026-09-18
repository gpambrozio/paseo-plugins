/**
 * One file per upstream under `$PASEO_HOME/plugins/model-pricing/`, holding
 * that source's rows, when they were fetched, and its ETag.
 *
 * This is the daemon's own store rather than a settings document because the
 * handler has to *read* it — the rule in the root CLAUDE.md. What it is not is
 * a second copy of the user's preferences: which providers to fetch arrives in
 * the RPC, so nothing here needs to know what the user picked.
 *
 * **It caches normalized rows, never the raw document.** models.dev answers
 * with 4.7 MB; the rows this plugin keeps out of it are a few tens of KB. That
 * one decision is what keeps both this file and the RPC payload small.
 *
 * `dir === null` keeps everything in memory and is the seam the tests use, the
 * same shape as herald's `AttentionStore`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { PriceRowSchema, type PriceRow } from "../shared/pricing";
import type { SourceId } from "../shared/providers";

export const PLUGIN_ID = "model-pricing";

export function paseoHome(): string {
  return process.env["PASEO_HOME"] ?? join(homedir(), ".paseo");
}

export function pluginDir(): string {
  return join(paseoHome(), "plugins", PLUGIN_ID);
}

export interface CacheEntry {
  rows: PriceRow[];
  /** Epoch ms of the fetch these rows came from. */
  fetchedAt: number;
  /** The upstream's ETag, so the next fetch can ask for a 304. */
  etag: string | null;
}

export class PricingCache {
  private readonly entries = new Map<SourceId, CacheEntry>();
  /** Sources already looked for on disk, hit or miss, so a miss is read once. */
  private readonly loaded = new Set<SourceId>();
  /**
   * Writes are chained rather than fired in parallel: two sources finishing
   * together write different files, but the same source refreshed twice in a
   * row must not interleave halves of one.
   */
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly dir: string | null) {}

  private path(source: SourceId): string | null {
    return this.dir === null ? null : join(this.dir, `${source}.json`);
  }

  /**
   * A missing, unreadable or invalid file is a cache miss, reported and
   * otherwise ignored. Throwing here would turn a corrupt cache into a plugin
   * that can never load prices again, when refetching would have fixed it.
   */
  async read(source: SourceId): Promise<CacheEntry | null> {
    const cached = this.entries.get(source);
    if (cached !== undefined) return cached;

    const path = this.path(source);
    if (path === null || this.loaded.has(source)) return null;
    this.loaded.add(source);

    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`[${PLUGIN_ID}] could not read ${path}:`, error);
      }
      return null;
    }

    const entry = parseEntry(raw, path);
    if (entry === null) return null;
    this.entries.set(source, entry);
    return entry;
  }

  /**
   * Memory is updated synchronously and disk follows. A failed write is logged,
   * never thrown: the rows in hand are still good, and the next refresh retries.
   */
  write(source: SourceId, entry: CacheEntry): void {
    this.entries.set(source, entry);
    this.loaded.add(source);

    const path = this.path(source);
    if (path === null) return;
    this.writes = this.writes.then(async () => {
      try {
        await mkdir(this.dir as string, { recursive: true });
        await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
      } catch (error) {
        console.error(`[${PLUGIN_ID}] could not write ${path}:`, error);
      }
    });
  }

  /** Awaited from the plugin's cleanup, so a reload does not truncate a file. */
  flush(): Promise<void> {
    return this.writes;
  }
}

function parseEntry(raw: string, path: string): CacheEntry | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    console.error(`[${PLUGIN_ID}] ${path} is not JSON, refetching:`, error);
    return null;
  }

  if (typeof json !== "object" || json === null) return null;
  const { rows, fetchedAt, etag } = json as Record<string, unknown>;
  if (!Array.isArray(rows) || typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt)) return null;

  const parsed = PriceRowSchema.array().safeParse(rows);
  if (!parsed.success) {
    console.error(`[${PLUGIN_ID}] ${path} does not match the current row shape, refetching.`);
    return null;
  }
  return { rows: parsed.data, fetchedAt, etag: typeof etag === "string" ? etag : null };
}

/** How long rows are reused before a mount refetches. Refresh ignores it. */
export const TTL_MS = 12 * 60 * 60 * 1000;

export function isFresh(entry: CacheEntry, now: number = Date.now()): boolean {
  return now - entry.fetchedAt < TTL_MS;
}
