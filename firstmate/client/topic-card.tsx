/**
 * One topic on the board of topics: its title, its project and date, then either what it asks of the captain,
 * in the warning colour with the first mate's answer buttons, or one line of the last thing said. The
 * whole card opens the topic; an answer button sends its prompt without opening it.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import type { CardAction, FleetCard } from "../shared/fleet";
import { cardActions } from "./card-answer";
import { topicAsk, topicLastLine, topicMeta } from "./topic-format";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

/** A topic's answer buttons, the first one in the accent colour as the first mate's recommendation. */
export function AnswerButtons({
  actions,
  theme,
  disabled,
  onAnswer,
}: {
  actions: readonly CardAction[];
  theme: PluginTheme;
  disabled: boolean;
  onAnswer: (action: CardAction) => void;
}) {
  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      button: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        opacity: disabled ? 0.5 : 1,
        maxWidth: "100%" as const,
      },
      primary: { backgroundColor: colors.accent, borderColor: colors.accent },
      label: { color: colors.foreground, fontSize: FONT_SIZE.caption, fontWeight: "500" as const },
      primaryLabel: { color: colors.accentForeground },
    };
  }, [theme, disabled]);

  if (actions.length === 0) return null;
  return (
    <View style={styles.row}>
      {actions.map((action, index) => (
        <Pressable
          key={`${index}:${action.label}`}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onAnswer(action)}
          style={[styles.button, index === 0 ? styles.primary : null]}
        >
          <Text style={[styles.label, index === 0 ? styles.primaryLabel : null]}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function TopicCard({
  card,
  theme,
  unread,
  sending,
  onOpen,
  onAnswer,
}: {
  card: FleetCard;
  theme: PluginTheme;
  unread: boolean;
  /** A message to the first mate is on its way; the answer buttons wait for it. */
  sending: boolean;
  onOpen: () => void;
  onAnswer: (action: CardAction) => void;
}) {
  const ask = topicAsk(card);
  const last = ask === null ? topicLastLine(card) : null;
  const meta = topicMeta(card);

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      card: {
        backgroundColor: colors.surface1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 9,
        paddingHorizontal: 10,
        paddingVertical: 9,
        gap: 6,
      },
      head: { gap: 2 },
      titleRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8 },
      title: {
        flex: 1,
        color: colors.foreground,
        fontSize: FONT_SIZE.small,
        lineHeight: lineHeightFor(FONT_SIZE.small),
        fontWeight: "600" as const,
      },
      unread: { width: 8, height: 8, borderRadius: 4, marginTop: 5, backgroundColor: colors.accent },
      meta: { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro },
      ask: { color: colors.statusWarning, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
      last: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
    };
  }, [theme]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${card.title}${unread ? ", unread" : ""}`}
      onPress={onOpen}
      style={styles.card}
    >
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>
            {card.title}
          </Text>
          {unread ? <View style={styles.unread} /> : null}
        </View>
        {meta === "" ? null : (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        )}
      </View>
      {ask === null ? null : (
        <Text style={styles.ask} numberOfLines={4}>
          {ask}
        </Text>
      )}
      {ask === null ? null : (
        <AnswerButtons actions={cardActions(card)} theme={theme} disabled={sending} onAnswer={onAnswer} />
      )}
      {last === null ? null : (
        <Text style={styles.last} numberOfLines={2}>
          {last}
        </Text>
      )}
    </Pressable>
  );
}
