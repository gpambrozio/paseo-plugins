/**
 * The check that used to need a publish to fail.
 *
 * The daemon compiles this plugin from whatever is on disk and resolves every
 * import reachable from an entry — type-only imports included — failing the
 * *install* when one is missing: `Could not resolve type dependency`. What is on
 * disk depends on how the plugin was installed:
 *
 * - from a directory or Git, `npm install` has already put every devDependency
 *   there, so anything resolves and nothing is wrong;
 * - from npm, the daemon runs `--omit=dev`, so a devDependency is simply absent.
 *
 * That gap is invisible to `tsc`, to the tests, and to `npm pack`, all of which
 * run in the folder where the devDependencies exist. `herald` shipped three
 * broken releases through it before anyone installed one.
 *
 * So this walks the import graph from the entry points and insists that every
 * module crossing it is one the host injects, a Node builtin, or a real runtime
 * `dependency` — the three things an npm install actually leaves behind.
 * Unreachable files are deliberately not checked: `server/sdk-types.ts` imports
 * `@getpaseo/client` on purpose, and is fine precisely because nothing imports
 * it.
 *
 * The scanning is done by hand. `typescript` is the CLI-only 7.x build with no
 * compiler API, and esbuild — which is what the daemon actually uses — is not a
 * dependency of anything here. Stripping comments and reading the specifier off
 * `from` / `import` / `require` covers every import form these plugins use; it
 * would miss a specifier built at runtime, which is not a thing a plugin can do
 * anyway, since the daemon has to resolve it statically.
 *
 * This file is duplicated in every plugin here. There is no workspace root to
 * share it from, and a published dev package would be a heavier dependency than
 * the duplication it saves.
 */
import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Both runtimes, both spellings. A plugin needs at least one. */
const ENTRY_POINTS = [
  "index.server.ts",
  "index.server.tsx",
  "index.client.ts",
  "index.client.tsx",
];

/** What the host injects. See "Plugin architecture" in the root AGENTS.md. */
const HOST_MODULES = new Set([
  "react",
  "react-native",
  "@tanstack/react-query",
  "zod",
]);

function isHostModule(specifier: string): boolean {
  return (
    HOST_MODULES.has(specifier) ||
    specifier === "@getpaseo/plugin" ||
    specifier.startsWith("@getpaseo/plugin/")
  );
}

/** `@scope/name/deep` → `@scope/name`; `name/deep` → `name`. */
function packageName(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? specifier);
}

function runtimeDependencies(): Set<string> {
  const manifest = JSON.parse(
    readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  return new Set(Object.keys(manifest.dependencies ?? {}));
}

/**
 * Blanks out comments and the insides of strings, keeping the source's length
 * and line structure. A specifier mentioned in prose can then never be mistaken
 * for an import, and the quotes that survive are only the ones delimiting real
 * code.
 */
export function blankCommentsAndStrings(source: string): string {
  const out = source.split("");
  let index = 0;
  const blankUntil = (end: number) => {
    while (index < end && index < out.length) {
      if (out[index] !== "\n") out[index] = " ";
      index += 1;
    }
  };
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (two === "//") {
      const end = source.indexOf("\n", index);
      blankUntil(end === -1 ? source.length : end);
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", index + 2);
      blankUntil(end === -1 ? source.length : end + 2);
      continue;
    }
    const quote = source[index];
    if (quote === '"' || quote === "'" || quote === "`") {
      // Keep the delimiters, blank the contents, so `from "x"` still parses but
      // the text inside any other string cannot look like one.
      index += 1;
      while (index < source.length) {
        const char = source[index];
        if (char === "\\") {
          blankUntil(index + 2);
          continue;
        }
        if (char === quote) {
          index += 1;
          break;
        }
        if (char !== "\n") out[index] = " ";
        index += 1;
      }
      continue;
    }
    index += 1;
  }
  return out.join("");
}

/**
 * Specifiers are read off the blanked copy but sliced out of the original, so
 * the positions line up and the real text comes back.
 */
function importedSpecifiers(source: string): string[] {
  const blanked = blankCommentsAndStrings(source);
  const patterns = [
    /\bfrom\s*(["'])([\s\S]*?)\1/g, // import … from "x" / export … from "x"
    /\bimport\s*(["'])([\s\S]*?)\1/g, // import "x"
    /\bimport\s*\(\s*(["'])([\s\S]*?)\1/g, // import("x")
    /\brequire\s*\(\s*(["'])([\s\S]*?)\1/g, // require("x")
  ];
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of blanked.matchAll(pattern)) {
      const whole = match[0];
      const quote = match[1];
      const blankedSpecifier = match[2];
      if (quote === undefined || blankedSpecifier === undefined) continue;
      const start = match.index + whole.indexOf(quote) + 1;
      found.add(source.slice(start, start + blankedSpecifier.length));
    }
  }
  return [...found];
}

/** Relative imports are extensionless here, so only those forms are tried. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

type Crossing = { file: string; specifier: string };

function walkFromEntries() {
  const entries = ENTRY_POINTS.map((name) => join(PLUGIN_ROOT, name)).filter(
    (path) => existsSync(path),
  );
  const reached = new Set<string>();
  const pending = [...entries];
  const external: Crossing[] = [];
  const unresolved: Crossing[] = [];

  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || reached.has(file)) continue;
    reached.add(file);
    for (const specifier of importedSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        const target = resolveRelative(file, specifier);
        if (target === null) unresolved.push({ file, specifier });
        else pending.push(target);
        continue;
      }
      external.push({ file, specifier });
    }
  }

  return { entries, reached, external, unresolved };
}

const describeCrossing = ({ file, specifier }: Crossing) =>
  `${relative(PLUGIN_ROOT, file)} → ${specifier}`;

describe("imports reachable from the entry points", () => {
  const { entries, external, unresolved } = walkFromEntries();
  const dependencies = runtimeDependencies();

  it("has at least one entry point to walk from", () => {
    expect(entries).not.toHaveLength(0);
  });

  it("resolves every relative import", () => {
    expect(unresolved.map(describeCrossing)).toEqual([]);
  });

  it("only leaves the plugin for a module an npm install provides", () => {
    const missing = external.filter(
      ({ specifier }) =>
        !isBuiltin(specifier) &&
        !isHostModule(specifier) &&
        !dependencies.has(packageName(specifier)),
    );
    expect(missing.map(describeCrossing)).toEqual([]);
  });
});

describe("blankCommentsAndStrings", () => {
  it("keeps an import specifier readable", () => {
    const source = 'import x from "./real";';
    expect(importedSpecifiers(source)).toEqual(["./real"]);
  });

  it("ignores a specifier that is only mentioned in a comment", () => {
    const source = '// see import y from "@getpaseo/client" for why\nconst a = 1;';
    expect(importedSpecifiers(source)).toEqual([]);
  });

  it("ignores a specifier inside an ordinary string", () => {
    const source = 'const message = "import z from \'@getpaseo/protocol\'";';
    expect(importedSpecifiers(source)).toEqual([]);
  });

  it("reads type-only imports, which are the ones that broke herald", () => {
    const source = 'import type { A } from "@getpaseo/protocol/agent-types";';
    expect(importedSpecifiers(source)).toEqual(["@getpaseo/protocol/agent-types"]);
  });
});
