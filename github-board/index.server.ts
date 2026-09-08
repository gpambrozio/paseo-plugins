import type { PluginServerContext } from "@getpaseo/plugin/server";

import {
  listLabelsHandler,
  loadBoardHandler,
  loadCommentsHandler,
  loadImageHandler,
  loadItemHandler,
  saveLoginHandler,
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
  saveLogin,
  sendOptions,
  sendToChat,
  toggleLabel,
} from "./shared/board";
import { displaySettings, promptSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.handle(loadBoard, loadBoardHandler);
  server.handle(loadItem, loadItemHandler);
  server.handle(loadComments, loadCommentsHandler);
  server.handle(loadImage, loadImageHandler);
  server.handle(saveLogin, saveLoginHandler);
  server.handle(sendOptions, sendOptionsHandler);
  server.handle(sendToChat, sendToChatHandler);
  server.handle(listLabels, listLabelsHandler);
  server.handle(toggleLabel, toggleLabelHandler);

  // Storage lives on the host; registering the definitions is what makes the
  // client's `useSettings` reads and writes valid for this installation.
  server.registerSettings(displaySettings);
  server.registerSettings(promptSettings);

  // Every handler awaits its own gh subprocess, so there is nothing to release.
  return () => {};
}
