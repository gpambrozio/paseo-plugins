/**
 * The sidebar item: the FirstMate row, and under it a row per crewmate Paseo
 * still runs, each with its card's column as an icon and a mark while it waits
 * on a permission. A crewmate's row opens the screen on that crewmate.
 *
 * It reads the board's own fleet query, so with the screen or a panel open the
 * three poll once between them; with neither open, it is what keeps the poll
 * going. It has no `navigation`, so a row cannot open the agent in Paseo; the
 * screen's crewmate view has that button.
 */
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { SidebarRow, SidebarSeparator } from "@getpaseo/plugin/client/ui";

import { displaySettings } from "../shared/settings";
import { sidebarRowPressed, useFleet } from "./fleet";
import { CREW_PARAM, FLEET_SCREEN_ID, crewIcon, sidebarCrew } from "./screen";

export function FleetSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const display = useSettings(displaySettings);
  const fleet = useFleet(display.status === "ready" ? display.values.pollSeconds : 5);
  const crew = sidebarCrew(fleet.data?.cards ?? []);
  const onFleet = currentScreen?.screenId === FLEET_SCREEN_ID;
  const openCrew = onFleet ? (currentScreen.params[CREW_PARAM] || null) : null;

  return (
    <>
      <SidebarRow
        icon="Ship"
        active={onFleet && openCrew === null}
        onPress={() => {
          sidebarRowPressed(null);
          openScreen({ screenId: FLEET_SCREEN_ID });
        }}
      />
      {crew.length === 0 ? null : <SidebarSeparator />}
      {crew.map((card) => (
        <SidebarRow
          key={card.key}
          id={card.agent.id}
          icon={crewIcon(card.column)}
          label={card.title}
          active={openCrew === card.agent.id}
          trailing={
            card.agent.pendingPermissions > 0 ? (
              <Icon name="ShieldAlert" size={14} color={theme.colors.statusWarning} />
            ) : undefined
          }
          onPress={() => {
            sidebarRowPressed(card.agent.id);
            openScreen({ screenId: FLEET_SCREEN_ID, params: { [CREW_PARAM]: card.agent.id } });
          }}
        />
      ))}
    </>
  );
}
