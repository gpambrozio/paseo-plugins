/**
 * Rewrites the HTML a GitHub body may carry into the Markdown the renderer
 * already reads.
 *
 * Bots write HTML where Markdown has no equivalent or would be ambiguous:
 * Dependabot wraps every release-notes section in `<details>`, quotes the
 * upstream changelog as `<blockquote><h2>…<ul><li>…`, and links with
 * `<a href><code>@login</code></a>`; a human pastes `<img>` for a resized
 * screenshot or `<br>` for a hard break. GitHub renders both syntaxes into the
 * same page. There is no HTML library reachable from a client bundle, so this
 * walks the tags in order with a small stack and emits the Markdown spelling
 * of each — a heading line, a list marker with the depth's indent, a `> `
 * prefix on every line inside a quote, `[label](href)` around a link.
 *
 * `<details>` and `<summary>` are the exception: Markdown has no spelling for
 * them, so they are emitted back as tags on their own lines, normalised for
 * the parser to pick up as a block.
 *
 * Fenced code and inline code spans pass through untouched, because a tag in
 * them is the text the author meant to show. Only tags GitHub itself allows
 * are recognised, so `<dependency name>` in prose stays as written.
 */

/** HTML GitHub keeps when it sanitises a body; anything else stays text. */
const KNOWN_TAGS = new Set([
  "a", "abbr", "b", "bdo", "blockquote", "br", "caption", "center", "cite", "code", "dd",
  "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "picture", "pre",
  "q", "s", "samp", "section", "small", "source", "span", "strike", "strong", "sub", "summary",
  "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul", "var",
  "video",
]);

/** Tags whose start and end each stand between blocks: a line break on both sides. */
const BLOCK_TAGS = new Set([
  "div", "section", "figure", "figcaption", "center", "caption", "thead", "tbody", "tfoot", "dl",
  "dt", "dd", "picture", "video",
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(
    attributes,
  );
  if (match === null) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? "");
}

/**
 * A tag, or an inline code span. Matching the span as a token is what keeps
 * `` `<code>` `` from being read as a tag. A tag name must be followed by
 * whitespace, `/` or `>`, so `<https://…>` autolinks are not tags either.
 */
const TOKEN = /(`+)[^`\n]*?\1|<(\/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*?)?\s*\/?>/g;

/** The output ends at the start of a line, past any quote prefix. */
const LINE_START = /\n(?:> )*$/;
/** …or on a line holding only a continuation indent. */
const LINE_INDENT = /(\n(?:> )*) +$/;

interface ListFrame {
  ordered: boolean;
  count: number;
}

/** An HTML table being rewritten as a pipe table, one row at a time. */
interface TableFrame {
  rows: number;
  cells: number;
  inRow: boolean;
}

/**
 * Converts one stretch of text that is not inside a code fence. The output is
 * Markdown with possibly many blank lines in a row; the parser treats a run of
 * blank lines like one.
 */
function convertSegment(html: string): string {
  let out = "";
  let quoteDepth = 0;
  const lists: ListFrame[] = [];
  const links: Array<string | null> = [];
  const tables: TableFrame[] = [];
  let preDepth = 0;

  // Every newline written inside a blockquote carries the quote's prefix, so
  // the text between tags and the breaks the tags stand for both land inside
  // the quote the parser will read.
  function emit(text: string): void {
    if (quoteDepth === 0) {
      out += text;
      return;
    }
    out += text.replace(/\n/g, `\n${"> ".repeat(quoteDepth)}`);
  }

  /**
   * Starts a new line unless the output is already at the start of one — the
   * source's own newline after `</li>` and the break a tag stands for must
   * not add up to a blank line, which would end the list. A line holding
   * only a continuation indent counts as empty and loses the indent.
   */
  function newline(): void {
    if (out === "" || LINE_START.test(out)) return;
    if (LINE_INDENT.test(out)) {
      out = out.replace(LINE_INDENT, "$1");
      return;
    }
    emit("\n");
  }

  /**
   * A line break that stays inside the open list item: the parser reads an
   * indented line under an item as the item's continuation.
   */
  function lineBreak(): void {
    newline();
    if (lists.length > 0) emit("  ".repeat(lists.length));
  }

  function emitText(text: string): void {
    // Whitespace-only text between block tags is layout, not content: a
    // newline in it is at most a line break, and a space between inline tags
    // is the space between two words.
    if (preDepth === 0 && text.trim() === "") {
      // A pipe table row is one line, whatever the HTML's layout was.
      if (tables[tables.length - 1]?.inRow) return;
      if (text.includes("\n")) newline();
      else emit(text);
      return;
    }
    emit(decodeEntities(text));
  }

  function onTag(closing: boolean, name: string, attributes: string): void {
    if (preDepth > 0) {
      // Inside <pre>, only its own end matters; the <code> around the
      // contents is the HTML way of saying "this is code", already said.
      if (name === "pre" && closing) {
        preDepth -= 1;
        emit("\n```\n");
      }
      return;
    }
    switch (name) {
      case "br":
        if (tables[tables.length - 1]?.inRow) emit(" ");
        else lineBreak();
        return;
      case "hr":
        emit("\n\n---\n\n");
        return;
      case "p":
        // Inside a list item, a paragraph is the item's text, not a block of
        // its own.
        if (lists.length > 0) {
          if (closing) lineBreak();
          return;
        }
        emit("\n\n");
        return;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        emit(closing ? "\n\n" : `\n\n${"#".repeat(Number(name[1]))} `);
        return;
      case "blockquote":
        if (closing) {
          // The line the quote leaves open carries its prefix; drop that so
          // what follows is not quoted with it.
          out = out.replace(LINE_START, "\n");
          quoteDepth = Math.max(0, quoteDepth - 1);
        } else {
          newline();
          quoteDepth += 1;
          out += "> ".repeat(quoteDepth);
        }
        return;
      case "ul":
      case "ol":
        // A nested list continues the item above it, so only the outermost
        // list is set off by a break.
        if (closing) {
          lists.pop();
          if (lists.length === 0) newline();
        } else {
          if (lists.length === 0) newline();
          const start = attribute(attributes, "start");
          lists.push({
            ordered: name === "ol",
            count: start === null || !/^\d+$/.test(start) ? 0 : Number(start) - 1,
          });
        }
        return;
      case "li": {
        if (closing) return;
        const frame = lists[lists.length - 1] ?? { ordered: false, count: 0 };
        frame.count += 1;
        newline();
        emit(`${"  ".repeat(Math.max(0, lists.length - 1))}${frame.ordered ? `${frame.count}.` : "-"} `);
        return;
      }
      case "pre":
        preDepth += 1;
        emit("\n```\n");
        return;
      case "code":
      case "tt":
      case "samp":
      case "kbd":
        emit("`");
        return;
      case "strong":
      case "b":
        emit("**");
        return;
      case "a": {
        if (closing) {
          const href = links.pop() ?? null;
          if (href !== null) emit(`](${href})`);
          return;
        }
        const href = attribute(attributes, "href");
        links.push(href);
        if (href !== null) emit("[");
        return;
      }
      case "img": {
        const src = attribute(attributes, "src");
        if (src === null) return;
        emit(`![${attribute(attributes, "alt") ?? ""}](${src})`);
        return;
      }
      // A table becomes the pipe table the parser reads: the first row is the
      // header whether or not it was <th>, because a pipe table has to have
      // one, and the parser only bolds it.
      case "table":
        newline();
        if (closing) tables.pop();
        else tables.push({ rows: 0, cells: 0, inRow: false });
        return;
      case "tr": {
        const table = tables[tables.length - 1];
        if (table === undefined) return;
        if (closing) {
          table.inRow = false;
          if (table.rows === 0) emit(`\n|${" --- |".repeat(Math.max(1, table.cells))}`);
          table.rows += 1;
          emit("\n");
        } else {
          newline();
          table.inRow = true;
          table.cells = 0;
          emit("| ");
        }
        return;
      }
      case "td":
      case "th": {
        const table = tables[tables.length - 1];
        if (table === undefined || !closing) return;
        table.cells += 1;
        emit(" | ");
        return;
      }
      case "details":
        // Kept as a tag, on its own line, attributes included: `open` decides
        // whether the block starts expanded.
        emit(closing ? "\n</details>\n" : `\n<details${attributes}>\n`);
        return;
      case "summary":
        emit(closing ? "</summary>\n" : "\n<summary>");
        return;
      default:
        if (BLOCK_TAGS.has(name)) newline();
        // Inline tags without a Markdown spelling (em, span, sub, del…) drop
        // away and leave their text.
    }
  }

  let last = 0;
  TOKEN.lastIndex = 0;
  for (;;) {
    const match = TOKEN.exec(html);
    if (match === null) break;
    const name = (match[3] ?? "").toLowerCase();
    // A code span, or a tag GitHub would strip anyway, is text.
    if (match[1] !== undefined || !KNOWN_TAGS.has(name)) continue;
    emitText(html.slice(last, match.index));
    last = match.index + match[0].length;
    onTag(match[2] === "/", name, match[4] ?? "");
  }
  emitText(html.slice(last));
  return out;
}

/**
 * Rewrites HTML into Markdown across the whole body, leaving fenced code
 * alone. The result is what `parseMarkdown` reads.
 */
export function htmlToMarkdown(source: string): string {
  if (!/<[a-zA-Z]/.test(source)) return source;
  // Fenced code is kept verbatim; everything between fences is converted.
  const segments: Array<{ code: boolean; lines: string[] }> = [{ code: false, lines: [] }];
  let fence: string | null = null;
  source.split("\n").forEach((line) => {
    const current = segments[segments.length - 1] as { code: boolean; lines: string[] };
    if (fence === null) {
      const opening = /^\s*(```|~~~)/.exec(line);
      if (opening === null) {
        current.lines.push(line);
        return;
      }
      fence = opening[1] ?? "```";
      segments.push({ code: true, lines: [line] });
      return;
    }
    current.lines.push(line);
    if (line.trim().startsWith(fence)) {
      fence = null;
      segments.push({ code: false, lines: [] });
    }
  });
  return segments
    .map((segment) =>
      segment.code ? segment.lines.join("\n") : convertSegment(segment.lines.join("\n")),
    )
    .join("\n");
}
