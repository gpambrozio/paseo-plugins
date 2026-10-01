/**
 * The sidebar item: the FirstMate row, with a badge counting the crewmates
 * that are working or idle, and none while that is zero.
 *
 * It reads the board's own fleet query, so with the screen or a panel open the
 * three poll once between them; with neither open, it is what keeps the poll
 * going.
 */
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Text, View } from "react-native";

import { displaySettings } from "../shared/settings";
import { useFleet } from "./fleet";
import { FLEET_SCREEN_ID, activeCrewCount } from "./screen";

export function FleetSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const display = useSettings(displaySettings);
  const fleet = useFleet(display.status === "ready" ? display.values.pollSeconds : 5);
  const count = activeCrewCount(fleet.data?.cards ?? []);

  const styles = useMemo(
    () => ({
      badge: {
        minWidth: 18,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 9,
        alignItems: "center" as const,
        backgroundColor: theme.colors.surface2,
      },
      badgeText: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" as const },
    }),
    [theme],
  );

  return (
    <SidebarRow
      icon="Ship"
      active={currentScreen?.screenId === FLEET_SCREEN_ID}
      trailing={
        count === 0 ? undefined : (
          <View
            style={styles.badge}
            accessibilityLabel={`${count} ${count === 1 ? "crewmate" : "crewmates"} working or idle`}
          >
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        )
      }
      onPress={() => openScreen({ screenId: FLEET_SCREEN_ID })}
    />
  );
}
