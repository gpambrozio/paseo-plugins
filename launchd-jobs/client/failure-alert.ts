/**
 * The sidebar item, and the failure count in it.
 *
 * A job that fails at 3am is worth knowing about without opening anything, so
 * the sidebar row itself carries the news: "Scheduled jobs (2 failing)" with a
 * struck-through calendar instead of a clock.
 *
 * **A sidebar contribution is a static record.** `PluginSidebarContribution` is
 * `{ id, title, icon, surface }` in 0.8 and still is in 0.9 — no badge, no
 * count, no colour, and no callback the host will re-read. The only way to
 * change what the row says is to unregister the contribution and register it
 * again, which is what this module does, and why it owns the registration
 * rather than `index.client.tsx`. Removing and adding happen in the same
 * synchronous step: the host publishes a new snapshot on each, but React
 * schedules rather than renders, so the row never blinks out.
 *
 * Async **function expressions**, never async arrows — see `client/jobs.tsx`.
 */
import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";

import { readJobHealth } from "../shared/jobs";

const TITLE = "Scheduled jobs";
const IDLE_ICON = "CalendarClock";
const FAILING_ICON = "CalendarX2";

/**
 * How often the count is re-asked. This runs whether or not the surface is
 * open, so it answers from the history files alone — no `launchctl` — and is
 * slower than the surface's own 15-second list refresh.
 */
const POLL_MS = 60_000;

/**
 * Lent to the surface by `start`, the way `herald` lends `openSettings`: the
 * surface calls it after acknowledging or deleting a job so the row catches up
 * now instead of within the minute. Null before contribution and after
 * cleanup, and calling it then is a no-op rather than an error.
 */
let recheck: (() => void) | null = null;

export function refreshFailureAlert(): void {
  recheck?.();
}

/**
 * Registers the sidebar item and keeps its title and icon honest. The returned
 * cleanup stops the poll and removes the item.
 */
export function startFailureAlert(client: PluginClientContext): PluginCleanup {
  let registration = register(0);
  let shown = 0;
  let stopped = false;
  let polling = false;
  /** Only warn when the failure changes, or a broken daemon logs every minute. */
  let lastWarning: string | null = null;

  function register(count: number): PluginCleanup {
    return client.addSidebarItem({
      id: "jobs",
      title: count === 0 ? TITLE : `${TITLE} (${count} failing)`,
      icon: count === 0 ? IDLE_ICON : FAILING_ICON,
      surface: "jobs",
    });
  }

  function show(count: number): void {
    if (stopped || count === shown) return;
    registration();
    registration = register(count);
    shown = count;
  }

  async function poll(): Promise<void> {
    if (stopped || polling) return;
    polling = true;
    try {
      const health = await client.rpc(readJobHealth, {});
      lastWarning = null;
      show(health.failing.length);
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
    registration();
  };
}
