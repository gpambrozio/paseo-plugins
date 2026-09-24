/**
 * The captain's copy of the charter, `data/charter.md`, which `AGENTS.md` is rendered from.
 *
 * It starts as the plugin's charter (`CHARTER_TEMPLATE`) under a note, and the note records a
 * fingerprint of the charter it was copied from. That is how a new plugin version tells two cases
 * apart:
 *
 * - **Untouched**: the text still matches its fingerprint. The captain never edited it, so it follows
 *   the plugin, and a changed plugin charter replaces it.
 * - **Edited**: it does not. The captain's text is kept and used. When the plugin's charter has moved
 *   on since the version the edit started from, the new one is written beside it as
 *   `data/charter.new.md` and the board says so; `acknowledgeCharter` moves the fingerprint on once the
 *   captain has taken what they want from it, and removes that file.
 *
 * An emptied or deleted copy goes back to the plugin's charter. A copy whose fingerprint is gone — the
 * note deleted — counts as edited and based on nothing, so any plugin charter is news to it.
 *
 * HTML comments are notes to the captain: they are left out of `AGENTS.md` and of the comparison.
 */
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CHARTER_PLACEHOLDERS, CHARTER_TEMPLATE } from "./charter";

export const CHARTER_FILE = "data/charter.md";
export const NEW_CHARTER_FILE = "data/charter.new.md";

/** Where in the note the fingerprint is, and its shape. */
const MARK = /firstmate-charter ([0-9a-f]{16})/;

/** The text a charter says, without its notes or incidental whitespace. */
function words(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").trim();
}

export function fingerprint(charter: string): string {
  return createHash("sha256").update(words(charter)).digest("hex").slice(0, 16);
}

function note(base: string): string {
  const placeholders = Object.entries(CHARTER_PLACEHOLDERS)
    .map(([name, meaning]) => `  {{${name}}}  ${meaning}`)
    .join("\n");
  return `<!--
The first mate's charter. The FirstMate plugin writes AGENTS.md from this file whenever it starts,
whenever a first mate is launched and whenever you save this file in the panel, so change the charter
here, not there. A running first mate reads it at its next session, or when you ask it to re-read
AGENTS.md. Notes like this one are left out.

Until you edit it, this file follows FirstMate: a new version of the plugin brings its new charter.
Once you have, your version is kept, and if the plugin's charter changes after that, the new one is
put beside this file as charter.new.md for you to compare. Empty this file to go back to the plugin's.

These are filled in when AGENTS.md is written:
${placeholders}

firstmate-charter ${base} (the plugin charter this started from; leave it as it is)
-->`;
}

function copyOf(plugin: string): string {
  return `${note(fingerprint(plugin))}\n\n${words(plugin)}\n`;
}

function newCopyOf(plugin: string): string {
  return `<!--
FirstMate's own charter as it is now, for comparing with data/charter.md, which you have edited. Take
what you want from it into charter.md, then press Done on the board's notice; to take all of it, empty
charter.md instead. The plugin rewrites this file while it is needed and removes it afterwards.
-->

${words(plugin)}
`;
}

export interface CharterState {
  /** What `AGENTS.md` is rendered from: the captain's copy, or the plugin's charter. */
  template: string;
  /** The captain has edited their copy. */
  edited: boolean;
  /** The captain has edited their copy, and the plugin's charter has changed since it started from it. */
  outdated: boolean;
}

/** What a copy means, given the plugin's current charter; `rewrite` when the copy should become it. */
export function assessCharter(copy: string | null, plugin: string): CharterState & { rewrite: boolean } {
  const text = copy === null ? "" : words(copy);
  if (text === "") return { template: words(plugin), edited: false, outdated: false, rewrite: true };
  const base = MARK.exec(copy ?? "")?.[1] ?? null;
  const current = fingerprint(plugin);
  if (base !== null && fingerprint(text) === base) {
    return base === current
      ? { template: text, edited: false, outdated: false, rewrite: false }
      : { template: words(plugin), edited: false, outdated: false, rewrite: true };
  }
  return { template: text, edited: true, outdated: base !== current, rewrite: false };
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The copy's state, touching nothing: what the board reads on every poll. */
export async function readCharterState(home: string, plugin: string = CHARTER_TEMPLATE): Promise<CharterState> {
  const { rewrite: _rewrite, ...state } = assessCharter(await readOptional(join(home, CHARTER_FILE)), plugin);
  return state;
}

/**
 * Brings the home's copy in step with the plugin's charter — writing it when missing, empty or untouched
 * and out of date, and `charter.new.md` beside an edited one that is out of date — and says what
 * `AGENTS.md` should be rendered from. The caller has created `data/`.
 */
export async function syncCharter(home: string, plugin: string = CHARTER_TEMPLATE): Promise<CharterState> {
  const path = join(home, CHARTER_FILE);
  const { rewrite, ...state } = assessCharter(await readOptional(path), plugin);
  if (rewrite) await writeFile(path, copyOf(plugin), "utf8");
  if (state.outdated) await writeFile(join(home, NEW_CHARTER_FILE), newCopyOf(plugin), "utf8");
  else await rm(join(home, NEW_CHARTER_FILE), { force: true });
  return state;
}

/** Writes `charter.new.md` for the captain to compare, when there is anything to compare. */
export async function writeNewCharter(home: string, plugin: string = CHARTER_TEMPLATE): Promise<boolean> {
  const state = await readCharterState(home, plugin);
  if (state.outdated) await writeFile(join(home, NEW_CHARTER_FILE), newCopyOf(plugin), "utf8");
  return state.outdated;
}

/**
 * The captain has taken what they want from the plugin's new charter: the copy is now based on it.
 * Moves the fingerprint on — restoring the note if it was deleted — keeps every word the captain wrote,
 * and removes `charter.new.md`.
 */
export async function acknowledgeCharter(home: string, plugin: string = CHARTER_TEMPLATE): Promise<void> {
  const path = join(home, CHARTER_FILE);
  const copy = await readOptional(path);
  const current = fingerprint(plugin);
  if (copy !== null && words(copy) !== "") {
    const next = MARK.test(copy)
      ? copy.replace(MARK, `firstmate-charter ${current}`)
      : `${note(current)}\n\n${copy.trimStart()}`;
    if (next !== copy) await writeFile(path, next, "utf8");
  }
  await rm(join(home, NEW_CHARTER_FILE), { force: true });
}
