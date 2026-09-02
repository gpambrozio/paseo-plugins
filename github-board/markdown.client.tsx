import type { ReactNode } from "react";
import { Text, View } from "react-native";

/**
 * A small renderer for the Markdown an issue body is written in.
 *
 * A client bundle may import only react, react-native, react-query, zod and
 * `@getpaseo/plugin`, so no Markdown library is reachable from here. Rather
 * than dump raw Markdown in the panel, this covers the handful of constructs
 * an issue or pull request body actually uses — headings, lists, task lists,
 * fenced code, quotes, rules, and bold, code and links inline — and renders
 * anything else as a plain paragraph. Tables are rendered as rows of cells, because
 * a side-by-side of screenshots is one. Nested emphasis and raw HTML are left
 * as the text they were written as; the panel's **Open on GitHub** button
 * is there for the rest.
 *
 * Single newlines break lines, the way GitHub renders an issue body (its
 * comment flavour of GFM turns a newline into `<br>`), so a paragraph keeps
 * the author's line breaks instead of reflowing them.
 */

/** The styles the renderer needs; the surface's `useStyles` provides them. */
export interface MarkdownStyles {
  mdParagraph: object;
  mdHeading: object;
  mdHeadingLarge: object;
  mdListRow: object;
  mdListMarker: object;
  mdListText: object;
  mdCodeBlock: object;
  mdCodeText: object;
  mdQuote: object;
  mdRule: object;
  mdBold: object;
  mdInlineCode: object;
  mdLink: object;
  mdTable: object;
  mdTableRow: object;
  mdTableCell: object;
  mdTableHeader: object;
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: ListItem[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "image"; alt: string; url: string }
  | { kind: "table"; header: string[]; rows: string[][] };

interface ListItem {
  marker: string;
  /** Nesting depth from the item's indentation, two spaces per level. */
  depth: number;
  text: string;
}

const LIST_LINE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
/**
 * A line that is one image and nothing else, in either spelling GitHub
 * accepts: Markdown, or the `<img>` tag its editor pastes for a resized one.
 * Only a whole line becomes an image block; an image inside a sentence stays
 * a link, because there is no inline image in a `Text`.
 */
const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/;
const IMG_TAG_LINE = /^\s*<img\b([^>]*)>\s*$/i;

/**
 * A pipe table, GitHub's only table syntax: a header row, a `|---|` line, then
 * rows. Cells are split on unescaped pipes; a cell may be any inline text, or
 * an image, which is what most tables in a review thread are for.
 */
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim() !== "";
}

function imageOf(line: string): { alt: string; url: string } | null {
  const markdown = IMAGE_LINE.exec(line);
  if (markdown !== null) return { alt: markdown[1] ?? "", url: markdown[2] ?? "" };
  const tag = IMG_TAG_LINE.exec(line);
  if (tag === null) return null;
  const attributes = tag[1] ?? "";
  const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attributes);
  if (src === null) return null;
  const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(attributes);
  return { alt: alt?.[1] ?? "", url: src[1] ?? "" };
}
const TASK_PREFIX = /^\[([ xX])\]\s+/;

function listItemOf(line: string): ListItem | null {
  const match = LIST_LINE.exec(line);
  if (match === null) return null;
  const indent = match[1] ?? "";
  const marker = match[2] ?? "-";
  let text = match[3] ?? "";
  let glyph = /^\d/.test(marker) ? marker.replace(")", ".") : "•";
  const task = TASK_PREFIX.exec(text);
  if (task !== null) {
    glyph = task[1] === " " ? "☐" : "☑";
    text = text.slice(task[0].length);
  }
  return { marker: glyph, depth: Math.floor(indent.replace(/\t/g, "  ").length / 2), text };
}

/**
 * Splits the source into blocks. Everything is decided line by line: a fence
 * opens a code block that runs to the next fence, a blank line ends whatever
 * is open, and any line that is not a heading, list item, quote or rule is
 * paragraph text.
 */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  // HTML comments are how issue templates carry their instructions, and
  // GitHub does not show them either.
  const lines = source.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").split("\n");

  let paragraph: string[] = [];
  let list: ListItem[] = [];
  let quote: string[] = [];

  function flush(): void {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
    if (list.length > 0) {
      blocks.push({ kind: "list", items: list });
      list = [];
    }
    if (quote.length > 0) {
      blocks.push({ kind: "quote", text: quote.join("\n") });
      quote = [];
    }
  }

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    index += 1;

    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence !== null) {
      flush();
      const code: string[] = [];
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith(fence[1] ?? "```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1; // the closing fence, if there was one
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ kind: "heading", level: (heading[1] ?? "#").length, text: heading[2] ?? "" });
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }

    const image = imageOf(line);
    if (image !== null) {
      flush();
      blocks.push({ kind: "image", ...image });
      continue;
    }

    if (isTableRow(line) && TABLE_SEPARATOR.test(lines[index] ?? "")) {
      flush();
      const header = tableCells(line);
      index += 1; // the separator
      const rows: string[][] = [];
      while (index < lines.length && isTableRow(lines[index] ?? "")) {
        rows.push(tableCells(lines[index] ?? ""));
        index += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    const item = listItemOf(line);
    if (item !== null) {
      if (paragraph.length > 0 || quote.length > 0) flush();
      list.push(item);
      continue;
    }

    if (line.startsWith(">")) {
      if (paragraph.length > 0 || list.length > 0) flush();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }

    // A wrapped continuation of the list item above it, which GitHub also
    // treats as the item's text rather than as a new paragraph.
    if (list.length > 0 && /^\s+/.test(line)) {
      const last = list[list.length - 1];
      if (last !== undefined) last.text = `${last.text}\n${line.trim()}`;
      continue;
    }

    if (list.length > 0 || quote.length > 0) flush();
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/**
 * Bold, inline code, links and images, in one pass. An image becomes a link
 * to itself, named after its alt text, because the panel cannot show it and a
 * bare URL would say nothing about what it was.
 */
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|!?\[[^\]\n]*\]\([^)\s]+\))/g;

function renderInline(
  text: string,
  styles: MarkdownStyles,
  onOpenLink: (url: string) => void,
): ReactNode[] {
  // Splitting on a capturing group interleaves plain text (even indexes) with
  // the tokens it matched (odd indexes). `.map` rather than a loop, because a
  // link's press handler closes over its URL and a closure made in a `for…of`
  // body captures the binding's final value under Hermes.
  return text.split(INLINE).map((part, index) => {
    if (index % 2 === 0 || part === "") return part;
    if (part.startsWith("`")) {
      return (
        <Text key={index} style={styles.mdInlineCode}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    if (part.startsWith("**") || part.startsWith("__")) {
      return (
        <Text key={index} style={styles.mdBold}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    const link = /^(!?)\[([^\]]*)\]\(([^)]+)\)$/.exec(part);
    const url = link?.[3] ?? part;
    const label = link?.[2] === undefined || link[2] === "" ? url : link[2];
    return (
      <Text key={index} accessibilityRole="link" style={styles.mdLink} onPress={() => onOpenLink(url)}>
        {link?.[1] === "!" ? `[image: ${label}]` : label}
      </Text>
    );
  });
}

export function MarkdownBody({
  source,
  styles,
  onOpenLink,
  renderImage,
}: {
  source: string;
  styles: MarkdownStyles;
  /** Every link goes through the caller, which knows how to leave the app. */
  onOpenLink: (url: string) => void;
  /**
   * Draws an image that stands on its own line. The caller owns it because
   * fetching one may need the daemon; this module only knows the URL.
   */
  renderImage: (image: { url: string; alt: string }) => ReactNode;
}) {
  const blocks = parseMarkdown(source);
  // `.map`, not `for…of`: a closure made in a loop body captures the binding's
  // final value under Hermes, and every link handler here is one.
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <Text
                key={index}
                accessibilityRole="header"
                style={block.level <= 2 ? styles.mdHeadingLarge : styles.mdHeading}
              >
                {renderInline(block.text, styles, onOpenLink)}
              </Text>
            );
          case "list":
            return (
              <View key={index}>
                {block.items.map((item, itemIndex) => (
                  <View
                    key={itemIndex}
                    style={[styles.mdListRow, { paddingLeft: item.depth * 16 }]}
                  >
                    <Text style={styles.mdListMarker}>{item.marker}</Text>
                    <Text style={[styles.mdParagraph, styles.mdListText]}>
                      {renderInline(item.text, styles, onOpenLink)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          case "code":
            return (
              <View key={index} style={styles.mdCodeBlock}>
                <Text style={styles.mdCodeText}>{block.text}</Text>
              </View>
            );
          case "quote":
            return (
              <View key={index} style={styles.mdQuote}>
                <Text style={styles.mdParagraph}>
                  {renderInline(block.text, styles, onOpenLink)}
                </Text>
              </View>
            );
          case "rule":
            return <View key={index} style={styles.mdRule} />;
          case "image":
            return <View key={index}>{renderImage({ url: block.url, alt: block.alt })}</View>;
          case "table":
            return (
              <View key={index} style={styles.mdTable}>
                {[block.header, ...block.rows].map((cells, rowIndex) => (
                  <View key={rowIndex} style={styles.mdTableRow}>
                    {cells.map((cell, cellIndex) => {
                      const image = imageOf(cell);
                      return (
                        <View key={cellIndex} style={styles.mdTableCell}>
                          {image !== null ? (
                            renderImage(image)
                          ) : (
                            <Text
                              style={[
                                styles.mdParagraph,
                                rowIndex === 0 ? styles.mdTableHeader : null,
                              ]}
                            >
                              {renderInline(cell, styles, onOpenLink)}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            );
          default:
            return (
              <Text key={index} style={styles.mdParagraph}>
                {renderInline(block.text, styles, onOpenLink)}
              </Text>
            );
        }
      })}
    </>
  );
}
