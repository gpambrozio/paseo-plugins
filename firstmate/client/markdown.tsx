/**
 * A small renderer for the Markdown an agent writes.
 *
 * A client bundle may import only the modules the host provides, so no
 * Markdown library is reachable, and the host has no renderer of its own to
 * lend. This covers what a first mate's reply actually uses — headings,
 * lists, fenced code, quotes, rules, pipe tables, and bold, code and links
 * inline — and renders anything else as a plain paragraph. It is a trimmed
 * copy of `github-board/client/markdown.tsx`, without the HTML, `<details>`
 * and image handling an issue body needs and an agent's reply does not; there
 * is no workspace root to share one from.
 *
 * Single newlines break lines, so a list the agent wrapped by hand keeps its
 * shape instead of reflowing.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: ListItem[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "rule" }
  | { kind: "table"; header: string[]; rows: string[][] };

interface ListItem {
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

interface MarkdownStyles {
  paragraph: object;
  heading: object;
  headingLarge: object;
  listRow: object;
  listMarker: object;
  listText: object;
  codeBlock: object;
  codeText: object;
  quote: object;
  rule: object;
  bold: object;
  inlineCode: object;
  link: object;
  table: object;
  tableRow: object;
  tableCell: object;
  tableHeader: object;
}

function useMarkdownStyles(theme: PluginTheme, fontSize: number): MarkdownStyles {
  return useMemo(
    () => ({
      paragraph: { color: theme.colors.foreground, fontSize, lineHeight: Math.round(fontSize * 1.45) },
      heading: { color: theme.colors.foreground, fontSize: fontSize + 1, fontWeight: "600" as const, marginTop: 4 },
      headingLarge: { color: theme.colors.foreground, fontSize: fontSize + 3, fontWeight: "700" as const, marginTop: 6 },
      listRow: { flexDirection: "row" as const, gap: 6 },
      listMarker: { color: theme.colors.foregroundMuted, fontSize, lineHeight: Math.round(fontSize * 1.45) },
      listText: { flex: 1 },
      codeBlock: {
        backgroundColor: theme.colors.surface2,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 8,
      },
      codeText: { color: theme.colors.foreground, fontFamily: "monospace", fontSize: fontSize - 1 },
      quote: { borderLeftWidth: 3, borderLeftColor: theme.colors.border, paddingLeft: 10, gap: 6 },
      rule: { height: 1, backgroundColor: theme.colors.border, marginVertical: 4 },
      bold: { fontWeight: "700" as const },
      inlineCode: {
        fontFamily: "monospace",
        backgroundColor: theme.colors.surface2,
        color: theme.colors.foreground,
        fontSize: fontSize - 1,
      },
      link: { color: theme.colors.accent, textDecorationLine: "underline" as const },
      table: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6 },
      tableRow: { flexDirection: "row" as const, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
      tableCell: { flex: 1, paddingHorizontal: 8, paddingVertical: 4 },
      tableHeader: { fontWeight: "600" as const },
    }),
    [theme, fontSize],
  );
}

/** Bold, inline code and links, in one pass; everything else stays as written. */
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]*\]\([^)\s]+\)|https?:\/\/[^\s)<>]+)/g;

function renderInline(text: string, styles: MarkdownStyles, onOpenLink: (url: string) => void): ReactNode[] {
  // Splitting on a capturing group interleaves plain text (even indexes) with
  // the tokens it matched (odd ones). `.map` rather than a loop, because a
  // link's press handler closes over its URL and a closure made in a
  // `for…of` body captures the binding's final value under Hermes.
  return text.split(INLINE).map((part, index) => {
    if (index % 2 === 0 || part === "") return part;
    if (part.startsWith("`")) {
      return (
        <Text key={index} style={styles.inlineCode}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    if (part.startsWith("**") || part.startsWith("__")) {
      return (
        <Text key={index} style={styles.bold}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    const link = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(part);
    const url = (link?.[2] ?? part).replace(/[.,;:]+$/, "");
    const label = link === null ? part : link[1] === "" ? url : (link[1] ?? url);
    return (
      <Text key={index} accessibilityRole="link" style={styles.link} onPress={() => onOpenLink(url)}>
        {label}
      </Text>
    );
  });
}

function renderBlocks(blocks: Block[], styles: MarkdownStyles, onOpenLink: (url: string) => void): ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.kind) {
      case "heading":
        return (
          <Text key={index} accessibilityRole="header" style={block.level <= 2 ? styles.headingLarge : styles.heading}>
            {renderInline(block.text, styles, onOpenLink)}
          </Text>
        );
      case "list":
        return (
          <View key={index}>
            {block.items.map((item, itemIndex) => (
              <View key={itemIndex} style={[styles.listRow, { paddingLeft: item.depth * 14 }]}>
                <Text style={styles.listMarker}>{item.marker}</Text>
                <Text style={[styles.paragraph, styles.listText]}>{renderInline(item.text, styles, onOpenLink)}</Text>
              </View>
            ))}
          </View>
        );
      case "code":
        return (
          <View key={index} style={styles.codeBlock}>
            <Text selectable style={styles.codeText}>
              {block.text}
            </Text>
          </View>
        );
      case "quote":
        return (
          <View key={index} style={styles.quote}>
            {renderBlocks(block.blocks, styles, onOpenLink)}
          </View>
        );
      case "rule":
        return <View key={index} style={styles.rule} />;
      case "table":
        return (
          <View key={index} style={styles.table}>
            {[block.header, ...block.rows].map((cells, rowIndex) => (
              <View key={rowIndex} style={styles.tableRow}>
                {cells.map((cell, cellIndex) => (
                  <View key={cellIndex} style={styles.tableCell}>
                    <Text style={[styles.paragraph, rowIndex === 0 ? styles.tableHeader : null]}>
                      {renderInline(cell, styles, onOpenLink)}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        );
      default:
        return (
          <Text key={index} selectable style={styles.paragraph}>
            {renderInline(block.text, styles, onOpenLink)}
          </Text>
        );
    }
  });
}

export function Markdown({
  source,
  theme,
  fontSize = 13,
  onOpenLink,
}: {
  source: string;
  theme: PluginTheme;
  fontSize?: number;
  onOpenLink: (url: string) => void;
}) {
  const styles = useMarkdownStyles(theme, fontSize);
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <View style={{ gap: 6 }}>{renderBlocks(blocks, styles, onOpenLink)}</View>;
}
