#!/usr/bin/env node
/**
 * Fails a pull request that changes a plugin's `CHANGELOG.md` without changing its version.
 *
 * Merging a version bump is what releases a plugin here, so a changelog entry that merges without
 * one is a line nobody can install: `publish.yml` keys on a version with no tag, sees none, and
 * does nothing. #54 did exactly that — an entry under `[Unreleased]` in `skills/CHANGELOG.md`, no
 * bump — and needed a second pull request to ship it. The reverse, a bump with no changelog
 * change, is already caught by `check-plugin-consistency.mjs`, which wants a section for the
 * declared version.
 *
 * Only `package.json` is compared. The lockfile carries the version twice more, but the
 * consistency check already holds those to `package.json`, so checking them here would report the
 * same mistake twice.
 *
 * Run as `node .github/scripts/check-changelog-bump.mjs <base-commit> <plugin-dir>...` from the
 * repository root, with `<base-commit>` present in the local clone. The comparison is two-dot,
 * base against the working tree's `HEAD`, which on a pull request is the merge GitHub built — so
 * it sees what the pull request would change in the base, and nothing the base changed since. An
 * empty `<base-commit>` (a run that is not for a pull request) has nothing to compare and passes.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

/** `package.json`'s version at `base`, or `undefined` when the plugin did not exist there. */
function baseVersion(base, dir) {
  const path = `${dir}/package.json`;
  if (git("ls-tree", "--name-only", base, "--", path).trim() === "") return undefined;
  return JSON.parse(git("show", `${base}:${path}`)).version;
}

const [base, ...directories] = process.argv.slice(2);
if (base === undefined || directories.length === 0) {
  console.error("usage: check-changelog-bump.mjs <base-commit> <plugin-dir>...");
  process.exit(2);
}
if (base === "") {
  console.log("No base commit, so there is no pull request to compare. Nothing to check.");
  process.exit(0);
}

const changed = new Set(
  git("diff", "--name-only", base, "HEAD", "--", ...directories.map((dir) => `${dir}/CHANGELOG.md`))
    .split("\n")
    .filter(Boolean),
);

let failed = false;
for (const dir of directories) {
  const changelog = `${dir}/CHANGELOG.md`;
  if (!changed.has(changelog)) {
    console.log(`✓ ${dir}: CHANGELOG.md unchanged`);
    continue;
  }
  const before = baseVersion(base, dir);
  const after = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  if (before === undefined) {
    console.log(`✓ ${dir}: new plugin, first version ${after}`);
    continue;
  }
  if (before !== after) {
    console.log(`✓ ${dir}: CHANGELOG.md changed, version ${before} → ${after}`);
    continue;
  }
  failed = true;
  // Annotates the pull request's Files tab as well as the log.
  console.log(
    `::error file=${changelog},title=${dir}::${changelog} changed but ${dir}/package.json is` +
      ` still ${after}. Merging a version bump is what releases a plugin, so this entry would` +
      ` reach main and never be published.`,
  );
}

if (failed) {
  console.error(
    "\nBump the version in the plugin folder (`npm version <patch|minor|major> --no-git-tag-version`" +
      " keeps the lockfile in step) and move the entry under the new `## [x.y.z]` heading.",
  );
  process.exit(1);
}
