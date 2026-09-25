/**
 * Wiring: one RPC, one settings document, one cache to flush on the way out.
 *
 * The handler is built around a `PricingCache` rather than reaching for one,
 * so the tests construct it with `null` and get the same handler with no disk
 * behind it.
 */
import type { PluginServerContext } from "@getpaseo/plugin/server";

import { PricingCache } from "./server/cache";
import { migrateLegacyData, pluginDir } from "./server/data-dir";
import { createPricingHandler } from "./server/pricing";
import { loadPricing } from "./shared/pricing";
import { SOURCE_IDS } from "./shared/providers";
import { displaySettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  migrateLegacyData(SOURCE_IDS.map((source) => `${source}.json`));
  const cache = new PricingCache(pluginDir());

  server.handle(loadPricing, createPricingHandler(cache));

  // Storage lives on the host; registering the definition is what makes the
  // client's `useSettings` reads and writes valid for this installation. There
  // is no server-side read API, which is fine here — the surface sends the
  // providers it wants with every call.
  server.registerSettings(displaySettings);

  return async () => {
    await cache.flush();
  };
}
