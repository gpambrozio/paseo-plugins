import type { PluginClientContext } from "@getpaseo/plugin/client";

import { startFailureAlert } from "./client/failure-alert";
import { LaunchdJobs } from "./client/jobs";

export default function contribute(client: PluginClientContext) {
  client.addSurface("jobs", LaunchdJobs);
  // The sidebar item belongs to the alert, not to this file: its title and
  // icon change with the number of failing jobs, and the only way a static
  // contribution can change is to be registered again.
  const stopAlert = startFailureAlert(client);
  client.addCommandCenterItem({
    id: "open-jobs",
    title: "Open scheduled jobs",
    icon: "CalendarClock",
    keywords: ["launchd", "cron", "schedule", "jobs", "timer"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("jobs");
    },
  });

  // The surface owns its own refresh timer and releases it on unmount; the
  // alert's poll is this file's to stop.
  return () => {
    stopAlert();
  };
}
