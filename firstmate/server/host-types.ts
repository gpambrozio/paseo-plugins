/**
 * Paseo's types, taken from the one package the host actually provides.
 *
 * A running plugin is given `@getpaseo/plugin`, not `@getpaseo/client` or
 * `@getpaseo/protocol` — those are devDependencies, and an npm install runs
 * `--omit=dev`. The daemon resolves every import reachable from an entry,
 * type imports included, and fails the install when one is missing. So every
 * Paseo type this plugin needs is projected out of `@getpaseo/plugin`, which
 * re-declares them structurally. Add to this file rather than reaching for the
 * upstream package; `server/host-imports.test.ts` fails if anything does.
 */
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

export type PaseoApi = PluginHandlerContext["paseo"];

export type PaseoAgent = Awaited<ReturnType<PaseoApi["agents"]["list"]>>["entries"][number]["agent"];

export type AgentListOptions = NonNullable<Parameters<PaseoApi["agents"]["list"]>[0]>;

export type TimelinePage = Awaited<
  ReturnType<ReturnType<PaseoApi["agents"]["ref"]>["timeline"]["refetch"]>
>;

export type TimelineItem = TimelinePage["entries"][number]["item"];
