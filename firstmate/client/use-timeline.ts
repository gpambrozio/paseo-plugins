import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";

import type { TimelineEntry } from "./transcript-rows";

/** Wait for a pause in the stream before re-reading, so one burst is one read. */
const QUIET_MS = 300;
/** A stream that never pauses is still re-read this often. */
const CEILING_MS = 1500;

export interface AgentTimeline {
  entries: TimelineEntry[];
  error: string | null;
  loading: boolean;
}

/**
 * The daemon's timeline for one agent, re-read shortly after any stream event.
 *
 * Re-reading rather than appending stream deltas keeps the provider's own
 * merging — reasoning chunks and tool lifecycle updates arrive already folded
 * — so the pane never shows fragments. One read is in flight at a time; events
 * during it coalesce into a single follow-up, and the ceiling keeps a turn
 * that streams without pause from freezing the pane.
 */
export function useAgentTimeline(agentId: string | null, limit = 150): AgentTimeline {
  const paseo = usePaseo();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (agentId === null) {
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }
    const timeline = paseo.agents.ref(agentId).timeline;
    let alive = true;
    let inFlight = false;
    let queued = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);

    function clearTimers(): void {
      clearTimeout(quiet);
      clearTimeout(ceiling);
      quiet = undefined;
      ceiling = undefined;
    }

    // An async function, not an async arrow: Hermes evaluates an async arrow
    // in an eval'd bundle to `undefined`.
    async function load(): Promise<void> {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      try {
        const page = await timeline.refetch({ direction: "tail", limit, projection: "projected" });
        if (!alive) return;
        setEntries(page.entries);
        setError(page.error ?? null);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        inFlight = false;
        if (alive) {
          setLoading(false);
          if (queued) {
            queued = false;
            void load();
          }
        }
      }
    }

    function refresh(): void {
      clearTimers();
      void load();
    }

    function schedule(): void {
      clearTimeout(quiet);
      quiet = setTimeout(refresh, QUIET_MS);
      if (ceiling === undefined) ceiling = setTimeout(refresh, CEILING_MS);
    }

    void load();
    const unsubscribe = timeline.subscribe(schedule);
    return () => {
      alive = false;
      clearTimers();
      unsubscribe();
    };
  }, [paseo, agentId, limit]);

  return { entries, error, loading };
}
