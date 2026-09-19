import type { PluginServerContext } from "@getpaseo/plugin/server";

import {
  acknowledgeJobHandler,
  createJobHandler,
  deleteJobHandler,
  listJobsHandler,
  readJobHealthHandler,
  readJobLogHandler,
  runJobHandler,
  setJobEnabledHandler,
  updateJobHandler,
} from "./server/jobs";
import {
  acknowledgeJob,
  createJob,
  deleteJob,
  listJobs,
  readJobHealth,
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
  server.handle(readJobHealth, readJobHealthHandler);
  server.handle(acknowledgeJob, acknowledgeJobHandler);

  // launchd is the scheduler: the backend holds no timers of its own, and every
  // handler awaits its own launchctl call, so there is nothing to release.
  return () => {};
}
