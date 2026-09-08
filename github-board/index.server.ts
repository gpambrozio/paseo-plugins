import type { PluginServerContext } from "@getpaseo/plugin/server";

import {
  listLabelsHandler,
  loadBoardHandler,
  loadCommentsHandler,
  loadImageHandler,
  loadItemHandler,
  saveDetailWidthHandler,
  saveLoginHandler,
  savePromptsHandler,
  saveRepositoryFilterHandler,
  sendOptionsHandler,
  sendToChatHandler,
  toggleLabelHandler,
} from "./server/board";
import {
  listLabels,
  loadBoard,
  loadComments,
  loadImage,
  loadItem,
  saveDetailWidth,
  savePrompts,
  saveLogin,
  saveRepositoryFilter,
  sendOptions,
  sendToChat,
  toggleLabel,
} from "./shared/board";

export default function contribute(server: PluginServerContext) {
  server.handle(loadBoard, loadBoardHandler);
  server.handle(loadItem, loadItemHandler);
  server.handle(loadComments, loadCommentsHandler);
  server.handle(loadImage, loadImageHandler);
  server.handle(saveLogin, saveLoginHandler);
  server.handle(saveRepositoryFilter, saveRepositoryFilterHandler);
  server.handle(saveDetailWidth, saveDetailWidthHandler);
  server.handle(savePrompts, savePromptsHandler);
  server.handle(sendOptions, sendOptionsHandler);
  server.handle(sendToChat, sendToChatHandler);
  server.handle(listLabels, listLabelsHandler);
  server.handle(toggleLabel, toggleLabelHandler);

  // Every handler awaits its own gh subprocess, so there is nothing to release.
  return () => {};
}
