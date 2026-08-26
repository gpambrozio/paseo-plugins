import type { PluginContext } from "@getpaseo/plugin";
import { GitHubBoard } from "./board.client";
import {
  listLabelsHandler,
  loadBoardHandler,
  saveLoginHandler,
  savePromptsHandler,
  saveRepositoryFilterHandler,
  sendOptionsHandler,
  sendToChatHandler,
  toggleLabelHandler,
} from "./board.server";
import {
  listLabels,
  loadBoard,
  savePrompts,
  saveLogin,
  saveRepositoryFilter,
  sendOptions,
  sendToChat,
  toggleLabel,
} from "./board.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(loadBoard, loadBoardHandler);
  plugin.handle(saveLogin, saveLoginHandler);
  plugin.handle(saveRepositoryFilter, saveRepositoryFilterHandler);
  plugin.handle(savePrompts, savePromptsHandler);
  plugin.handle(sendOptions, sendOptionsHandler);
  plugin.handle(sendToChat, sendToChatHandler);
  plugin.handle(listLabels, listLabelsHandler);
  plugin.handle(toggleLabel, toggleLabelHandler);

  plugin.addSurface("board", GitHubBoard);
  plugin.addSidebarItem({
    id: "board",
    title: "GitHub",
    icon: "Github",
    surface: "board",
  });
  plugin.addCommandCenterItem({
    id: "open-board",
    title: "Open GitHub board",
    icon: "Github",
    keywords: ["github", "issues", "pull requests", "prs", "discussions"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("board");
    },
  });

  // Every handler awaits its own gh subprocess and the surface owns no timers,
  // so there is nothing to release.
  return () => {};
}
