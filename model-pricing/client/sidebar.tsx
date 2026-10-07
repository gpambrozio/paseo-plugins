import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";

import { PRICING_ICON, PRICING_SCREEN_ID } from "./screen";

/**
 * The pricing row in the sidebar header. Its label is the item's registered
 * title, and it is lit while the pricing screen is open.
 */
export function PricingSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon={PRICING_ICON}
      active={currentScreen?.screenId === PRICING_SCREEN_ID}
      onPress={() => openScreen({ screenId: PRICING_SCREEN_ID })}
    />
  );
}
