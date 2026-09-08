/**
 * A tripwire for the one hazard `skipLibCheck: true` hides.
 *
 * When `@getpaseo/client` fails to resolve, TypeScript does not complain: every
 * Paseo API type silently degrades to `any` and `tsc` still exits 0, so a clean
 * typecheck stops proving that any host call in this plugin is type-checked at
 * all. `noImplicitAny` catches part of it — but only where our code destructures
 * an SDK value. A handler that merely passes `paseo` through type-checks just as
 * happily against `any`.
 *
 * The directive below is the check, and it fails in both directions:
 *
 * - types resolved   → the indexed access errors → the directive is used → pass
 * - types degraded   → the access is `any`, no error → TS2578 "Unused
 *                      '@ts-expect-error' directive" → fail
 *
 * This replaces the throwaway file the root CLAUDE.md used to ask contributors
 * to write by hand. It is type-only, so it contributes nothing to either bundle.
 */
import type { PaseoAgentHandle } from "@getpaseo/client";

// @ts-expect-error - Must stay an error. See above: if this member ever stops
// erroring, the SDK types are `any` and nothing here is really being checked.
export type SdkTypesResolved = PaseoAgentHandle["thisMemberDoesNotExist"];
