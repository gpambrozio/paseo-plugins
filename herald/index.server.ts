import { join } from "node:path";

import type { PluginServerContext } from "@getpaseo/plugin/server";

import { pluginDir, readHeraldConfig, writeHeraldConfig } from "./server/config";
import { registerHooks } from "./server/hooks";
import { listSayVoices, renderWithSay, sayAvailable } from "./server/say";
import { AttentionStore } from "./server/store";
import { summarize } from "./server/summarize";
import { listAttention, listSpeechVoices, readConfig, renderSpeech, writeConfig } from "./shared/herald";
import { speechSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const store = new AttentionStore(join(pluginDir(), "attention.json"));
  void store.load().catch((error: unknown) => {
    console.error("[herald] could not load saved entries:", error);
  });

  server.handle(listAttention, () => ({ entries: store.list() }));
  server.handle(readConfig, () => readHeraldConfig());
  server.handle(writeConfig, (config) => writeHeraldConfig(config));

  // The daemon Mac renders speech with `say`; the app plays the bytes. Not a
  // Mac, or no `say`: the client hears that and uses the browser's voice.
  server.handle(listSpeechVoices, async () => {
    const available = await sayAvailable();
    return { available, voices: available ? await listSayVoices() : [] };
  });
  server.handle(renderSpeech, async ({ text, voice, rate }) => {
    if (!(await sayAvailable())) throw new Error("The daemon is not a Mac, so `say` is not available.");
    return renderWithSay(text, { voice, rate });
  });

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
