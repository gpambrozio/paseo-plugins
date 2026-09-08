import type { PluginClientContext } from "@getpaseo/plugin/client";

import { GitHubBoard } from "./client/board";
import { BoardSettingsScreen } from "./client/settings-screen";

export default function contribute(client: PluginClientContext) {
  client.addSurface("board", GitHubBoard);
  client.addSidebarItem({
    id: "board",
    title: "GitHub",
    icon: "Github",
    surface: "board",
  });
  client.addSettingsScreen({
    id: "board",
    title: "GitHub board",
    icon: "Github",
    Component: BoardSettingsScreen,
  });
  client.addCommandCenterItem({
    id: "board-settings",
    title: "GitHub board settings",
    icon: "Settings",
    keywords: ["github", "prompts", "templates", "login"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("board");
    },
  });
  client.addCommandCenterItem({
    id: "open-board",
    title: "Open GitHub board",
    icon: "Github",
    keywords: ["github", "issues", "pull requests", "prs", "discussions"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("board");
    },
  });

  return () => {};
}
