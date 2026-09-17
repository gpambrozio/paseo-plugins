import type { PluginClientContext } from "@getpaseo/plugin/client";

import { startAnnouncer } from "./client/announcer";
import { HeraldSurface, bindSettingsOpener } from "./client/herald";
import { HeraldSettingsScreen } from "./client/settings-screen";
import { HeraldTimelineCard } from "./client/timeline-card";
import { HERALD_CARD_KIND, HERALD_CARD_VERSION, HeraldCardSchema } from "./shared/timeline";

export default function contribute(client: PluginClientContext) {
  // Runs for as long as this client is connected, panel open or not; it is
  // what speaks. Everything below is how the user sees and tunes it.
  const announcer = startAnnouncer(client);

  client.addSurface("herald", HeraldSurface);
  // The surface's own settings button. A surface is given no way to open a
  // settings screen, so the capability is lent to it from here.
  bindSettingsOpener((id) => {
    client.openSettings(id);
  });
  // Draws the rows `server/card.ts` appends. The kind/version pair has to
  // match what the daemon wrote, which is why both sides import it.
  client.addTimelineRenderer({
    kind: HERALD_CARD_KIND,
    version: HERALD_CARD_VERSION,
    schema: HeraldCardSchema,
    Component: HeraldTimelineCard,
  });
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
    bindSettingsOpener(null);
    announcer.stop();
  };
}
