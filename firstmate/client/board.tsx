/**
 * The crew board: seven columns in the order the captain arranged them, each
 * foldable to a narrow strip. A column with nobody in it is not drawn at all,
 * folded or not. On a wide screen the rest sit in one row when there are three
 * or fewer and in two past that, the extra in the second; on a phone they
 * stack, and a folded column is one line.
 *
 * Columns move with their header's arrows rather than by dragging: a drag
 * needs document-level pointer tracking on the web and fights every scroll
 * view it crosses, and two arrows work the same everywhere.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { ColumnId, FleetCard } from "../shared/fleet";
import { CrewCard } from "./card";
import { boardRows, COLUMNS, columnTone, groupCards, moveColumn } from "./format";

const COLLAPSED_WIDTH = 40;

interface BoardProps {
  cards: readonly FleetCard[];
  order: readonly ColumnId[];
  collapsed: readonly string[];
  theme: PluginTheme;
  compact: boolean;
  /** Shows one crewmate's card and transcript in place of the board. */
  onWatch: (agentId: string) => void;
  onToggleColumn: (id: ColumnId) => void;
  /** Saves a new whole column order, hidden columns included. */
  onReorder: (order: ColumnId[]) => void;
  onChanged: () => void;
}

export function Board(props: BoardProps) {
  const { cards, order, collapsed, theme, compact } = props;
  const groups = useMemo(() => groupCards(cards), [cards]);
  const shown = useMemo(() => order.filter((id) => (groups.get(id)?.length ?? 0) > 0), [order, groups]);
  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      board: { flex: 1, padding: compact ? 10 : 12, gap: 10 },
      stack: { gap: 10, padding: 10, paddingBottom: 24 },
      nobody: { padding: compact ? 10 : 12, color: colors.foregroundMuted, fontSize: 12 },
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
    const index = shown.indexOf(id);
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
              onPress={() => props.onReorder(moveColumn(order, id, -1, shown))}
            >
              <Icon name={compact ? "ChevronUp" : "ChevronLeft"} size={13} color={theme.colors.foregroundMuted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${meta.title} ${compact ? "down" : "right"}`}
              accessibilityState={{ disabled: index >= shown.length - 1 }}
              disabled={index >= shown.length - 1}
              style={styles.arrow}
              onPress={() => props.onReorder(moveColumn(order, id, 1, shown))}
            >
              <Icon name={compact ? "ChevronDown" : "ChevronRight"} size={13} color={theme.colors.foregroundMuted} />
            </Pressable>
          </>
        )}
      </View>
    );
  }

  function renderCards(entries: readonly FleetCard[]) {
    return entries.map((card) => {
      const agentId = card.agent?.id ?? null;
      return (
        <CrewCard
          key={card.key}
          card={card}
          theme={theme}
          compact={compact}
          opener={agentId === null ? null : { icon: "Eye", label: "Watch", onPress: () => props.onWatch(agentId) }}
          onChanged={props.onChanged}
        />
      );
    });
  }

  if (shown.length === 0) return <Text style={styles.nobody}>No crew on the board.</Text>;

  if (compact) {
    return (
      // The steer and relaunch boxes on a card are inside this list; on iOS the
      // system insets it for the keyboard and scrolls the focused box into view.
      <ScrollView contentContainerStyle={styles.stack} automaticallyAdjustKeyboardInsets>
        {shown.map((id) => {
          const entries = groups.get(id) ?? [];
          const folded = collapsed.includes(id);
          return (
            <View key={id} style={styles.columnStacked}>
              {renderHeader(id, folded, entries.length)}
              {folded ? null : <View style={styles.body}>{renderCards(entries)}</View>}
            </View>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <View style={styles.board}>
      {boardRows(shown).map((row) => (
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
                  <ScrollView contentContainerStyle={styles.body}>{renderCards(entries)}</ScrollView>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
