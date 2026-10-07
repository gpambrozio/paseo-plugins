/**
 * The failing jobs the sidebar row counts, and the poll that finds them.
 *
 * A job that fails at 3am is worth knowing about without opening anything, so
 * the sidebar row itself carries the news: a red count beside "Scheduled jobs"
 * and a struck-through calendar instead of a clock. The row is a live
 * component (`client/sidebar-item.tsx`); this module is the store it reads,
 * written by a poll that runs whether or not the screen or the sidebar is
 * showing. Module scope belongs to one host's bundle eval, so the store is that
 * host's jobs — the same host the app draws the row for.
 *
 * Async **function expressions**, never async arrows — see `client/jobs.tsx`.
 */
import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useSyncExternalStore } from "react";

import { readJobHealth } from "../shared/jobs";

export interface FailingJob {
  id: string;
  name: string;
}

/**
 * How often the count is re-asked. This runs whether or not the screen is
 * open, so it answers from the history files alone — no `launchctl` — and is
 * slower than the screen's own 15-second list refresh.
 */
const POLL_MS = 60_000;

const NONE: readonly FailingJob[] = [];

/**
 * The last answer. Replaced only when it differs, so `useSyncExternalStore`
 * sees a stable snapshot between polls and the row re-renders only on news.
 */
let failing: readonly FailingJob[] = NONE;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): readonly FailingJob[] {
  return failing;
}

function publish(next: readonly FailingJob[]): void {
  const same =
    next.length === failing.length &&
    next.every((job, index) => job.id === failing[index]?.id && job.name === failing[index]?.name);
  if (same) return;
  failing = next.length === 0 ? NONE : next;
  listeners.forEach((listener) => listener());
}

/** The failing jobs, as of the last poll. Re-renders when they change. */
export function useFailingJobs(): readonly FailingJob[] {
  return useSyncExternalStore(subscribe, snapshot);
}

/**
 * Lent to the screen by `start`, the way `herald` lends `openSettings`: the
 * screen calls it after acknowledging or deleting a job so the row catches up
 * now instead of within the minute. Null before contribution and after
 * cleanup, and calling it then is a no-op rather than an error.
 */
let recheck: (() => void) | null = null;

export function refreshFailureAlert(): void {
  recheck?.();
}

/** Starts the poll that feeds the store. The returned cleanup stops it. */
export function startFailureAlert(client: PluginClientContext): PluginCleanup {
  let stopped = false;
  let polling = false;
  /**
   * A recheck asked for while a poll was in flight. That poll's answer may
   * predate what prompted it — an acknowledgement, a delete — so one more
   * follows rather than leaving a job the user just opened in the popover.
   */
  let again = false;
  /** Only warn when the failure changes, or a broken daemon logs every minute. */
  let lastWarning: string | null = null;

  async function poll(): Promise<void> {
    if (stopped) return;
    if (polling) {
      again = true;
      return;
    }
    polling = true;
    try {
      const health = await client.rpc(readJobHealth, {});
      lastWarning = null;
      if (!stopped) publish(health.failing);
      // Off macOS there are no jobs and never will be; stop asking.
      if (!health.supported) stop();
    } catch (error) {
      // A disconnected daemon or a plugin mid-reload: keep the count we have
      // rather than claiming everything is well.
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastWarning) {
        lastWarning = message;
        console.warn(`[launchd-jobs] could not check job health: ${message}`);
      }
    } finally {
      polling = false;
      if (again) {
        again = false;
        void poll();
      }
    }
  }

  const timer = setInterval(function tick() {
    void poll();
  }, POLL_MS);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  }

  recheck = () => void poll();
  void poll();

  return () => {
    stop();
    recheck = null;
    publish(NONE);
  };
}
