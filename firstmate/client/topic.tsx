/**
 * One backlog item with no agent of its own, opened without leaving FirstMate: its card, and beside it
 * the thread of messages the daemon filed under it — the captain's words and the first mate's replies —
 * with the box that sends the next one, to the first mate, under the item's tag.
 *
 * Like `CrewmateView` it takes the board's place, so the main pane stays beside it, and
 * its card sits above the thread on a phone. The thread is the daemon's (`firstmate.topic.messages`),
 * not the chat's tail, so it holds more than the chat's tail does.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import type { FleetCard } from "../shared/fleet";
import { CrewCard } from "./card";
import type { MateAsk } from "./card-answer";
import { useFollowEnd } from "./follow-end";
import { Markdown } from "./markdown";
import { ReplyBox } from "./reply-box";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { CaptainBubble, IconButton, JumpToEnd, errorText } from "./ui";
import { topicMessagesKey, useTopicMessages } from "./use-topic-messages";

/** Below this width the card sits above the thread instead of beside it. */
const SIDE_BY_SIDE_WIDTH = 680;
const CARD_COLUMN_WIDTH = 300;

export function TopicView({
  card,
  topicId,
  theme,
  compact,
  pollSeconds,
  onBack,
  onChanged,
  toMate,
}: {
  card: FleetCard;
  /** The backlog item the thread is filed under. */
  topicId: string;
  theme: PluginTheme;
  compact: boolean;
  /** How often the fleet is polled; the thread is read as often. */
  pollSeconds: number;
  onBack: () => void;
  onChanged: () => void;
  toMate: MateAsk | null;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [width, setWidth] = useState(0);
  const sideBySide = !compact && width >= SIDE_BY_SIDE_WIDTH;
  const follow = useFollowEnd();
  const queryKey = topicMessagesKey(topicId);
  const thread = useTopicMessages(topicId, pollSeconds);
  const messages = thread.data?.messages ?? [];
  const notes = card.backlog?.notes ?? [];

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      screen: { flex: 1, minHeight: 0 },
      bar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: compact ? 10 : 12,
        paddingTop: compact ? 0 : 12,
        paddingBottom: 8,
      },
      title: { flex: 1, color: colors.foreground, fontSize: FONT_SIZE.content, fontWeight: "600" as const },
      body: { flex: 1, minHeight: 0, paddingHorizontal: compact ? 10 : 12, paddingBottom: compact ? 10 : 12, gap: 10 },
      bodySide: { flexDirection: "row" as const },
      cardColumn: { width: CARD_COLUMN_WIDTH, flexGrow: 0, flexShrink: 0 },
      // Its natural height, never squeezed by the thread; a tall one scrolls inside this share.
      cardStacked: { flexGrow: 0, flexShrink: 0, maxHeight: "45%" as const },
      notes: { gap: 4, paddingTop: 8 },
      note: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      threadFrame: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: colors.surface1,
        overflow: "hidden" as const,
      },
      thread: { flex: 1, minHeight: 0 },
      messages: { padding: compact ? 10 : 14, gap: 10 },
      error: { color: colors.statusDanger, fontSize: FONT_SIZE.small },
      hint: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, textAlign: "center" as const, padding: 16 },
    };
  }, [theme, compact]);

  function openLink(url: string): void {
    void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
  }

  function sent(): void {
    void queryClient.invalidateQueries({ queryKey });
    onChanged();
  }

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <IconButton icon="ChevronLeft" label="Crew" showLabel theme={theme} onPress={onBack} />
        <Text style={styles.title} numberOfLines={1}>
          {card.title}
        </Text>
      </View>
      <View
        style={[styles.body, sideBySide ? styles.bodySide : null]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        <ScrollView
          style={sideBySide ? styles.cardColumn : styles.cardStacked}
          // The answer box is in here; on iOS the system scrolls the focused one into view.
          automaticallyAdjustKeyboardInsets
        >
          <CrewCard card={card} theme={theme} compact={compact} opener={null} onChanged={onChanged} toMate={toMate} hideAnswer startExpanded={!compact} />
          {notes.length === 0 ? null : (
            <View style={styles.notes}>
              {notes.map((note, index) => (
                <Text key={`${index}:${note}`} style={styles.note}>
                  {note}
                </Text>
              ))}
            </View>
          )}
        </ScrollView>
        <View style={styles.threadFrame}>
          <View style={styles.thread}>
            <ScrollView {...follow.scrollProps} style={styles.thread} contentContainerStyle={styles.messages}>
              {thread.error === null ? null : <Text style={styles.error}>{errorText(thread.error)}</Text>}
              {messages.length === 0 ? (
                <Text style={styles.hint}>
                  {thread.isPending ? "Loading the thread…" : "Nothing has been said about this item yet."}
                </Text>
              ) : (
                messages.map((message) =>
                  message.from === "captain" ? (
                    <CaptainBubble key={message.id} theme={theme} text={message.text} />
                  ) : (
                    <View key={message.id} style={{ alignSelf: "stretch" }}>
                      <Markdown source={message.text} theme={theme} onOpenLink={openLink} />
                    </View>
                  ),
                )
              )}
            </ScrollView>
            {follow.away ? <JumpToEnd theme={theme} onPress={follow.jumpToEnd} /> : null}
          </View>
          <ReplyBox
            target={{ kind: "mate", topicId }}
            theme={theme}
            compact={compact}
            toMate={toMate}
            onSent={() => {
              follow.pin();
              sent();
            }}
          />
        </View>
      </View>
    </View>
  );
}
