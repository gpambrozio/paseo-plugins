import type { PluginClientContext } from "@getpaseo/plugin/client";

import { GitHubBoard } from "./client/board";

export default function contribute(client: PluginClientContext) {
  client.addSurface("board", GitHubBoard);
  client.addSidebarItem({
    id: "board",
    title: "GitHub",
    icon: "Github",
    surface: "board",
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
