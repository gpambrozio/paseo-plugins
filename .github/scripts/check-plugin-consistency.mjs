#!/usr/bin/env node
/**
 * Checks the files inside one plugin folder that have to agree with each other, and that nothing
 * but a human keeps in step.
 *
 * There is no workspace root here, so there is no tool that sees a plugin whole: `tsc` reads the
 * TypeScript, `vitest` reads the tests, and the three files that declare *what this plugin is* —
 * `package.json`, `package-lock.json` and `CHANGELOG.md` — are checked by nobody. That is not
 * hypothetical. #32 hand-edited the SDK pins from `^0.9.0` to `0.9.0` and bumped five versions
 * without regenerating a single lockfile, and every gate in the repository stayed green: `tsc`
 * does not read a lockfile, and `npm ci` only asks whether the locked tree *satisfies*
 * `package.json`, which a resolved `0.9.0` does for an exact `0.9.0`. The drift reached `main` and
 * was found by hand afterwards.
 *
 * Run as `node .github/scripts/check-plugin-consistency.mjs <plugin-dir>...`. No dependencies, so
 * it runs before `npm ci` does and reports on every plugin rather than stopping at the first.
 */
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";

/** The blocks npm mirrors from `package.json` into the lockfile's root package entry. */
const DEPENDENCY_BLOCKS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Compares two dependency blocks by name and declared range. Order is not meaningful — npm writes
 * both sorted, but a hand edit need not — so this compares as a map rather than as text.
 */
function blockDifferences(name, fromPackage = {}, fromLock = {}) {
  const problems = [];
  for (const dep of new Set([...Object.keys(fromPackage), ...Object.keys(fromLock)])) {
    const declared = fromPackage[dep];
    const locked = fromLock[dep];
    if (declared === locked) continue;
    if (declared === undefined) {
      problems.push(`${name}.${dep} is in the lockfile (${locked}) but not in package.json`);
    } else if (locked === undefined) {
      problems.push(`${name}.${dep} is in package.json (${declared}) but not in the lockfile`);
    } else {
      problems.push(`${name}.${dep} is ${declared} in package.json but ${locked} in the lockfile`);
    }
  }
  return problems;
}

function checkPlugin(dir) {
  const plugin = basename(dir);
  const problems = [];

  const pkg = readJson(join(dir, "package.json"));
  const lock = readJson(join(dir, "package-lock.json"));
  const root = lock.packages?.[""] ?? {};

  // The version appears three times and npm writes all three. A hand-bumped `package.json` leaves
  // the other two behind, which is invisible until somebody reads a lockfile.
  if (lock.version !== pkg.version) {
    problems.push(`lockfile version is ${lock.version}, package.json says ${pkg.version}`);
  }
  if (root.version !== pkg.version) {
    problems.push(`lockfile packages[""].version is ${root.version}, package.json says ${pkg.version}`);
  }

  // The ranges, which is the drift #32 shipped: `npm install --save-dev` writes a caret, this repo
  // pins the SDK exactly, and editing only `package.json` leaves the caret in the lockfile.
  for (const block of DEPENDENCY_BLOCKS) {
    problems.push(...blockDifferences(block, pkg[block], root[block]));
  }

  // A release is a version to install, a tag to pin and an entry to read. The publish workflow
  // already refuses a missing changelog section — but only after the merge, where it is somebody's
  // problem rather than the pull request's.
  const changelog = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
  if (!changelog.includes(`## [${pkg.version}]`)) {
    problems.push(`CHANGELOG.md has no "## [${pkg.version}]" section for the declared version`);
  }

  return { plugin, problems };
}

const directories = process.argv.slice(2);
if (directories.length === 0) {
  console.error("usage: check-plugin-consistency.mjs <plugin-dir>...");
  process.exit(2);
}

let failed = false;
for (const dir of directories) {
  const { plugin, problems } = checkPlugin(dir);
  if (problems.length === 0) {
    console.log(`✓ ${plugin}`);
    continue;
  }
  failed = true;
  for (const problem of problems) {
    // Annotates the pull request's Files tab as well as the log.
    console.log(`::error file=${dir}/package.json,title=${plugin}::${problem}`);
  }
}

if (failed) {
  console.error(
    "\nRun `npm install` in the plugin folder to rewrite its lockfile, and add the changelog" +
      " section if the version moved.",
  );
  process.exit(1);
}
