import type { PluginClientContext } from "@getpaseo/plugin/client";

import { LaunchdJobs } from "./client/jobs";

export default function contribute(client: PluginClientContext) {
  client.addSurface("jobs", LaunchdJobs);
  client.addSidebarItem({
    id: "jobs",
    title: "Scheduled jobs",
    icon: "CalendarClock",
    surface: "jobs",
  });
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

  // The surface owns its own refresh timer and releases it on unmount.
  return () => {};
}
