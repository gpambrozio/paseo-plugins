import type { PluginContext } from "@getpaseo/plugin";
import { LaunchdJobs } from "./jobs.client";
import {
  createJobHandler,
  deleteJobHandler,
  listJobsHandler,
  readJobLogHandler,
  runJobHandler,
  setJobEnabledHandler,
  updateJobHandler,
} from "./jobs.server";
import { createJob, deleteJob, listJobs, readJobLog, runJob, setJobEnabled, updateJob } from "./jobs.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listJobs, listJobsHandler);
  plugin.handle(createJob, createJobHandler);
  plugin.handle(updateJob, updateJobHandler);
  plugin.handle(deleteJob, deleteJobHandler);
  plugin.handle(runJob, runJobHandler);
  plugin.handle(setJobEnabled, setJobEnabledHandler);
  plugin.handle(readJobLog, readJobLogHandler);

  plugin.addSurface("jobs", LaunchdJobs);
  plugin.addSidebarItem({
    id: "jobs",
    title: "Scheduled jobs",
    icon: "CalendarClock",
    surface: "jobs",
  });
  plugin.addCommandCenterItem({
    id: "open-jobs",
    title: "Open scheduled jobs",
    icon: "CalendarClock",
    keywords: ["launchd", "cron", "schedule", "jobs", "timer"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("jobs");
    },
  });

  // launchd is the scheduler: the backend holds no timers of its own, and every
  // handler awaits its own launchctl call, so there is nothing to release.
  return () => {};
}
