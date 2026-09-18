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
import { pickAccent, providerById, providerLabel, type ProviderAccent } from "../shared/providers";
import type { Sort, SortKey, TableRow } from "../shared/sort";

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
  // Wide enough for the four-digit multiples a full catalog produces: with
  // every provider on, the dearest model runs to "11320.8×".
  { label: "Relative", sort: "relative", flex: 1.6, right: true },
  { label: "Platform", sort: "provider", flex: 1.8 },
];

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
      legendItem: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingVertical: 2 },
      legendDot: { width: 10, height: 10, borderRadius: 5 },
      /**
       * The hidden state. `borderColor` is set per provider at the call site;
       * the ring keeps the dot's size, so the legend does not reflow as
       * providers are toggled.
       */
      legendDotOff: { backgroundColor: "transparent" as const, borderWidth: 2 },
      legendLabel: { color: colors.foreground, fontSize: 12 },
      legendLabelOff: { color: colors.foregroundMuted },

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
        // Lines the headings up with the cells under them, which start after
        // the accent strip and its gap.
        paddingLeft: pad + ACCENT_WIDTH + ACCENT_GAP,
        paddingRight: pad,
        paddingVertical: layout.compact ? 10 : 12,
        gap: COLUMN_GAP,
        borderBottomWidth: 1,
        borderBottomColor: separator,
        backgroundColor: colors.surface1,
      },
      headerCell: { flexDirection: "row" as const, alignItems: "center" as const, gap: 3 },
      headerLabel: { color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.6 },
      headerLabelActive: { color: colors.foreground },

      /**
       * `stretch`, not `center`, so the accent strip runs the full height of
       * the row. The cells are centred by `rowCells` inside it instead — an
       * `alignSelf: "stretch"` on the strip alone left it floating at about
       * two thirds height.
       */
      row: {
        flexDirection: "row" as const,
        alignItems: "stretch" as const,
        borderBottomWidth: 1,
        borderBottomColor: withAlpha(colors.foregroundMuted, "2b"),
      },
      rowCells: {
        flex: 1,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: COLUMN_GAP,
        paddingLeft: ACCENT_GAP,
        paddingRight: pad,
        paddingVertical: layout.compact ? 11 : 14,
      },
      accent: { width: ACCENT_WIDTH, marginLeft: pad },

      /**
       * Cells carry `foreground`, not `foregroundMuted`. Muted is legible
       * enough on a dark theme and washes out badly on a light one, and a
       * table of numbers is the last place to spend contrast. What stays muted
       * is the em dash — there the point *is* that nothing was stated.
       */
      cellText: { color: colors.foreground, fontSize: 13 },
      cellName: { color: colors.foreground, fontSize: 15, fontWeight: "600" as const },
      cellMono: { ...mono, color: colors.foreground, fontSize: 13 },
      cellPrice: { ...mono, color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
      cellRelative: { ...mono, color: colors.foreground, fontSize: 14, fontWeight: "700" as const, textAlign: "right" as const },
      cellPlatform: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
      cellUnknown: { color: colors.foregroundMuted, fontWeight: "400" as const },

      // ---- the compact cards ----------------------------------------------
      // Same shape as `row`: a full-height strip beside a padded body.
      card: {
        flexDirection: "row" as const,
        alignItems: "stretch" as const,
        borderBottomWidth: 1,
        borderBottomColor: withAlpha(colors.foregroundMuted, "2b"),
      },
      cardBody: {
        flex: 1,
        gap: 5,
        paddingLeft: ACCENT_GAP,
        paddingRight: pad,
        paddingVertical: 12,
      },
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

/**
 * The coloured strip down a row's left edge, tying it to the legend. Wide
 * enough to judge a hue by: at 3–4px every colour reads as "a dark sliver",
 * which is most of why the providers were hard to tell apart.
 */
const ACCENT_WIDTH = 6;

/**
 * Between the strip and the model name. Without it the strip reads as part of
 * the first letter rather than as a marker for the row.
 */
const ACCENT_GAP = 12;

/**
 * Between every pair of columns. Flex cells butt right up against each other
 * otherwise, which put "11320.8×" and "OpenAI" in contact.
 */
const COLUMN_GAP = 18;

/**
 * A theme colour at reduced alpha. Themes hand out `#rrggbb`, so appending two
 * hex digits is the whole trick; anything else is returned untouched rather
 * than mangled.
 */
export function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;
}

/**
 * A provider's colour for the theme in play, chosen by looking at what the
 * theme paints behind the table — see `ProviderAccent` for why this is a
 * palette rather than a `theme.colors` token.
 */
export function accentColor(theme: PluginTheme, accent: ProviderAccent): string {
  return pickAccent(accent, theme.colors.surface0);
}

function providerAccent(theme: PluginTheme, providerId: string): string {
  const provider = providerById(providerId);
  return provider === null ? theme.colors.foregroundMuted : accentColor(theme, provider.accent);
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
              // The label above already says the direction; left visible this
              // would be read out after it as "down arrow".
              <Text
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={[styles.headerLabel, styles.headerLabelActive]}
              >
                {sort.descending ? "↓" : "↑"}
              </Text>
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
            accessibilityLabel={
              active
                ? `${column.label}, sorted ${sort.descending ? "descending" : "ascending"}`
                : `Sort by ${column.label}`
            }
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
      <View style={styles.rowCells}>
        <Cell flex={COLUMNS[0]?.flex ?? 3} style={styles.cellName} value={row.name} styles={styles} />
        <Cell flex={COLUMNS[1]?.flex ?? 1} style={styles.cellMono} value={formatTokens(row.contextTokens)} styles={styles} />
        <Cell flex={COLUMNS[2]?.flex ?? 1} style={styles.cellMono} value={formatTokens(row.outputTokens)} styles={styles} />
        <Cell
          flex={COLUMNS[3]?.flex ?? 1}
          style={styles.cellPrice}
          value={formatPricePair(row.inputCost, row.outputCost)}
          styles={styles}
        />
        <Cell flex={COLUMNS[4]?.flex ?? 1} style={styles.cellText} value={formatFlag(row.reasoning)} styles={styles} />
        <Cell flex={COLUMNS[5]?.flex ?? 1} style={styles.cellText} value={formatFlag(row.toolCall)} styles={styles} />
        <Cell flex={COLUMNS[6]?.flex ?? 1} style={styles.cellText} value={formatFlag(row.structuredOutput)} styles={styles} />
        <Cell flex={COLUMNS[7]?.flex ?? 1} style={styles.cellText} value={formatFlag(row.temperature)} styles={styles} />
        <Cell
          flex={COLUMNS[8]?.flex ?? 1}
          style={styles.cellRelative}
          value={formatRelative(entry.relative)}
          styles={styles}
        />
        {/*
         * Coloured, because the palette has a variant picked to be legible as
         * text on this background. This is the largest coloured thing in a row
         * and so the one that actually tells two providers apart; the strip at
         * the edge only reinforces it.
         */}
        <Cell
          flex={COLUMNS[9]?.flex ?? 1}
          style={[styles.cellPlatform, { color: providerAccent(theme, row.providerId) }]}
          value={providerLabel(row.providerId)}
          styles={styles}
        />
      </View>
    </View>
  );
}

/**
 * An em dash is dimmed even where its column is not. Everything else in the
 * table is a stated fact and gets full contrast; "nothing was published here"
 * is the one thing that should recede.
 */
function Cell({
  flex,
  style,
  value,
  styles,
}: {
  flex: number;
  style: object | object[];
  value: string;
  styles: Styles;
}) {
  return (
    <Text style={[{ flex }, style, value === UNKNOWN ? styles.cellUnknown : null]} numberOfLines={1}>
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
        <Text style={[styles.cellPlatform, { color: providerAccent(theme, row.providerId) }]} numberOfLines={1}>
          {providerLabel(row.providerId)}
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
