import type { PluginOpenScreenInput, PluginScreenParams } from "@getpaseo/plugin/client";

/**
 * The plugin's one screen. Also the sidebar item's id, which is not a free
 * choice: Settings > Sidebar keys its ordering and hidden state on the item id,
 * and a saved `/plugin/launchd-jobs/sidebar/jobs` link resolves to the screen
 * of the same id, so renaming either loses both.
 */
export const JOBS_SCREEN_ID = "jobs";
export const JOBS_TITLE = "Scheduled jobs";

/**
 * The screen param naming the job to open on. It is read when the screen
 * mounts, and every `openScreen` mounts a new instance — the host's stack
 * pushes a route per call — so it names the job the screen was *opened* on:
 * the sidebar's popover opens a failing job with it, and a reload or a link
 * comes back to that job. Presses inside the screen do not move it, because a
 * plugin can only push, and a push per press would stack a screen per job.
 */
export const JOB_PARAM = "job";

/** The job the screen's params name, or null when they name none. */
export function requestedJobId(params: PluginScreenParams): string | null {
  const value = params[JOB_PARAM];
  return value === undefined || value === "" ? null : value;
}

/** The input that opens the screen on job `id`, or on no job when null. */
export function jobsScreenInput(id: string | null): PluginOpenScreenInput {
  return { screenId: JOBS_SCREEN_ID, params: id === null ? {} : { [JOB_PARAM]: id } };
}

/**
 * What the screen's right-hand side shows. Only the job it is about travels in
 * the URL; whether that job is viewed or edited, and an open "New job" form,
 * are the screen's own.
 */
export type Pane = { kind: "empty" } | { kind: "view"; id: string } | { kind: "edit"; id: string } | { kind: "new" };

/** The job a pane is about, which is what the screen's URL names. */
export function paneJobId(pane: Pane): string | null {
  return pane.kind === "view" || pane.kind === "edit" ? pane.id : null;
}

/**
 * The pane for a URL naming `requested`: `current` when it is already about
 * that job (so an open form survives), otherwise the job's detail, or nothing.
 */
export function paneFor(requested: string | null, current: Pane): Pane {
  if (paneJobId(current) === requested) return current;
  return requested === null ? { kind: "empty" } : { kind: "view", id: requested };
}
