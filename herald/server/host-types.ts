/**
 * Paseo's types, taken from the one package the host actually provides.
 *
 * A running plugin is given `@getpaseo/plugin`. It is not given
 * `@getpaseo/client` or `@getpaseo/protocol`, which are devDependencies here —
 * and an npm install runs `--omit=dev`, so neither is on disk. The daemon's
 * runtime-boundary plugin resolves every import reachable from an entry, type
 * imports included, and fails the *install* when one is missing. A directory or
 * Git install never shows this, because `npm install` in the folder has put the
 * whole SDK there; `server/sdk-types.ts` gets away with importing
 * `@getpaseo/client` only because nothing imports *it*.
 *
 * So every Paseo type this plugin needs is projected out of `@getpaseo/plugin`,
 * which re-declares them structurally. Same types, no dependency. Add to this
 * file rather than reaching for the upstream package.
 */
import type {
  PluginHandlerContext,
  PluginLifecycleEvents,
} from "@getpaseo/plugin/server";

export type PaseoApi = PluginHandlerContext["paseo"];

/** One row of an agent's timeline, as `timeline.refetch` returns it. */
export type TimelineEntry = Awaited<
  ReturnType<ReturnType<PaseoApi["agents"]["ref"]>["timeline"]["refetch"]>
>["entries"][number];

// From the timeline page rather than `agent.turn_ended`, whose `timeline` field
// Paseo 0.17 removed.
export type AgentTimelineItem = TimelineEntry["item"];

export type AgentPermissionRequest =
  PluginLifecycleEvents["agent.permission_requested"]["request"];
