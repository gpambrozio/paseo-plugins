/**
 * The block half of `./markdown`: a first mate's reply as headings, lists,
 * code, quotes, rules, tables and paragraphs. Pure, so `./file-links` walks
 * exactly the text the renderer draws inline — never a fenced code block.
 */

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: ListItem[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "rule" }
  | { kind: "table"; header: string[]; rows: string[][] };

export interface ListItem {
  marker: string;
  depth: number;
  text: string;
}

const LIST_LINE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK_PREFIX = /^\[([ xX])\]\s+/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function listItemOf(line: string): ListItem | null {
  const match = LIST_LINE.exec(line);
  if (match === null) return null;
  const marker = match[2] ?? "-";
  let text = match[3] ?? "";
  let glyph = /^\d/.test(marker) ? marker.replace(")", ".") : "•";
  const task = TASK_PREFIX.exec(text);
  if (task !== null) {
    glyph = task[1] === " " ? "☐" : "☑";
    text = text.slice(task[0].length);
  }
  return { marker: glyph, depth: Math.floor((match[1] ?? "").replace(/\t/g, "  ").length / 2), text };
}

/** Line by line: a fence runs to the next fence, a blank line ends whatever else is open. */
export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: ListItem[] = [];
  let quote: string[] = [];

  function flush(): void {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    if (list.length > 0) blocks.push({ kind: "list", items: list });
    if (quote.length > 0) blocks.push({ kind: "quote", blocks: parseBlocks(quote) });
    paragraph = [];
    list = [];
    quote = [];
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
    if (line.includes("|") && TABLE_SEPARATOR.test(lines[index] ?? "")) {
      flush();
      const header = tableCells(line);
      index += 1; // the separator
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim() !== "") {
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
    // A wrapped continuation of the list item above it.
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

/** Every piece of text the renderer draws inline, in order: everything but code blocks and rules. */
export function inlineTexts(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block): string[] => {
    switch (block.kind) {
      case "heading":
      case "paragraph":
        return [block.text];
      case "list":
        return block.items.map((item) => item.text);
      case "quote":
        return inlineTexts(block.blocks);
      case "table":
        return [block.header, ...block.rows].flat();
      default:
        return [];
    }
  });
}
