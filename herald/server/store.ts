/**
 * One entry per agent: the most recent reason it is waiting on the user, and
 * the summary for it. Newer events replace older ones for the same agent —
 * an agent has one composer and one thing it is waiting for.
 *
 * Paseo's own `requiresAttention` flag stays the authority on *who* is waiting;
 * this store only explains *why*. Entries are removed when the hooks see the
 * agent move on (a new turn, a resolved permission, an archive), and by
 * `Liveness` when the agent turns out to be archived or gone. There is no age
 * limit: an agent that asked a question a week ago is still waiting for the
 * answer.
 *
 * Mirrored to a JSON file so a plugin reload does not lose the summaries
 * already written; a summary still pending at load time is marked failed,
 * because the helper that was writing it died with the old process.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { AttentionEntrySchema, type AttentionEntry, type SummaryState } from "../shared/herald";
import { fallbackSpeech } from "./timeline";

export class AttentionStore {
  private readonly entries = new Map<string, AttentionEntry>();
  private writes: Promise<void> = Promise.resolve();
  /**
   * Agents changed since this store was made. `load` runs while the plugin is
   * already answering events — a contribution registers its handlers
   * synchronously, so the file read cannot be awaited first — and whatever
   * arrived live is newer than anything on disk. Cleared once `load` is done.
   */
  private readonly touched = new Set<string>();

  /** `path === null` keeps everything in memory, which is what the tests want. */
  constructor(private readonly path: string | null) {}

  async load(): Promise<void> {
    if (this.path === null) return;
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const json: unknown = JSON.parse(raw);
    if (!Array.isArray(json)) throw new Error(`${this.path}: expected an array of entries`);
    for (const item of json) {
      const parsed = AttentionEntrySchema.safeParse(item);
      if (!parsed.success) {
        console.error(`[herald] dropping unreadable entry from ${this.path}: ${parsed.error.message}`);
        continue;
      }
      const entry = parsed.data;
      // Never undo a live upsert or removal that landed during the read.
      if (this.touched.has(entry.agentId)) continue;
      this.entries.set(
        entry.agentId,
        entry.summary.status === "pending"
          ? {
              ...entry,
              summary: {
                status: "failed",
                error: "The plugin restarted before the summary was written.",
                fallback: fallbackSpeech(entry),
              },
            }
          : entry,
      );
    }
    this.touched.clear();
  }

  list(): AttentionEntry[] {
    return [...this.entries.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(agentId: string): AttentionEntry | null {
    return this.entries.get(agentId) ?? null;
  }

  upsert(entry: AttentionEntry): void {
    this.touched.add(entry.agentId);
    this.entries.set(entry.agentId, entry);
    this.persist();
  }

  /**
   * Applies a summary only if the agent is still waiting on the same event.
   * A helper that finishes after the user has already moved on — or after a
   * newer event replaced this one — must not overwrite what is there now.
   */
  updateSummary(agentId: string, eventId: string, summary: SummaryState): boolean {
    const current = this.entries.get(agentId);
    if (current === undefined || current.eventId !== eventId) return false;
    this.entries.set(agentId, { ...current, summary });
    this.persist();
    return true;
  }

  remove(agentId: string): AttentionEntry | null {
    this.touched.add(agentId);
    const current = this.entries.get(agentId) ?? null;
    if (current !== null) {
      this.entries.delete(agentId);
      this.persist();
    }
    return current;
  }

  removeIf(agentId: string, predicate: (entry: AttentionEntry) => boolean): boolean {
    const current = this.entries.get(agentId);
    if (current === undefined || !predicate(current)) return false;
    this.touched.add(agentId);
    this.entries.delete(agentId);
    this.persist();
    return true;
  }

  /** Resolves once every write issued so far has landed; for tests and cleanup. */
  flush(): Promise<void> {
    return this.writes;
  }

  /**
   * Writes are chained so two events a millisecond apart cannot interleave
   * halves of a file. A failed write is reported and never thrown: the store
   * in memory is still right, and the next write tries again.
   */
  private persist(): void {
    if (this.path === null) return;
    const path = this.path;
    const snapshot = JSON.stringify([...this.entries.values()], null, 2);
    this.writes = this.writes
      .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${snapshot}\n`, "utf8");
      })
      .catch((error: unknown) => {
        console.error(`[herald] could not write ${path}:`, error);
      });
  }
}
