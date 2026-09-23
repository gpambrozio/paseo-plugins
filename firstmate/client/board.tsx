/**
 * The crew board: seven columns in the order the captain arranged them, each
 * foldable to a narrow strip. On a wide screen they sit in two rows, the way
 * the FirstMate board always has; on a phone they stack, and a folded column
 * is one line.
 *
 * Columns move with their header's arrows rather than by dragging: a drag
 * needs document-level pointer tracking on the web and fights every scroll
 * view it crosses, and two arrows work the same everywhere.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { ColumnId, FleetCard } from "../shared/fleet";
import { CrewCard } from "./card";
import { COLUMNS, columnTone, groupCards } from "./format";

const COLLAPSED_WIDTH = 40;
const ROWS = 2;

/** At most `rows` rows, earlier rows filled first. */
export function splitRows<T>(items: readonly T[], rows: number = ROWS): T[][] {
  if (items.length === 0) return [];
  const perRow = Math.ceil(items.length / Math.max(1, rows));
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += perRow) result.push(items.slice(index, index + perRow));
  return result;
}

interface BoardProps {
  cards: readonly FleetCard[];
  order: readonly ColumnId[];
  collapsed: readonly string[];
  theme: PluginTheme;
  compact: boolean;
  navigation: PluginSurfaceProps["navigation"];
  onToggleColumn: (id: ColumnId) => void;
  onMoveColumn: (id: ColumnId, delta: number) => void;
  onChanged: () => void;
}

export function Board(props: BoardProps) {
  const { cards, order, collapsed, theme, compact } = props;
  const groups = useMemo(() => groupCards(cards), [cards]);
  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      board: { flex: 1, padding: compact ? 10 : 12, gap: 10 },
      stack: { gap: 10, padding: 10, paddingBottom: 24 },
      row: { flex: 1, minHeight: 0, flexDirection: "row" as const, gap: 10 },
      column: {
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minWidth: 0,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: colors.surface1,
        padding: 8,
        gap: 8,
      },
      columnStacked: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: colors.surface1,
        padding: 8,
        gap: 8,
      },
      columnFolded: { flexGrow: 0, flexBasis: COLLAPSED_WIDTH, width: COLLAPSED_WIDTH, alignItems: "center" as const },
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      headerFolded: { alignItems: "center" as const, gap: 8 },
      title: { flex: 1, color: colors.foreground, fontSize: 12, fontWeight: "600" as const },
      count: { color: colors.foregroundMuted, fontSize: 11 },
      arrow: { padding: 3 },
      body: { gap: 8, paddingBottom: 4 },
      empty: { color: colors.foregroundMuted, fontSize: 11, paddingVertical: 4 },
      foldedTitle: {
        color: colors.foregroundMuted,
        fontSize: 11,
        transform: [{ rotate: "90deg" }],
        width: 120,
        textAlign: "center" as const,
        marginTop: 56,
      },
    };
  }, [theme, compact]);

  function renderHeader(id: ColumnId, folded: boolean, count: number) {
    const meta = COLUMNS[id];
    const tone = columnTone(theme, id);
    const index = order.indexOf(id);
    const toggle = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${folded ? "Unfold" : "Fold"} ${meta.title}`}
        style={styles.arrow}
        onPress={() => props.onToggleColumn(id)}
      >
        <Icon name={folded ? "ChevronRight" : "ChevronDown"} size={14} color={theme.colors.foregroundMuted} />
      </Pressable>
    );
    if (folded && !compact) {
      return (
        <View style={styles.headerFolded}>
          {toggle}
          <Icon name={meta.icon} size={14} color={tone} />
          <Text style={styles.count}>{count}</Text>
        </View>
      );
    }
    return (
      <View style={styles.header}>
        {toggle}
        <Icon name={meta.icon} size={14} color={tone} />
        <Text style={styles.title} numberOfLines={1}>
          {meta.title}
        </Text>
        <Text style={styles.count}>{count}</Text>
        {folded ? null : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${meta.title} ${compact ? "up" : "left"}`}
              accessibilityState={{ disabled: index <= 0 }}
              disabled={index <= 0}
              style={styles.arrow}
              onPress={() => props.onMoveColumn(id, -1)}
            >
              <Icon name={compact ? "ChevronUp" : "ChevronLeft"} size={13} color={theme.colors.foregroundMuted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${meta.title} ${compact ? "down" : "right"}`}
              accessibilityState={{ disabled: index >= order.length - 1 }}
              disabled={index >= order.length - 1}
              style={styles.arrow}
              onPress={() => props.onMoveColumn(id, 1)}
            >
              <Icon name={compact ? "ChevronDown" : "ChevronRight"} size={13} color={theme.colors.foregroundMuted} />
            </Pressable>
          </>
        )}
      </View>
    );
  }

  function renderCards(id: ColumnId, entries: readonly FleetCard[]) {
    if (entries.length === 0) return <Text style={styles.empty}>{COLUMNS[id].empty}</Text>;
    return entries.map((card) => (
      <CrewCard
        key={card.key}
        card={card}
        theme={theme}
        compact={compact}
        navigation={props.navigation}
        onChanged={props.onChanged}
      />
    ));
  }

  if (compact) {
    return (
      // The steer and relaunch boxes on a card are inside this list; on iOS the
      // system insets it for the keyboard and scrolls the focused box into view.
      <ScrollView contentContainerStyle={styles.stack} automaticallyAdjustKeyboardInsets>
        {order.map((id) => {
          const entries = groups.get(id) ?? [];
          const folded = collapsed.includes(id);
          return (
            <View key={id} style={styles.columnStacked}>
              {renderHeader(id, folded, entries.length)}
              {folded ? null : <View style={styles.body}>{renderCards(id, entries)}</View>}
            </View>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <View style={styles.board}>
      {splitRows(order).map((row) => (
        <View key={row.join(",")} style={styles.row}>
          {row.map((id) => {
            const entries = groups.get(id) ?? [];
            const folded = collapsed.includes(id);
            return (
              <View key={id} style={[styles.column, folded ? styles.columnFolded : null]}>
                {renderHeader(id, folded, entries.length)}
                {folded ? (
                  <Text style={styles.foldedTitle} numberOfLines={1}>
                    {COLUMNS[id].title}
                  </Text>
                ) : (
                  <ScrollView contentContainerStyle={styles.body}>{renderCards(id, entries)}</ScrollView>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
