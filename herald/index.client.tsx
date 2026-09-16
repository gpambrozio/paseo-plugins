import type { PluginClientContext } from "@getpaseo/plugin/client";

import { startAnnouncer } from "./client/announcer";
import { HeraldSurface } from "./client/herald";
import { HeraldSettingsScreen } from "./client/settings-screen";

export default function contribute(client: PluginClientContext) {
  // Runs for as long as this client is connected, panel open or not; it is
  // what speaks. Everything below is how the user sees and tunes it.
  const announcer = startAnnouncer(client);

  client.addSurface("herald", HeraldSurface);
  client.addSidebarItem({
    id: "herald",
    title: "Herald",
    icon: "Megaphone",
    surface: "herald",
  });
  client.addSettingsScreen({
    id: "herald",
    title: "Herald",
    icon: "Megaphone",
    Component: HeraldSettingsScreen,
  });
  client.addCommandCenterItem({
    id: "open-herald",
    title: "Open Herald",
    icon: "Megaphone",
    keywords: ["herald", "attention", "waiting", "needs you", "speak", "voice"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("herald");
    },
  });
  client.addCommandCenterItem({
    id: "herald-settings",
    title: "Herald settings",
    icon: "Settings",
    keywords: ["herald", "voice", "speech", "announce", "summary model"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("herald");
    },
  });

  return () => {
    announcer.stop();
  };
}
