#!/usr/bin/env node
/**
 * Fails on any Lucide icon name a plugin's client code uses that Paseo's icon set does not have.
 *
 * Paseo resolves a string icon by looking the name up in its own `lucide-react-native`, and
 * nothing here can see that set: the SDK types every icon as a bare `string`, so `tsc` accepts any
 * name, and no test renders a contribution. Paseo 0.15 rejects an unknown name when the
 * contribution registers, and the plugin fails to load — which is how `github-board` 0.10.2 broke
 * (#111): Lucide dropped its brand icons, and `"Github"` went with them. A `<Icon name>` with an
 * unknown name does not fail; it silently draws nothing.
 *
 * So this reads the names straight out of the `lucide-react-native` Paseo's app ships, at
 * `LUCIDE_VERSION`, and compares every string literal the client code passes as an icon:
 *
 * - the value of an `icon:` property or an `icon=` / `name=` JSX attribute, including both arms
 *   of a ternary there (`name=` is how the host `Icon` takes one);
 * - a constant whose name ends in `_ICON`, and the values of an object literal assigned to one
 *   ending in `_ICONS`.
 *
 * An icon built any other way is not seen. Keep to those shapes, or extend this.
 *
 * Run as `node .github/scripts/check-lucide-icons.mjs <plugin-dir>...`. No dependencies; it
 * fetches the Lucide package with `npm pack`, so it needs the registry and nothing else.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

/**
 * The `lucide-react-native` in Paseo's app — `packages/app/node_modules/lucide-react-native` in
 * Paseo's `package-lock.json`. It has been 1.50.0 from 0.11.0 through 0.15.3. When Paseo moves it,
 * move this, and check what the new set renamed or dropped.
 */
const LUCIDE_VERSION = "1.50.0";

/** Every name `Reflect.get` on the module resolves to an icon component: icons and their aliases. */
function lucideNames() {
  const dir = mkdtempSync(join(tmpdir(), "lucide-"));
  try {
    const tarball = execFileSync(
      "npm",
      ["pack", `lucide-react-native@${LUCIDE_VERSION}`, "--silent", "--pack-destination", dir],
      { encoding: "utf8" },
    ).trim();
    const types = "package/dist/types/lucide-react-native.d.ts";
    execFileSync("tar", ["-xzf", join(dir, tarball), "-C", dir, types]);
    const source = readFileSync(join(dir, types), "utf8");

    const icons = new Set([...source.matchAll(/declare const (\w+): LucideIcon;/g)].map((m) => m[1]));
    const names = new Set(icons);
    for (const [, from, to] of source.matchAll(/\b(\w+) as (\w+)\b/g)) {
      if (icons.has(from)) names.add(to);
    }
    if (icons.size < 1000) {
      throw new Error(`read only ${icons.size} icons from lucide-react-native ${LUCIDE_VERSION}`);
    }
    return names;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The plugin's client entry and every non-test source under `client/` and `shared/`. */
function clientSources(plugin) {
  const files = [join(plugin, "index.client.tsx")].filter((file) => exists(file));
  const walk = (dir) => {
    if (!exists(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path);
    }
  };
  walk(join(plugin, "client"));
  walk(join(plugin, "shared"));
  return files;
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** A Lucide name is PascalCase. Anything else in an icon slot is not ours to judge here. */
const ICON_LITERAL = /["'`]([A-Z][A-Za-z0-9]*)["'`]/g;

/**
 * `icon: <expr>`, `icon=<expr>`, `name=<expr>` and `FOO_ICON = <expr>` — never `===`, which
 * compares rather than assigns. The expression is one of: a braced JSX expression without nested
 * braces, a lone string literal, or anything up to `,` `;` `}` or the end of the line. The first
 * two stop where the attribute does, so a `label="Cancel"` after it on the same line is not read.
 */
const ICON_SLOT =
  /(?:\bicon\s*(?::|=(?!=))|\bname\s*=(?!=)|\b[A-Z0-9_]*_ICON\s*(?::[^=\n]*)?=(?!=))\s*(?:\{([^{}\n]*)\}|(["'`][^"'`\n]*["'`])|([^,;}\n]*))/dg;

/** `FOO_ICONS = { key: "Name", … }`, typed or not. */
const ICON_MAP = /\b[A-Z0-9_]*_ICONS\s*(?::[^=\n]*)?=\s*\{([^}]*)\}/dg;

function iconUses(source) {
  const uses = [];
  const collect = (match) => {
    const group = match.findIndex((value, i) => i > 0 && value !== undefined);
    if (group === -1) return;
    const offset = match.indices[group][0];
    for (const literal of match[group].matchAll(ICON_LITERAL)) {
      uses.push({ name: literal[1], index: offset + literal.index });
    }
  };
  for (const slot of source.matchAll(ICON_SLOT)) collect(slot);
  for (const map of source.matchAll(ICON_MAP)) collect(map);
  return uses;
}

const directories = process.argv.slice(2);
if (directories.length === 0) {
  console.error("usage: check-lucide-icons.mjs <plugin-dir>...");
  process.exit(2);
}

const names = lucideNames();
let failed = false;
for (const dir of directories) {
  const plugin = basename(dir);
  const unknown = [];
  let seen = 0;
  for (const file of clientSources(dir)) {
    const source = readFileSync(file, "utf8");
    for (const { name, index } of iconUses(source)) {
      seen += 1;
      if (names.has(name)) continue;
      const line = source.slice(0, index).split("\n").length;
      unknown.push({ file: relative(".", file), line, name });
    }
  }
  if (unknown.length === 0) {
    console.log(`✓ ${plugin} (${seen} icon names)`);
    continue;
  }
  failed = true;
  for (const { file, line, name } of unknown) {
    // Annotates the pull request's Files tab as well as the log.
    console.log(
      `::error file=${file},line=${line},title=${plugin}::"${name}" is not a Lucide icon in` +
        ` lucide-react-native ${LUCIDE_VERSION}, which Paseo draws icons from`,
    );
  }
}

if (failed) {
  console.error(
    "\nPick a name from https://lucide.dev/icons. Lucide has no brand icons; pass inline SVG" +
      " (`{ svg }`, Paseo 0.13 and newer) for a logo.",
  );
  process.exit(1);
}
