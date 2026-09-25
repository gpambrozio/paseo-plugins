import { join } from "node:path";

import type { PluginServerContext } from "@getpaseo/plugin/server";

import { sweepHelpers } from "./server/cleanup";
import { readHeraldConfig, writeHeraldConfig } from "./server/config";
import { migrateLegacyData, pluginDir } from "./server/data-dir";
import { registerHooks } from "./server/hooks";
import { Liveness } from "./server/liveness";
import { listSayVoices, renderWithSay, sayAvailable } from "./server/say";
import { AttentionStore } from "./server/store";
import { summarize } from "./server/summarize";
import { listAttention, listSpeechVoices, readConfig, renderSpeech, writeConfig } from "./shared/herald";
import { speechSettings } from "./shared/settings";

/**
 * How long after load the leftover summary helpers are swept.
 *
 * This plugin is loaded *by* the daemon, and the sweep talks to that daemon
 * through the `paseo` CLI, which needs it to be listening. A sweep that ran the
 * moment this module was evaluated would meet a daemon still starting and give
 * up for the life of the process, so it waits.
 */
const SWEEP_DELAY_MS = 30_000;

export default function contribute(server: PluginServerContext) {
  migrateLegacyData(["config.json", "attention.json"]);
  const store = new AttentionStore(join(pluginDir(), "attention.json"));
  // Not awaited, because a contribution registers its handlers synchronously —
  // it returns a cleanup, not a promise. Events therefore arrive *during* this
  // read, so the store merges rather than overwrites: see `touched` there.
  void store.load().catch((error: unknown) => {
    console.error("[herald] could not load saved entries:", error);
  });

  // Hooks hear an agent move on; they do not hear a session close. The list
  // asks the daemon about each entry's agent before handing it out.
  const liveness = new Liveness();
  server.handle(listAttention, async (_input, { paseo }) => ({ entries: await liveness.visible(store, paseo) }));
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

  // Shared with the sweep below, which must not delete a helper still writing.
  const liveHelpers = new Set<string>();
  const unregisterHooks = registerHooks(server, {
    store,
    readConfig: readHeraldConfig,
    summarize,
    liveHelpers,
  });

  // Each helper is deleted as its summary lands. This is for the ones no id
  // survived for: everything from before the plugin did that, and whatever a
  // reload or a stopped daemon orphaned mid-summary.
  const sweep = setTimeout(() => {
    void readHeraldConfig()
      .then(async (config) => {
        if (!config.cleanup.deleteHelpers) return;
        const { deleted, failed } = await sweepHelpers({ keep: liveHelpers });
        if (deleted > 0 || failed > 0) {
          console.log(`[herald] deleted ${deleted} leftover summary helpers, ${failed} failed`);
        }
      })
      .catch((error: unknown) => {
        console.error("[herald] could not delete leftover summary helpers:", error);
      });
  }, SWEEP_DELAY_MS);
  sweep.unref();

  return async () => {
    clearTimeout(sweep);
    unregisterHooks();
    await store.flush();
  };
}
