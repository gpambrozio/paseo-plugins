import type { PluginClientContext } from "@getpaseo/plugin/client";

import { GitHubBoard } from "./client/board";
import { BoardSettingsScreen } from "./client/settings-screen";
import { BoardTimelineCard } from "./client/timeline";
import { BoardTimelineItemSchema } from "./shared/board";
import { BOARD_ITEM_TIMELINE_KIND, BOARD_ITEM_TIMELINE_VERSION } from "./shared/timeline";

export default function contribute(client: PluginClientContext) {
  client.addSurface("board", GitHubBoard);
  /**
   * Renders the rows `sendToChatHandler` appends. The `kind`/`version` pair has
   * to match what the daemon wrote, which is why both sides import it from
   * `shared/timeline` instead of spelling it twice.
   *
   * Registered unconditionally, including for agents this board never launched:
   * the host only calls it for rows carrying this plugin's id and this kind, and
   * a transcript with no such row simply never reaches it.
   */
  client.addTimelineRenderer({
    kind: BOARD_ITEM_TIMELINE_KIND,
    version: BOARD_ITEM_TIMELINE_VERSION,
    schema: BoardTimelineItemSchema,
    Component: BoardTimelineCard,
  });
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
