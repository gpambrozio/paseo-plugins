import { join } from "node:path";

import type { PluginServerContext } from "@getpaseo/plugin/server";

import { pluginDir, readHeraldConfig, writeHeraldConfig } from "./server/config";
import { registerHooks } from "./server/hooks";
import { AttentionStore } from "./server/store";
import { summarize } from "./server/summarize";
import { listAttention, readConfig, writeConfig } from "./shared/herald";
import { speechSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const store = new AttentionStore(join(pluginDir(), "attention.json"));
  void store.load().catch((error: unknown) => {
    console.error("[herald] could not load saved entries:", error);
  });

  server.handle(listAttention, () => ({ entries: store.list() }));
  server.handle(readConfig, () => readHeraldConfig());
  server.handle(writeConfig, (config) => writeHeraldConfig(config));

  // Storage lives on the host; registering the definition is what makes the
  // client's `useSettings` reads and writes valid for this installation.
  server.registerSettings(speechSettings);

  const unregisterHooks = registerHooks(server, {
    store,
    readConfig: readHeraldConfig,
    summarize,
  });

  return async () => {
    unregisterHooks();
    await store.flush();
  };
}
