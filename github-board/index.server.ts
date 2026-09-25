import type { PluginServerContext } from "@getpaseo/plugin/server";

import {
  launchDefaultsHandler,
  listLabelsHandler,
  loadBoardHandler,
  loadCommentsHandler,
  loadImageHandler,
  loadItemHandler,
  legacySettingsTakenHandler,
  saveLaunchDefaultsHandler,
  saveLoginHandler,
  takeLegacySettingsHandler,
  sendOptionsHandler,
  sendToChatHandler,
  toggleLabelHandler,
  updateBranchHandler,
} from "./server/board";
import {
  launchDefaults,
  listLabels,
  loadBoard,
  loadComments,
  loadImage,
  loadItem,
  legacySettingsTaken,
  saveLaunchDefaults,
  saveLogin,
  takeLegacySettings,
  sendOptions,
  sendToChat,
  toggleLabel,
  updateBranch,
} from "./shared/board";
import { migrateLegacyData } from "./server/data-dir";
import { displaySettings, promptSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  migrateLegacyData(["settings.json"]);
  server.handle(loadBoard, loadBoardHandler);
  server.handle(loadItem, loadItemHandler);
  server.handle(loadComments, loadCommentsHandler);
  server.handle(loadImage, loadImageHandler);
  server.handle(saveLogin, saveLoginHandler);
  server.handle(takeLegacySettings, takeLegacySettingsHandler);
  server.handle(legacySettingsTaken, legacySettingsTakenHandler);
  server.handle(sendOptions, sendOptionsHandler);
  server.handle(sendToChat, sendToChatHandler);
  server.handle(launchDefaults, launchDefaultsHandler);
  server.handle(saveLaunchDefaults, saveLaunchDefaultsHandler);
  server.handle(listLabels, listLabelsHandler);
  server.handle(toggleLabel, toggleLabelHandler);
  server.handle(updateBranch, updateBranchHandler);

  // Storage lives on the host; registering the definitions is what makes the
  // client's `useSettings` reads and writes valid for this installation.
  server.registerSettings(displaySettings);
  server.registerSettings(promptSettings);

  // Every handler awaits its own gh subprocess, so there is nothing to release.
  return () => {};
}
