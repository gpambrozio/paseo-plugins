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
