import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";

import { BOARD_SCREEN_ID } from "./screen";

/**
 * The board's row in the sidebar header. Paseo draws it from the host the app
 * is showing, so `currentScreen` is that host's board, and the row is lit
 * whether or not a card is open on it. A press opens the board with no card
 * open.
 */
export function BoardSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Github"
      active={currentScreen?.screenId === BOARD_SCREEN_ID}
      onPress={() => openScreen({ screenId: BOARD_SCREEN_ID })}
    />
  );
}
