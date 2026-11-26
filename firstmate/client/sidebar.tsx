/**
 * The sidebar item: the FirstMate row, with a count in the warning colour of the topics that wait on the
 * captain, and none while that is zero.
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
import { FLEET_SCREEN_ID, needsYouCount } from "./screen";
import { FONT_SIZE } from "./type-scale";

export function FleetSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const display = useSettings(displaySettings);
  const fleet = useFleet(display.status === "ready" ? display.values.pollSeconds : 5);
  // Before there is a first mate the screen is the launch panel, with no topic to answer.
  const count = fleet.data?.mate == null ? 0 : needsYouCount(fleet.data.cards);
  const styles = useMemo(
    () => ({
      badge: {
        minWidth: 18,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 9,
        alignItems: "center" as const,
        backgroundColor: theme.colors.statusWarning,
      },
      badgeText: { color: theme.colors.surface0, fontSize: FONT_SIZE.caption, fontWeight: "700" as const },
    }),
    [theme],
  );

  return (
    <SidebarRow
      icon="Ship"
      active={currentScreen?.screenId === FLEET_SCREEN_ID}
      trailing={
        count === 0 ? undefined : (
          <View style={styles.badge} accessibilityLabel={`${count} ${count === 1 ? "topic needs" : "topics need"} you`}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        )
      }
      onPress={() => openScreen({ screenId: FLEET_SCREEN_ID })}
    />
  );
}
