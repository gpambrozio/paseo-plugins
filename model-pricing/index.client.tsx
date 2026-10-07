/**
 * Wiring: the screen, its sidebar row, the settings screen, and the two
 * Command Center items that reach them.
 *
 * `bindSettingsOpener` is the one piece that is not plain registration. A
 * screen is given no way to open a settings screen — `PluginScreenProps`
 * carries no `openSettings` — so the capability is lent to the module here.
 * Contribution runs before any screen mounts, so the binding is always set by
 * the time one renders, and it is cleared in the cleanup because this module
 * outlives a disconnected client's context.
 */
import type { PluginClientContext } from "@getpaseo/plugin/client";

import { PricingSurface, bindSettingsOpener } from "./client/pricing";
import { PRICING_ICON, PRICING_SCREEN_ID, PRICING_TITLE } from "./client/screen";
import { PricingSettingsScreen } from "./client/settings-screen";
import { PricingSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: PRICING_SCREEN_ID, title: PRICING_TITLE, Component: PricingSurface });
  bindSettingsOpener((id) => {
    client.openSettings(id);
  });

  client.addSidebarHeaderItem({ id: PRICING_SCREEN_ID, title: PRICING_TITLE, Component: PricingSidebarItem });
  client.addSettingsScreen({
    id: "model-pricing",
    title: PRICING_TITLE,
    icon: PRICING_ICON,
    Component: PricingSettingsScreen,
  });

  client.addCommandCenterItem({
    id: "open-model-pricing",
    title: "Open model pricing",
    icon: PRICING_ICON,
    keywords: ["pricing", "price", "cost", "tokens", "models", "cheap", "expensive"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: PRICING_SCREEN_ID });
    },
  });
  client.addCommandCenterItem({
    id: "model-pricing-settings",
    title: "Model pricing settings",
    icon: "Settings",
    keywords: ["pricing", "providers", "openrouter", "anthropic", "openai", "fireworks", "ollama"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("model-pricing");
    },
  });

  return () => {
    bindSettingsOpener(null);
  };
}
