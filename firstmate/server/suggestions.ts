/**
 * The first mate's suggestions, `data/suggestions.md` in its home: what the
 * captain might want to do next, as buttons on the board.
 *
 * The first mate rewrites the file whenever the next steps change, and the
 * board reads it on every poll, so — like the backlog — the format is a
 * contract between an agent and a parser. One line per suggestion, a short
 * label and the words the button puts in the composer:
 *
 *     - Land web#42 :: Merge https://github.com/you/web/pull/42, captain's word.
 *     - Review loop on web#42 :: Run a review loop on https://github.com/you/web/pull/42 until it is clean.
 *
 * Lenient about everything else: HTML comments are notes, any line without a
 * label and a prompt on either side of `::` is skipped, the bullet is optional,
 * and a label wrapped in `**` or backticks is unwrapped. A missing or empty
 * file means no suggestions.
 *
 * What the captain takes off the board is remembered in
 * `data/suggestions-dismissed.md`, in the same shape with the day it went:
 *
 *     - Land web#42 :: Merge https://github.com/you/web/pull/42, captain's word. (dismissed 2026-10-07)
 *
 * and the board leaves out any suggestion whose prompt reads the same, so the
 * first mate rewriting its list from its records cannot bring one back. bb's
 * FirstMate keeps the same file in the same shape.
 */
import type { Suggestion } from "../shared/fleet";

/** More than this is a list nobody reads; the charter asks for about five. */
export const MAX_SUGGESTIONS = 8;

/** How many dismissals `data/suggestions-dismissed.md` keeps, the newest. */
export const MAX_DISMISSED = 50;

/** The day a dismissed line ends with, and whatever space is around it. */
const DISMISSED_ON = /\s*\(dismissed \d{4}-\d{2}-\d{2}\)\s*$/;

const SEPARATOR = "::";

function unwrap(label: string): string {
  return label.replace(/^(\*\*|__|`)(.*)\1$/, "$2").trim();
}

function parseLine(line: string): Suggestion | null {
  const body = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX]\]\s+/, "");
  const at = body.indexOf(SEPARATOR);
  if (at === -1) return null;
  const label = unwrap(body.slice(0, at).trim());
  const prompt = body.slice(at + SEPARATOR.length).trim();
  if (label === "" || prompt === "") return null;
  return { label, prompt };
}

/** A suggestion, and the characters of the file its line is made of — its line break included, its notes not. */
interface Found {
  suggestion: Suggestion;
  ranges: Array<{ start: number; end: number }>;
}

/**
 * Every well-formed suggestion in the file, in order, with where it came from. Notes are taken out of
 * the whole text first, so a note that starts on one line and ends on another joins what is either
 * side of it into one line, as the reader sees it; each visible character keeps its offset in the
 * file, so a suggestion can be removed without touching a note's bytes.
 */
function scan(markdown: string): Found[] {
  const pieces: string[] = [];
  const origin: number[] = [];
  let at = 0;
  const cut = (end: number): void => {
    pieces.push(markdown.slice(at, end));
    for (let index = at; index < end; index++) origin.push(index);
  };
  for (const note of markdown.matchAll(/<!--[\s\S]*?-->/g)) {
    cut(note.index);
    at = note.index + note[0].length;
  }
  cut(markdown.length);
  const visible = pieces.join("");

  const found: Found[] = [];
  const breaks = /\r\n?|\n/g;
  let start = 0;
  for (;;) {
    const lineBreak = breaks.exec(visible);
    const end = lineBreak === null ? visible.length : lineBreak.index;
    const next = lineBreak === null ? visible.length : end + lineBreak[0].length;
    const suggestion = parseLine(visible.slice(start, end));
    if (suggestion !== null) found.push({ suggestion, ranges: rangesOf(origin.slice(start, next)) });
    if (lineBreak === null) return found;
    start = next;
  }
}

/** Ascending offsets as runs of consecutive ones. */
function rangesOf(offsets: readonly number[]): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const offset of offsets) {
    const last = ranges[ranges.length - 1];
    if (last !== undefined && last.end === offset) last.end = offset + 1;
    else ranges.push({ start: offset, end: offset + 1 });
  }
  return ranges;
}

/**
 * Every well-formed suggestion, in file order, the first `MAX_SUGGESTIONS` of them — leaving out those
 * whose prompt is in `dismissed` (`parseDismissed`) before counting, so a hidden one takes no place.
 */
export function parseSuggestions(markdown: string, dismissed: ReadonlySet<string> = new Set()): Suggestion[] {
  return scan(markdown)
    .map((found) => found.suggestion)
    .filter((suggestion) => !dismissed.has(promptKey(suggestion.prompt)))
    .slice(0, MAX_SUGGESTIONS);
}

/** A prompt as dismissals compare it: runs of whitespace as one space, none at either end. */
export function promptKey(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

/** Each dismissed line, its prompt without the day it was dismissed. */
function scanDismissed(markdown: string): Array<Found & { key: string }> {
  return scan(markdown)
    .map((found) => ({ ...found, key: promptKey(found.suggestion.prompt.replace(DISMISSED_ON, "")) }))
    .filter((found) => found.key !== "");
}

/** The prompts `data/suggestions-dismissed.md` records, as `promptKey` writes them. */
export function parseDismissed(markdown: string): Set<string> {
  return new Set(scanDismissed(markdown).map((found) => found.key));
}

/** `YYYY-MM-DD`, in the daemon's local time. */
function day(at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * `markdown` — the dismissed file — with `target` added as its newest line, dismissed on `at`. An older
 * line with the same prompt goes, so a suggestion is listed once, by its latest dismissal, and past
 * `MAX_DISMISSED` lines the oldest go too. Only those lines' own characters and line breaks are taken
 * out, as `withoutSuggestion` does, so the file's heading and notes stay as they were.
 */
export function withDismissal(markdown: string, target: Suggestion, at: Date): string {
  const key = promptKey(target.prompt);
  // A `::` in the label would move where the line splits, and the prompt read back with it.
  const label = promptKey(target.label).replaceAll(SEPARATOR, ":");
  if (key === "" || label === "") return markdown;
  const line = `- ${label} ${SEPARATOR} ${key} (dismissed ${day(at)})`;
  const joined = `${markdown}${markdown === "" || /[\r\n]$/.test(markdown) ? "" : "\n"}${line}\n`;

  const all = scanDismissed(joined);
  // Read back as anything but the line just written — a stray `-->` in the file, say — trim nothing.
  if (all[all.length - 1]?.key !== key) return joined;
  const older = all.slice(0, -1);
  const others = older.filter((found) => found.key !== key);
  const overflow = Math.max(0, others.length + 1 - MAX_DISMISSED);
  const going = new Set([...older.filter((found) => found.key === key), ...others.slice(0, overflow)]);
  return without(joined, older.filter((found) => going.has(found)).flatMap((found) => found.ranges));
}

/** `markdown` without the characters in `ranges`, which are in ascending order and do not overlap. */
function without(markdown: string, ranges: ReadonlyArray<{ start: number; end: number }>): string {
  let next = "";
  let at = 0;
  for (const range of ranges) {
    next += markdown.slice(at, range.start);
    at = range.end;
  }
  return next + markdown.slice(at);
}

function same(a: Suggestion, b: Suggestion): boolean {
  return a.label === b.label && a.prompt === b.prompt;
}

/**
 * `markdown` without the first suggestion that reads as `target` — the same label and prompt, as the
 * board shows them — or null when none does. Only that suggestion's own characters and its line break
 * go: a note on its line, or one it shares with the lines around it, is kept whole, delimiters and all,
 * so nothing it hides comes into view. Of two identical suggestions only the first goes, as the board
 * draws one card for each.
 *
 * Throws, writing nothing, in the case this cannot be sure of: when what is left would read as more
 * than the list without that one suggestion — the characters either side of it forming a note's
 * delimiter, say.
 */
export function withoutSuggestion(markdown: string, target: Suggestion): string | null {
  const all = scan(markdown);
  const index = all.findIndex((found) => same(found.suggestion, target));
  const match = all[index];
  if (match === undefined) return null;

  const next = without(markdown, match.ranges);
  const expected = all.filter((_, other) => other !== index).map((found) => found.suggestion);
  const left = scan(next).map((found) => found.suggestion);
  if (left.length !== expected.length || left.some((suggestion, other) => !same(suggestion, expected[other]!))) {
    throw new Error("That suggestion could not be taken out cleanly; edit data/suggestions.md in Files instead.");
  }
  return next;
}
