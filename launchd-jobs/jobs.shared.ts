import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * The zod contracts both halves agree on. Every crossing between the surface
 * and the daemon is one of these; the server validates its side too, so a
 * client that lies is refused rather than written into a plist.
 */

export const CalendarEntrySchema = z.object({
  minute: z.number().int().min(0).max(59).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  day: z.number().int().min(1).max(31).optional(),
  month: z.number().int().min(1).max(12).optional(),
  weekday: z.number().int().min(0).max(7).optional(),
});

/** What a user asks for: a cron expression, or a fixed number of seconds. */
export const ScheduleSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cron"), expression: z.string().trim().min(1) }),
  z.object({ type: z.literal("interval"), seconds: z.number().int().positive() }),
]);

export type ScheduleSpec = z.infer<typeof ScheduleSpecSchema>;

export const JobSpecSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Run through `/bin/zsh -lc`, so it can be anything a shell takes. */
  command: z.string().trim().min(1),
  /** Absolute path, or null to inherit launchd's default (the home directory). */
  cwd: z.string().trim().nullable(),
  schedule: ScheduleSpecSchema,
});

export type JobSpec = z.infer<typeof JobSpecSchema>;

/**
 * What a plist on disk says about when it fires. `cron` when the entries
 * round-trip to an expression, `calendar` when they are some other shape a
 * hand edit produced, `none` when the plist has neither key — a job that only
 * runs when kicked.
 */
export const ScheduleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cron"),
    expression: z.string(),
    description: z.string(),
    entries: z.array(CalendarEntrySchema),
  }),
  z.object({ type: z.literal("interval"), seconds: z.number().int(), description: z.string() }),
  z.object({ type: z.literal("calendar"), description: z.string(), entries: z.array(CalendarEntrySchema) }),
  z.object({ type: z.literal("none"), description: z.string() }),
]);

export type Schedule = z.infer<typeof ScheduleSchema>;

/** One line of the runner's history file. */
export const RunRecordSchema = z.object({
  startedAt: z.string(),
  finishedAt: z.string(),
  exitCode: z.number().int(),
  durationMs: z.number().int().min(0),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

export const JobSchema = z.object({
  /** The slug: the label with the plugin's prefix removed, and the file stem. */
  id: z.string(),
  label: z.string(),
  name: z.string(),
  command: z.string(),
  cwd: z.string().nullable(),
  schedule: ScheduleSchema,
  /**
   * Whether the plist is in the runner shape this plugin writes. A plist under
   * the plugin's label prefix that someone wrote by hand still lists, but its
   * command is shown as launchd would spawn it, and saving it rewrites it.
   */
  managed: z.boolean(),
  /** launchd knows the label. False after a bootout, or for a plist never loaded. */
  loaded: z.boolean(),
  /** `launchctl disable` was applied; it survives reboots until enabled again. */
  disabled: z.boolean(),
  running: z.boolean(),
  pid: z.number().int().nullable(),
  /** launchd's own spawn count since the job was loaded. */
  runs: z.number().int().nullable(),
  lastExitCode: z.number().int().nullable(),
  /** Most recent first. */
  recentRuns: z.array(RunRecordSchema),
  plistPath: z.string(),
  logPath: z.string(),
  /**
   * Why the row is incomplete: a plist under the plugin's prefix that could
   * not be read. One broken file must not blank the whole list.
   */
  problem: z.string().nullable(),
});

export type Job = z.infer<typeof JobSchema>;

export const listJobs = defineRpc({
  name: "jobs.list",
  input: z.object({}),
  output: z.object({
    /** False off macOS; the surface explains and shows nothing else. */
    supported: z.boolean(),
    jobs: z.array(JobSchema),
    launchAgentsDir: z.string(),
  }),
});

export const createJob = defineRpc({
  name: "jobs.create",
  input: JobSpecSchema,
  output: JobSchema,
});

export const updateJob = defineRpc({
  name: "jobs.update",
  input: z.object({ id: z.string(), spec: JobSpecSchema }),
  output: JobSchema,
});

export const deleteJob = defineRpc({
  name: "jobs.delete",
  input: z.object({ id: z.string() }),
  output: z.object({}),
});

export const runJob = defineRpc({
  name: "jobs.run",
  input: z.object({ id: z.string() }),
  output: z.object({}),
});

export const setJobEnabled = defineRpc({
  name: "jobs.set-enabled",
  input: z.object({ id: z.string(), enabled: z.boolean() }),
  output: JobSchema,
});

export const readJobLog = defineRpc({
  name: "jobs.log",
  input: z.object({ id: z.string() }),
  output: z.object({
    text: z.string(),
    /** The file was longer than the tail that came back. */
    truncated: z.boolean(),
    path: z.string(),
  }),
});
