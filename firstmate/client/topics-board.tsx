/**
 * The board of topics: Needs you, Working, Queued and Done side by side across the main pane, each a
 * plain list of topic cards under a small heading with its count. In a narrow pane the columns stack
 * into one list, and on a phone Done is left out: the phone is for what is live.
 *
 * Done draws only its newest topics (`shownDone`), with a button that draws more.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import type { CardAction, FleetCard } from "../shared/fleet";
import { CAPTAIN_COLUMN_IDS, CAPTAIN_COLUMN_TITLES, groupCaptainCards, type CaptainColumnId } from "./format";
import { TopicCard } from "./topic-card";
import { DONE_SHOWN, shownDone, topicUnread } from "./topic-format";
import { FONT_SIZE } from "./type-scale";
import { ShowMore } from "./ui";

export function TopicsBoard({
  cards,
  theme,
  compact,
  narrow,
  topicsRead,
  sending,
  onOpen,
  onAnswer,
}: {
  cards: readonly FleetCard[];
  theme: PluginTheme;
  /** A phone. */
  compact: boolean;
  /** Too narrow for four columns: one list. */
  narrow: boolean;
  /** When the captain last had each topic open, by `readKey`; an unread dot is judged against it. */
  topicsRead: Readonly<Record<string, string>>;
  sending: boolean;
  onOpen: (card: FleetCard) => void;
  onAnswer: (card: FleetCard, action: CardAction) => void;
}) {
  const groups = useMemo(() => groupCaptainCards(cards), [cards]);
  const [doneLimit, setDoneLimit] = useState(DONE_SHOWN);
  const columns: readonly CaptainColumnId[] = compact
    ? CAPTAIN_COLUMN_IDS.filter((id) => id !== "done")
    : CAPTAIN_COLUMN_IDS;

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      scroll: { flex: 1 },
      board: narrow
        ? { padding: 10, paddingBottom: 24, gap: 16 }
        : { flexDirection: "row" as const, alignItems: "flex-start" as const, padding: 14, gap: 12 },
      column: narrow ? { gap: 8 } : { flex: 1, minWidth: 0, gap: 8 },
      heading: {
        color: colors.foregroundMuted,
        fontSize: FONT_SIZE.caption,
        fontWeight: "600" as const,
        letterSpacing: 0.5,
        textTransform: "uppercase" as const,
      },
      count: { fontWeight: "400" as const, opacity: 0.7 },
    };
  }, [theme, narrow]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.board}>
      {columns.map((id) => {
        const all = groups.get(id) ?? [];
        const { shown, older } = id === "done" ? shownDone(all, doneLimit) : { shown: all, older: 0 };
        return (
          <View key={id} style={styles.column}>
            <Text style={styles.heading} accessibilityRole="header">
              {CAPTAIN_COLUMN_TITLES[id]}
              {/* Everything ever finished is not a figure the captain acts on. */}
              {id === "done" ? null : <Text style={styles.count}> {all.length}</Text>}
            </Text>
            {shown.map((card) => (
              <TopicCard
                key={card.key}
                card={card}
                theme={theme}
                unread={topicUnread(card, topicsRead)}
                sending={sending}
                onOpen={() => onOpen(card)}
                onAnswer={(action) => onAnswer(card, action)}
              />
            ))}
            {older === 0 ? null : (
              <ShowMore theme={theme} count={Math.min(DONE_SHOWN, older)} onPress={() => setDoneLimit(doneLimit + DONE_SHOWN)} />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}
