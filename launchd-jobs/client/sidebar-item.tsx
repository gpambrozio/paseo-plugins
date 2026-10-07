import type { PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { useFailingJobs } from "./failure-alert";
import { lastJobsScreenInput } from "./jobs";
import { JOBS_SCREEN_ID, jobsScreenInput } from "./screen";

const IDLE_ICON = "CalendarClock";
const FAILING_ICON = "CalendarX2";

/**
 * The Scheduled jobs row in the sidebar header. Paseo draws it from the host
 * the app is showing, and the failing count comes from that host's own poll,
 * so the badge is always the viewed host's jobs.
 *
 * A press on the row opens the screen on whatever job was open last, so
 * leaving and coming back finds it. A press on the badge — `trailing` presses
 * on its own — opens the list of failing jobs instead.
 */
export function JobsSidebarItem({ theme, currentScreen, openScreen, openPopover }: PluginSidebarItemProps) {
  const failing = useFailingJobs();
  const count = failing.length;

  const styles = useMemo(
    () => ({
      badge: {
        minWidth: 18,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 9,
        alignItems: "center" as const,
        backgroundColor: theme.colors.statusDanger,
      },
      badgeText: { color: theme.colors.surface0, fontSize: 11, fontWeight: "600" as const },
    }),
    [theme],
  );

  return (
    <SidebarRow
      icon={count === 0 ? IDLE_ICON : FAILING_ICON}
      active={currentScreen?.screenId === JOBS_SCREEN_ID}
      trailing={
        count === 0 ? undefined : (
          <Pressable
            style={styles.badge}
            accessibilityRole="button"
            accessibilityLabel={`${count} failing ${count === 1 ? "job" : "jobs"}`}
            onPress={() => openPopover(FailingJobsPopover)}
          >
            <Text style={styles.badgeText}>{count}</Text>
          </Pressable>
        )
      }
      onPress={() => openScreen(lastJobsScreenInput())}
    />
  );
}

/**
 * The failing jobs, one row each; a row opens the screen on that job, which
 * shows its last run and acknowledges the failure. It reads the store live, so
 * a job acknowledged elsewhere while it is open drops out of it.
 */
function FailingJobsPopover({ theme, openScreen }: PluginPopoverProps) {
  const failing = useFailingJobs();

  const styles = useMemo(
    () => ({
      list: { minWidth: 200, gap: 2 },
      heading: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 4,
        borderRadius: 6,
      },
      rowPressed: { backgroundColor: theme.colors.surface2 },
      name: { flex: 1, color: theme.colors.foreground, fontSize: 13 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13 },
    }),
    [theme],
  );

  if (failing.length === 0) {
    return <Text style={styles.empty}>No failing jobs.</Text>;
  }

  return (
    <View style={styles.list}>
      <Text style={styles.heading}>
        {failing.length === 1 ? "1 job failed its last run" : `${failing.length} jobs failed their last run`}
      </Text>
      {failing.map((job) => (
        <Pressable
          key={job.id}
          style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
          accessibilityRole="button"
          accessibilityLabel={`Open ${job.name}`}
          onPress={() => openScreen(jobsScreenInput(job.id))}
        >
          <Icon name={FAILING_ICON} size={15} color={theme.colors.statusDanger} />
          <Text style={styles.name} numberOfLines={1}>
            {job.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
