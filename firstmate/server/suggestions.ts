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
 */
import type { Suggestion } from "../shared/fleet";
import { withoutNotes } from "./templates";

/** More than this is a list nobody reads; the charter asks for about five. */
export const MAX_SUGGESTIONS = 8;

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

/** Every well-formed suggestion, in file order, the first `MAX_SUGGESTIONS` of them. */
export function parseSuggestions(markdown: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  for (const line of withoutNotes(markdown).split("\n")) {
    const suggestion = parseLine(line);
    if (suggestion !== null) suggestions.push(suggestion);
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return suggestions;
}

/**
 * `markdown` without the first line that reads as `target` — the same label and prompt, as the board
 * shows them — or null when no line does. Every other byte is kept: the header, the notes, the other
 * suggestions, the line endings. A line inside a note is never a match, since the board never showed
 * it. Of two identical lines only the first goes, as the board draws one card for each.
 */
export function withoutSuggestion(markdown: string, target: Suggestion): string | null {
  const notes = [...markdown.matchAll(/<!--[\s\S]*?-->/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const visible = (from: number, to: number): string => {
    let text = "";
    let at = from;
    for (const note of notes) {
      if (note.end <= at || note.start >= to) continue;
      text += markdown.slice(at, Math.max(at, note.start));
      at = Math.min(to, Math.max(at, note.end));
    }
    return text + markdown.slice(at, to);
  };

  const breaks = /\r\n?|\n/g;
  let start = 0;
  while (start <= markdown.length) {
    const found = breaks.exec(markdown);
    const end = found === null ? markdown.length : found.index;
    const next = found === null ? markdown.length : found.index + found[0].length;
    const suggestion = parseLine(visible(start, end));
    if (suggestion !== null && suggestion.label === target.label && suggestion.prompt === target.prompt) {
      return markdown.slice(0, start) + markdown.slice(next);
    }
    if (found === null) break;
    start = next;
  }
  return null;
}
