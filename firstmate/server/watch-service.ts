/**
 * The watch runner wired to Paseo: which home it runs in, which watches are off, and how what they
 * print reaches the first mate.
 *
 * **The server half has no Paseo handle of its own.** The plugin API hands one to an RPC handler and
 * to a lifecycle hook, and nothing else — but it is the same object every time, one per plugin
 * process, so the first one seen is kept (`remember`) and used by the timer. Every RPC here and every
 * turn any agent starts or ends passes it on. Until one has, after a plugin start, watches still run
 * and what they print waits in the queue; the board opening, or any agent's turn, releases it.
 *
 * Delivery waits while the first mate is mid-turn, asking Paseo afresh before every send. The end of
 * its turn (`agent.turn_ended`) tries the queue a few times over the next seconds
 * (`WatchRunner.flushAfterTurn`), and every minute's tick tries again, so a turn whose end the plugin
 * missed delays a note by a minute at most.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { PluginLifecycleRegistration } from "@getpaseo/plugin/server";

import { WATCH_MESSAGE_ID_PREFIX, type FirstmateConfig } from "../shared/fleet";
import { resolveHome, updateFirstmateConfig } from "./config";
import { pluginDir } from "./data-dir";
import { resolveMate } from "./fleet";
import { isHomeReady } from "./home";
import type { PaseoApi } from "./host-types";
import { isMidTurn } from "./mate";
import { sendWithoutInterrupting } from "./send";
import { serialized } from "./serialize";
import { WatchRunner, type DeliveryOutcome } from "./watches";

/**
 * Sends to the first mate only when Paseo says it is not mid-turn, asked afresh every time, under a
 * watch message id so the chat can tell it from the captain's words.
 */
export async function deliverToMate(paseo: PaseoApi | null, config: FirstmateConfig, text: string): Promise<DeliveryOutcome> {
  if (paseo === null) return "wait";
  const { agent } = await resolveMate(paseo, config);
  if (agent === null) return "wait";
  if (isMidTurn(agent)) return "wait";
  await sendWithoutInterrupting(paseo, agent.id, text, { messageId: `${WATCH_MESSAGE_ID_PREFIX}${randomUUID()}` });
  return "sent";
}

export interface WatchService {
  runner: WatchRunner;
  /** Keeps the plugin's Paseo handle for the timer; see the module note. */
  remember: (paseo: PaseoApi) => void;
  /** Switches a watch off or on. */
  toggle: (name: string, enabled: boolean) => Promise<void>;
  stop: () => void;
}

export function startWatches(
  server: PluginLifecycleRegistration,
  readConfig: () => Promise<FirstmateConfig>,
): WatchService {
  let paseo: PaseoApi | null = null;
  const remember = (handle: PaseoApi) => {
    paseo = handle;
  };

  const runner = new WatchRunner({
    async home() {
      const home = resolveHome(await readConfig());
      return (await isHomeReady(home)) ? home : null;
    },
    async disabled() {
      return (await readConfig()).disabledWatches;
    },
    async deliver(text) {
      return deliverToMate(paseo, await readConfig(), text);
    },
    stateFile: join(pluginDir(), "watches.json"),
    scriptStateRoot: join(pluginDir(), "watch-state"),
  });

  const offStarted = server.on("agent.turn_started", (_event, context) => remember(context.paseo));
  const offEnded = server.on("agent.turn_ended", async (event, context) => {
    remember(context.paseo);
    const config = await readConfig();
    if (event.agent.id === config.mateAgentId.trim()) runner.flushAfterTurn();
  });
  const stopTimer = runner.start();

  return {
    runner,
    remember,
    toggle(name, enabled) {
      // Read and written as one step, so two quick toggles cannot undo each other.
      return serialized("firstmate.watch.toggle", async () => {
        const off = new Set((await readConfig()).disabledWatches);
        if (enabled) off.delete(name);
        else off.add(name);
        await updateFirstmateConfig({ disabledWatches: [...off].sort() });
      });
    },
    stop() {
      stopTimer();
      offStarted();
      offEnded();
    },
  };
}
