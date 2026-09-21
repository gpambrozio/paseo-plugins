/**
 * What the user picks, as a host settings document.
 *
 * Every value here is one the *app* reads — which providers to draw, how to
 * weight the relative-cost column, whether to hide models that cannot call
 * tools. The daemon reads none of them, which by the rule in the root AGENTS.md
 * is exactly what makes a settings document the right store rather than a file
 * under `$PASEO_HOME/plugins/model-pricing/`.
 *
 * "Which providers to refresh" is the same switch as "which providers to show",
 * because the surface passes the enabled ids into `pricing.load` and the daemon
 * fetches only the sources those need. A provider switched off is genuinely not
 * fetched; no daemon-side copy of this list has to exist.
 *
 * `scope: "host"` means one list per daemon, shared by every client connected
 * to it — the same table on the desktop app and on a phone.
 */
import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

import { PROVIDER_IDS } from "./providers";

/**
 * How much of the blended price is input, as a percentage string; the rest is
 * output. Kept as a string because it is picked from a list, the same way
 * herald keeps its speech rate.
 *
 * There is no single right answer, which is why it is a setting: an agent that
 * reads a large repository and writes a patch is mostly input, a chat that
 * drafts prose is mostly output, and the ranking genuinely reorders between the
 * two. 80 is the default because agent workloads skew heavily to input.
 */
export const INPUT_WEIGHTS = ["100", "80", "75", "50", "25", "0"] as const;
export type InputWeight = (typeof INPUT_WEIGHTS)[number];

export const displaySettings = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: z.object({
    /**
     * Provider ids to fetch and show. Defaults to all of them; the surface
     * ignores ids it does not recognise, so removing a provider from
     * `shared/providers.ts` does not need a settings migration.
     */
    providers: z.array(z.string()).default([...PROVIDER_IDS]),
    inputWeight: z.enum(INPUT_WEIGHTS).default("80"),
    /**
     * Hide models that cannot call tools. On by default: this table exists to
     * choose a model to run an agent on, and one that cannot call a tool
     * cannot run an agent.
     */
    toolCallOnly: z.boolean().default(true),
  }),
});

export type DisplaySettings = z.infer<typeof displaySettings.schema>;

export const DEFAULT_DISPLAY: DisplaySettings = {
  providers: [...PROVIDER_IDS],
  inputWeight: "80",
  toolCallOnly: true,
};

/** The input share of the blended price, as a fraction. Output takes the rest. */
export function inputShare(weight: InputWeight): number {
  return Number(weight) / 100;
}
