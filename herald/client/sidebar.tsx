/**
 * Herald's row in the sidebar header, and the popover behind its badge.
 *
 * The row opens the Herald screen, as it always has. While anyone is waiting
 * it carries a count, and the count is a button of its own — `SidebarRow`
 * draws `trailing` beside the row's pressable — that opens a list of who is
 * waiting; picking one opens the screen focused on that agent. The popover is
 * given no `navigation`, so it cannot open the agent itself.
 *
 * The count is the screen's own join (`client/waiting.ts`), so the two never
 * disagree, and with both on show they poll once between them.
 */
import type { PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { lookOf, relativeTime, rowSubtitle, rowTitle, toneColor, withAlpha } from "./rows";
import { HERALD_SCREEN_ID, heraldScreenInput } from "./screen";
import { useWaiting, useWaitingNudges } from "./waiting";

function waitingLabel(count: number): string {
  return `${count} ${count === 1 ? "agent" : "agents"} waiting for you`;
}

export function HeraldSidebarItem({ theme, currentScreen, openScreen, openPopover }: PluginSidebarItemProps) {
  const waiting = useWaiting();
  useWaitingNudges();
  const count = waiting.data?.rows.length ?? 0;

  const styles = useMemo(() => {
    const warning = theme.colors.statusWarning;
    return {
      badge: {
        minWidth: 18,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 9,
        alignItems: "center" as const,
        backgroundColor: withAlpha(warning, "26", theme.colors.surface2),
      },
      badgeText: { color: warning, fontSize: 11, fontWeight: "600" as const },
    };
  }, [theme]);

  return (
    <SidebarRow
      icon="Megaphone"
      active={currentScreen?.screenId === HERALD_SCREEN_ID}
      trailing={
        count === 0 ? undefined : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${waitingLabel(count)}. Show them`}
            hitSlop={6}
            onPress={() => openPopover(WaitingPopover)}
            style={styles.badge}
          >
            <Text style={styles.badgeText}>{count}</Text>
          </Pressable>
        )
      }
      onPress={() => openScreen(heraldScreenInput())}
    />
  );
}

/** Who is waiting, newest first; a press opens the Herald screen on that agent. */
function WaitingPopover({ theme, openScreen }: PluginPopoverProps) {
  const waiting = useWaiting();
  const rows = waiting.data?.rows ?? [];
  const workspaceNames = waiting.data?.workspaceNames ?? {};

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      heading: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 6,
      },
      rowPressed: { backgroundColor: colors.surface2 },
      rowText: { flex: 1, gap: 1 },
      title: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
      meta: { color: colors.foregroundMuted, fontSize: 12 },
      empty: { color: colors.foregroundMuted, fontSize: 13, paddingHorizontal: 8, paddingVertical: 6 },
      footer: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 8,
        paddingVertical: 6,
        marginTop: 4,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      },
      footerText: { color: colors.accent, fontSize: 13 },
    };
  }, [theme]);

  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.heading}>{rows.length === 0 ? "Herald" : waitingLabel(rows.length)}</Text>
      {rows.length === 0 ? <Text style={styles.empty}>Nothing needs you right now.</Text> : null}
      {rows.map((row) => {
        const look = lookOf(row.reason);
        const color = toneColor(theme, look.tone);
        const title = rowTitle(row, workspaceNames);
        const subtitle = rowSubtitle(row);
        return (
          <Pressable
            key={row.agentId}
            accessibilityRole="button"
            accessibilityLabel={`${look.label}: ${title}`}
            onPress={() => openScreen(heraldScreenInput(row.agentId))}
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
          >
            <Icon name={look.icon} size={14} color={color} />
            <View style={styles.rowText}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {subtitle === null ? look.label : `${look.label} · ${subtitle}`}
              </Text>
            </View>
            <Text style={styles.meta}>{relativeTime(row.at)}</Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        onPress={() => openScreen(heraldScreenInput())}
        style={({ pressed }) => [styles.footer, pressed ? styles.rowPressed : null]}
      >
        <Icon name="Megaphone" size={14} color={theme.colors.accent} />
        <Text style={styles.footerText}>Open Herald</Text>
      </Pressable>
    </View>
  );
}
