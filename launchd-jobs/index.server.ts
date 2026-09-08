import type { PluginServerContext } from "@getpaseo/plugin/server";

import {
  createJobHandler,
  deleteJobHandler,
  listJobsHandler,
  readJobLogHandler,
  runJobHandler,
  setJobEnabledHandler,
  updateJobHandler,
} from "./server/jobs";
import {
  createJob,
  deleteJob,
  listJobs,
  readJobLog,
  runJob,
  setJobEnabled,
  updateJob,
} from "./shared/jobs";

export default function contribute(server: PluginServerContext) {
  server.handle(listJobs, listJobsHandler);
  server.handle(createJob, createJobHandler);
  server.handle(updateJob, updateJobHandler);
  server.handle(deleteJob, deleteJobHandler);
  server.handle(runJob, runJobHandler);
  server.handle(setJobEnabled, setJobEnabledHandler);
  server.handle(readJobLog, readJobLogHandler);

  // launchd is the scheduler: the backend holds no timers of its own, and every
  // handler awaits its own launchctl call, so there is nothing to release.
  return () => {};
}
