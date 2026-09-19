/**
 * `PaseoApi` without importing `@getpaseo/client`.
 *
 * The host provides `@getpaseo/plugin` to a running plugin; it does not provide
 * `@getpaseo/client`. That distinction is invisible to a plugin installed from a
 * directory or from Git, where `npm install` has already put the whole SDK on
 * disk — but an npm install runs `--omit=dev`, so a devDependency is simply not
 * there, and the daemon's runtime-boundary plugin fails the build for any
 * *reachable* module that imports one. `server/sdk-types.ts` gets away with it
 * only because nothing imports it.
 *
 * So the type is taken from where it is already re-exported, through a context
 * the host hands every handler. Same type, no dependency.
 */
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

export type PaseoApi = PluginHandlerContext["paseo"];
