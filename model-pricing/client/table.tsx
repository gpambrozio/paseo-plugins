/**
 * The table itself, in two layouts, plus the styles the whole surface shares.
 *
 * There is no table primitive in React Native and none in the host kit, so a
 * row is a `View` of flexing `Text` cells — the shape `launchd-jobs` uses for
 * its run list, widened. Columns are `flex` weights rather than pixel widths
 * because `layout` tells a plugin only whether it is `compact`, never how wide
 * it is, so the columns have to share whatever they are given.
 *
 * Ten columns do not fit a phone, and a horizontally scrolling table is a poor
 * way to read one. `layout.compact` therefore gets `PricingCards` — the same
 * rows, one card each — rather than a squeezed version of the same grid.
 *
 * No async anything in this file, and `.map` rather than `for…of` wherever a
 * closure captures the element: Hermes evaluates an async arrow in the eval'd
 * client bundle to `undefined`, and a `for (const … of …)` body captures the
 * loop binding's final value.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import {
  formatFlag,
  formatPrice,
  formatPricePair,
  formatRelative,
  formatTokens,
  rowKey,
  UNKNOWN,
} from "../shared/format";
import type { PriceRow } from "../shared/pricing";
import { providerById, type AccentToken } from "../shared/providers";

/** One row, with the relative multiple already worked out for the visible set. */
export interface TableRow {
  row: PriceRow;
  relative: number;
}

export type SortKey = "name" | "context" | "output" | "price" | "relative" | "provider";

export interface Sort {
  key: SortKey;
  descending: boolean;
}

interface Column {
  label: string;
  /** Pressable when set; the columns with nothing to order by are not. */
  sort: SortKey | null;
  flex: number;
  right?: boolean;
}

/**
 * Widths are weights, not pixels. MODEL takes roughly a third because a model
 * name is the only cell whose length is not bounded by its format.
 */
const COLUMNS: readonly Column[] = [
  { label: "Model", sort: "name", flex: 3.2 },
  { label: "Context", sort: "context", flex: 1.1 },
  { label: "Output", sort: "output", flex: 1.1 },
  { label: "Price", sort: "price", flex: 1.8 },
  { label: "Reasoning", sort: null, flex: 1.3 },
  { label: "Tool call", sort: null, flex: 1.3 },
  { label: "Structured", sort: null, flex: 1.3 },
  { label: "Temperature", sort: null, flex: 1.5 },
  { label: "Relative", sort: "relative", flex: 1.2, right: true },
  { label: "Platform", sort: "provider", flex: 1.7 },
];

// ---------------------------------------------------------------------------
// Sorting

/**
 * Ordering for one key, with unknowns always last whichever way the arrow
 * points — a model that does not publish its context window is not the one with
 * the smallest.
 */
export function compareRows(a: TableRow, b: TableRow, sort: Sort): number {
  const direction = sort.descending ? -1 : 1;
  switch (sort.key) {
    case "name":
      return a.row.name.localeCompare(b.row.name) * direction;
    case "provider":
      return (providerLabelOf(a.row).localeCompare(providerLabelOf(b.row)) || a.row.name.localeCompare(b.row.name)) * direction;
    case "context":
      return compareNullable(a.row.contextTokens, b.row.contextTokens, direction);
    case "output":
      return compareNullable(a.row.outputTokens, b.row.outputTokens, direction);
    case "price":
      return compareNullable(a.row.inputCost, b.row.inputCost, direction);
    case "relative":
      return compareNullable(a.relative, b.relative, direction);
  }
}

function compareNullable(a: number | null, b: number | null, direction: number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

function providerLabelOf(row: PriceRow): string {
  return providerById(row.providerId)?.label ?? row.providerId;
}

// ---------------------------------------------------------------------------
// Styles

/**
 * Every colour comes from `theme.colors`; the only eleven tokens that exist are
 * the ones named in the root CLAUDE.md, and any other name is `undefined` at
 * runtime. Separators and hover tints are those same tokens at reduced alpha.
 */
export function useStyles({ theme, layout }: { theme: PluginTheme; layout: { compact: boolean; platform: string } }) {
  const { colors } = theme;
  const pad = layout.compact ? 12 : 20;
  const separator = withAlpha(colors.foregroundMuted, "33");
  const faint = withAlpha(colors.foregroundMuted, "14");
  // Prices and token counts are columns of digits; a proportional font makes
  // them ragged and much harder to compare down the page.
  const mono = { fontFamily: layout.platform === "ios" ? "Menlo" : "monospace" } as const;

  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: colors.surface0 },

      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: pad,
        paddingTop: layout.compact ? 10 : 16,
      },
      title: { color: colors.foreground, fontSize: layout.compact ? 20 : 26, fontWeight: "700" as const },
      spacer: { flex: 1 },
      subtitle: { color: colors.foregroundMuted, fontSize: 12, paddingHorizontal: pad, paddingTop: 4 },

      legend: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 12, paddingHorizontal: pad, paddingTop: 8 },
      legendItem: { flexDirection: "row" as const, alignItems: "center" as const, gap: 5 },
      legendDot: { width: 8, height: 8, borderRadius: 4 },
      legendLabel: { color: colors.foregroundMuted, fontSize: 12 },

      iconButton: { padding: 7, borderRadius: 8 },
      pressed: { opacity: 0.6 },
      refresh: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: colors.accent,
      },
      refreshLabel: { color: colors.accentForeground, fontSize: 13, fontWeight: "600" as const },

      search: {
        marginHorizontal: pad,
        marginTop: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: separator,
        backgroundColor: colors.surface1,
        color: colors.foreground,
        fontSize: 14,
      },

      banner: {
        marginHorizontal: pad,
        marginTop: 10,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.statusWarning,
        backgroundColor: faint,
        gap: 3,
      },
      bannerText: { color: colors.statusWarning, fontSize: 12 },

      // ---- the wide table -------------------------------------------------
      table: { flex: 1, marginTop: 12 },
      headerRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        paddingLeft: pad + ACCENT_WIDTH,
        paddingRight: pad,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: separator,
        backgroundColor: colors.surface1,
      },
      headerCell: { flexDirection: "row" as const, alignItems: "center" as const, gap: 3 },
      headerLabel: { color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.6 },
      headerLabelActive: { color: colors.foreground },

      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        paddingRight: pad,
        paddingVertical: 11,
        borderBottomWidth: 1,
        borderBottomColor: withAlpha(colors.foregroundMuted, "1f"),
      },
      rowPressed: { backgroundColor: faint },
      accent: { width: ACCENT_WIDTH, alignSelf: "stretch" as const, marginLeft: pad },
      cellText: { color: colors.foregroundMuted, fontSize: 13 },
      cellName: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
      cellMono: { ...mono, color: colors.foregroundMuted, fontSize: 12 },
      cellPrice: { ...mono, color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
      cellRelative: { ...mono, color: colors.foreground, fontSize: 13, fontWeight: "700" as const, textAlign: "right" as const },

      // ---- the compact cards ----------------------------------------------
      card: {
        flexDirection: "row" as const,
        gap: 10,
        paddingRight: pad,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: withAlpha(colors.foregroundMuted, "1f"),
      },
      cardBody: { flex: 1, gap: 4 },
      cardTop: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      cardName: { color: colors.foreground, fontSize: 15, fontWeight: "600" as const, flex: 1 },
      cardMeta: { color: colors.foregroundMuted, fontSize: 12 },
      cardFlags: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, marginTop: 2 },
      chip: {
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: separator,
      },
      chipLabel: { color: colors.foregroundMuted, fontSize: 11 },

      empty: { color: colors.foregroundMuted, fontSize: 13, textAlign: "center" as const, padding: 32 },
      pad: { height: 24 },
    }),
    // `colors`, `pad`, `separator`, `faint` and `mono` are all derived from
    // these two, so they are the whole dependency list.
    [theme, layout.compact, layout.platform],
  );
}

export type Styles = ReturnType<typeof useStyles>;

/** The coloured strip down a row's left edge, tying it to the legend. */
const ACCENT_WIDTH = 3;

/**
 * A theme colour at reduced alpha. Themes hand out `#rrggbb`, so appending two
 * hex digits is the whole trick; anything else is returned untouched rather
 * than mangled.
 */
export function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;
}

/** Resolve a provider's legend token against the live theme. */
export function accentColor(theme: PluginTheme, token: AccentToken): string {
  return theme.colors[token];
}

function providerAccent(theme: PluginTheme, providerId: string): string {
  const provider = providerById(providerId);
  return provider === null ? theme.colors.foregroundMuted : accentColor(theme, provider.accentToken);
}

// ---------------------------------------------------------------------------
// The wide table

export function TableHeader({
  styles,
  sort,
  onSort,
}: {
  styles: Styles;
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  return (
    <View style={styles.headerRow}>
      {COLUMNS.map((column) => {
        const active = column.sort !== null && column.sort === sort.key;
        const cell = (
          <View style={[styles.headerCell, column.right === true ? justifyEnd : null]}>
            <Text style={[styles.headerLabel, active ? styles.headerLabelActive : null]} numberOfLines={1}>
              {column.label.toUpperCase()}
            </Text>
            {active ? (
              <Text style={[styles.headerLabel, styles.headerLabelActive]}>{sort.descending ? "↓" : "↑"}</Text>
            ) : null}
          </View>
        );
        if (column.sort === null) {
          return (
            <View key={column.label} style={{ flex: column.flex }}>
              {cell}
            </View>
          );
        }
        const key = column.sort;
        return (
          <Pressable
            key={column.label}
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${column.label}`}
            accessibilityState={{ selected: active }}
            onPress={() => onSort(key)}
            style={({ pressed }) => [{ flex: column.flex }, pressed ? styles.pressed : null]}
          >
            {cell}
          </Pressable>
        );
      })}
    </View>
  );
}

const justifyEnd = { justifyContent: "flex-end" as const };

export function TableBodyRow({ entry, styles, theme }: { entry: TableRow; styles: Styles; theme: PluginTheme }) {
  const { row } = entry;
  return (
    <View style={styles.row}>
      <View style={[styles.accent, { backgroundColor: providerAccent(theme, row.providerId) }]} />
      <Cell flex={COLUMNS[0]?.flex ?? 3} style={styles.cellName} value={row.name} />
      <Cell flex={COLUMNS[1]?.flex ?? 1} style={styles.cellMono} value={formatTokens(row.contextTokens)} />
      <Cell flex={COLUMNS[2]?.flex ?? 1} style={styles.cellMono} value={formatTokens(row.outputTokens)} />
      <Cell flex={COLUMNS[3]?.flex ?? 1} style={styles.cellPrice} value={formatPricePair(row.inputCost, row.outputCost)} />
      <Cell flex={COLUMNS[4]?.flex ?? 1} style={styles.cellText} value={formatFlag(row.reasoning)} />
      <Cell flex={COLUMNS[5]?.flex ?? 1} style={styles.cellText} value={formatFlag(row.toolCall)} />
      <Cell flex={COLUMNS[6]?.flex ?? 1} style={styles.cellText} value={formatFlag(row.structuredOutput)} />
      <Cell flex={COLUMNS[7]?.flex ?? 1} style={styles.cellText} value={formatFlag(row.temperature)} />
      <Cell flex={COLUMNS[8]?.flex ?? 1} style={styles.cellRelative} value={formatRelative(entry.relative)} />
      <Cell
        flex={COLUMNS[9]?.flex ?? 1}
        style={[styles.cellText, { color: providerAccent(theme, row.providerId) }]}
        value={providerLabelOf(row)}
      />
    </View>
  );
}

function Cell({ flex, style, value }: { flex: number; style: object | object[]; value: string }) {
  return (
    <Text style={[{ flex }, style]} numberOfLines={1}>
      {value}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// The compact card

export function PricingCard({ entry, styles, theme }: { entry: TableRow; styles: Styles; theme: PluginTheme }) {
  const { row } = entry;
  const flags = [
    row.reasoning === true ? "Reasoning" : null,
    row.toolCall === true ? "Tool call" : null,
    row.structuredOutput === true ? "Structured" : null,
    row.temperature === true ? "Temperature" : null,
  ].filter((flag): flag is string => flag !== null);

  return (
    <View style={styles.card}>
      <View style={[styles.accent, { backgroundColor: providerAccent(theme, row.providerId) }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <Text style={styles.cardName} numberOfLines={2}>
            {row.name}
          </Text>
          <Text style={styles.cellRelative}>{formatRelative(entry.relative)}</Text>
        </View>
        <Text style={[styles.cardMeta, { color: providerAccent(theme, row.providerId) }]} numberOfLines={1}>
          {providerLabelOf(row)}
        </Text>
        <Text style={styles.cellPrice} numberOfLines={1}>
          {formatPrice(row.inputCost)} in · {formatPrice(row.outputCost)} out · per 1M
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {formatTokens(row.contextTokens)} context · {formatTokens(row.outputTokens)} output
        </Text>
        {flags.length === 0 ? null : (
          <View style={styles.cardFlags}>
            {flags.map((flag) => (
              <View key={flag} style={styles.chip}>
                <Text style={styles.chipLabel}>{flag}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

/** Stable list key. A model id is unique only within its provider. */
export function tableRowKey(entry: TableRow): string {
  return rowKey(entry.row);
}

export { UNKNOWN };
