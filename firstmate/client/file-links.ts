/**
 * A first mate's reply, inline: bold, code, links — and the files in its home
 * it names, which the chat links to the Files view. Pure, so what is found
 * and what is drawn are the same walk and can be tested without a renderer.
 *
 * Finding a path is only half of it: whether `data/backlog.md` is a file in
 * the home is the daemon's to say (`firstmate.files.find`), so the chat first
 * collects every candidate a message could link (`fileCandidates`), asks, and
 * then tokenizes again with the answer (`inlineTokens`). Anything the daemon
 * does not vouch for — outside the home, missing, a folder — stays text.
 */

/** Bold, inline code and links, in one pass; everything else stays as written. */
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]*\]\([^)\s]+\)|https?:\/\/[^\s)<>]+)/g;

/** A run of plain text that could be a path: whatever brackets, quotes, commas and spaces leave. A source only; each walk makes its own. */
const WORD = /[^\s()[\]{}<>"'`,;]+/g;
/** Sentence punctuation after a path, which is not part of it. */
const TRAILING_PUNCTUATION = /[.:!?]+$/;
/** `:12` or `:12:4` after a path — a line, which the Files view cannot go to, so it is linked but not looked up. */
const LINE_SUFFIX = /(?::\d+){1,2}$/;
/** A URL scheme, as in a Markdown link's target: not a file. */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; url: string }
  /** A file in the home; `code` when it was written as inline code, which keeps that look. */
  | { kind: "file"; text: string; path: string; code: boolean };

/** Home-relative path of the file a candidate names, or null when it names none. */
export type FileLookup = (candidate: string) => string | null;

/**
 * The path `text` would name, without a trailing line number, or null when it
 * does not look like one: a path has a `/` in it or ends in an extension, so
 * `data/scout-x/report.md`, `watches/pr-watch` and `AGENTS.md` are, and
 * `backlog` is not.
 */
export function pathCandidate(text: string): string | null {
  const path = text.replace(LINE_SUFFIX, "");
  if (path === "" || /\s/.test(path) || (SCHEME.test(path) && !path.startsWith("/"))) return null;
  if (path.includes("/")) return /[\w-]/.test(path) ? path : null;
  return /^[\w.@+-]*\w\.[a-zA-Z0-9]{1,10}$/.test(path) ? path : null;
}

/** Plain text split into what stays text and the files in it that `lookup` knows. */
function plainTokens(text: string, lookup: FileLookup): InlineToken[] {
  const tokens: InlineToken[] = [];
  let pending = "";
  let at = 0;
  const words = new RegExp(WORD.source, "g");
  let match: RegExpExecArray | null;
  while ((match = words.exec(text)) !== null) {
    const start = match.index;
    const word = match[0].replace(TRAILING_PUNCTUATION, "");
    const candidate = pathCandidate(word);
    const path = candidate === null ? null : lookup(candidate);
    if (path === null) continue;
    pending += text.slice(at, start);
    if (pending !== "") tokens.push({ kind: "text", text: pending });
    tokens.push({ kind: "file", text: word, path, code: false });
    pending = "";
    at = start + word.length;
  }
  pending += text.slice(at);
  if (pending !== "") tokens.push({ kind: "text", text: pending });
  return tokens;
}

/**
 * One line of Markdown as tokens. Bold is left alone; inline code, a
 * Markdown link's target and plain text are checked for files. A plain URL's
 * trailing punctuation is dropped from what it opens, not from what it shows.
 */
export function inlineTokens(text: string, lookup: FileLookup): InlineToken[] {
  // Splitting on a capturing group interleaves plain text (even indexes) with the tokens it matched.
  return text.split(INLINE).flatMap((part, index): InlineToken[] => {
    if (part === "") return [];
    if (index % 2 === 0) return plainTokens(part, lookup);
    if (part.startsWith("`")) {
      const code = part.slice(1, -1);
      const candidate = pathCandidate(code.trim());
      const path = candidate === null ? null : lookup(candidate);
      return [path === null ? { kind: "code", text: code } : { kind: "file", text: code, path, code: true }];
    }
    if (part.startsWith("**") || part.startsWith("__")) return [{ kind: "bold", text: part.slice(2, -2) }];
    const link = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(part);
    if (link !== null) {
      const target = link[2] ?? "";
      const candidate = pathCandidate(target);
      const path = candidate === null ? null : lookup(candidate);
      const label = link[1] === "" ? target : (link[1] ?? target);
      if (path !== null) return [{ kind: "file", text: label, path, code: false }];
    }
    const url = (link?.[2] ?? part).replace(/[.,;:]+$/, "");
    const label = link === null ? part : link[1] === "" ? url : (link[1] ?? url);
    return [{ kind: "link", text: label, url }];
  });
}

/** Every path `source` could link, in order of first mention, each once — what to ask the daemon about. */
export function fileCandidates(source: string): string[] {
  const seen = new Set<string>();
  const collect: FileLookup = (candidate) => {
    seen.add(candidate);
    return null;
  };
  for (const line of source.split("\n")) inlineTokens(line, collect);
  return [...seen];
}

/** A lookup over the daemon's answer. */
export function lookupIn(files: Readonly<Record<string, string>>): FileLookup {
  return (candidate) => (Object.prototype.hasOwnProperty.call(files, candidate) ? (files[candidate] ?? null) : null);
}
