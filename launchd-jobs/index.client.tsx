import type { PluginClientContext } from "@getpaseo/plugin/client";

import { startFailureAlert } from "./client/failure-alert";
import { LaunchdJobs, lastJobsScreenInput } from "./client/jobs";
import { JOBS_SCREEN_ID, JOBS_TITLE } from "./client/screen";
import { JobsSidebarItem } from "./client/sidebar-item";

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: JOBS_SCREEN_ID, title: JOBS_TITLE, Component: LaunchdJobs });
  client.addSidebarHeaderItem({ id: JOBS_SCREEN_ID, title: JOBS_TITLE, Component: JobsSidebarItem });
  // The row reads the failing count from the store this poll writes.
  const stopAlert = startFailureAlert(client);
  client.addCommandCenterItem({
    id: "open-jobs",
    title: "Open scheduled jobs",
    icon: "CalendarClock",
    keywords: ["launchd", "cron", "schedule", "jobs", "timer"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen(lastJobsScreenInput());
    },
  });

  // The screen owns its own refresh timer and releases it on unmount; the
  // alert's poll is this file's to stop.
  return () => {
    stopAlert();
  };
}
