/**
 * Wiring: the surface, its sidebar entry, the settings screen, and the two
 * Command Center items that reach them.
 *
 * `bindSettingsOpener` is the one piece that is not plain registration. A
 * surface is given no way to open a settings screen — `PluginSurfaceProps`
 * carries no `openSettings` — so the capability is lent to the module here.
 * Contribution runs before any surface mounts, so the binding is always set by
 * the time one renders, and it is cleared in the cleanup because this module
 * outlives a disconnected client's context.
 */
import type { PluginClientContext } from "@getpaseo/plugin/client";

import { PricingSurface, bindSettingsOpener } from "./client/pricing";
import { PricingSettingsScreen } from "./client/settings-screen";

/** Any Lucide component name. A typo load-fails the whole plugin. */
const ICON = "CircleDollarSign";

export default function contribute(client: PluginClientContext) {
  client.addSurface("pricing", PricingSurface);
  bindSettingsOpener((id) => {
    client.openSettings(id);
  });

  client.addSidebarItem({
    id: "model-pricing",
    title: "Model pricing",
    icon: ICON,
    surface: "pricing",
  });
  client.addSettingsScreen({
    id: "model-pricing",
    title: "Model pricing",
    icon: ICON,
    Component: PricingSettingsScreen,
  });

  client.addCommandCenterItem({
    id: "open-model-pricing",
    title: "Open model pricing",
    icon: ICON,
    keywords: ["pricing", "price", "cost", "tokens", "models", "cheap", "expensive"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("pricing");
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
