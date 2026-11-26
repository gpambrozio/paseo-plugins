/**
 * One topic, opened from the board of topics: its thread on the left — who said each message, the captain's
 * on the right — over the box that sends the next one and says who gets it, and beside it the topic's
 * details: where it stands, who it talks to, its links, what it waits for, the first mate's notes.
 *
 * The thread is the messages the first mate's conversation filed under the topic, and, for a topic with
 * its own agent, that agent's conversation with the captain, read live from its timeline. On a phone the
 * details take the thread's place while `showInfo` is set.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { CardAction, FleetCard } from "../shared/fleet";
import type { TopicMessage } from "../shared/topics";
import { cardActions, type MateAsk } from "./card-answer";
import { CAPTAIN_COLUMN_TITLES, captainColumn } from "./format";
import { useFollowEnd } from "./follow-end";
import { Markdown } from "./markdown";
import { PermissionCard, usePendingRequests } from "./permission-card";
import { ReplyBox } from "./reply-box";
import { replyTarget } from "./reply-target";
import { ThreadBubble } from "./thread-bubble";
import { AnswerButtons } from "./topic-card";
import { shortDate, talkingTo, threadMessages, topicAsk } from "./topic-format";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton, JumpToEnd, errorText } from "./ui";
import { useAgentTimeline } from "./use-timeline";
import { topicMessagesKey, useTopicMessages } from "./use-topic-messages";

const INFO_WIDTH = 260;

/** A link as the info panel writes it: a GitHub address without its host, any other as it is. */
function linkText(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?github\.com\//, "");
}

export function TopicDetail({
  card,
  theme,
  compact,
  narrow,
  showInfo,
  pollSeconds,
  toMate,
  onAnswer,
  onOpenAgent,
  onChanged,
}: {
  card: FleetCard;
  theme: PluginTheme;
  /** A phone: Enter adds a line in the reply box. */
  compact: boolean;
  /** Too narrow for the thread and the details side by side. */
  narrow: boolean;
  /** In a narrow layout, draws the details in the thread's place. A wide layout always draws both. */
  showInfo: boolean;
  /** How often the fleet is polled; the filed messages are read as often. */
  pollSeconds: number;
  toMate: MateAsk | null;
  onAnswer: (action: CardAction) => void;
  /** Shows the topic's agent in Paseo itself; null where the host cannot, or the topic has none. */
  onOpenAgent: (() => void) | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const follow = useFollowEnd();
  const topicId = card.backlog?.id ?? null;
  const agent = card.agent;
  const filed = useTopicMessages(topicId, pollSeconds);
  const timeline = useAgentTimeline(agent?.id ?? null, agent === null ? "" : `${agent.updatedAt}:${agent.pendingPermissions}`);
  /** What the topic's agent asks leave for, answered here as its own tab would answer it. */
  const { pending, respond } = usePendingRequests(agent?.id ?? "", timeline.agent?.pendingPermissions, follow.pin);
  const messages = useMemo(
    () => threadMessages(filed.data?.messages ?? [], timeline.entries, agent?.id ?? ""),
    [filed.data, timeline.entries, agent?.id],
  );
  const target = replyTarget(card);
  const ask = topicAsk(card);
  const notes = card.backlog?.notes ?? [];
  const loading = (topicId !== null && filed.isPending) || timeline.loading;
  const problem = filed.error !== null ? errorText(filed.error) : timeline.error;

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      screen: { flex: 1, minHeight: 0, flexDirection: "row" as const, gap: 14, padding: narrow ? 0 : 14 },
      thread: { flex: 1, minWidth: 0, minHeight: 0 },
      scroller: { flex: 1 },
      messages: { padding: narrow ? 10 : 0, paddingBottom: 12, gap: 12 },
      hint: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, textAlign: "center" as const, padding: 16 },
      error: { color: colors.statusDanger, fontSize: FONT_SIZE.small },
      info: narrow
        ? { flex: 1 }
        : {
            width: INFO_WIDTH,
            flexGrow: 0,
            flexShrink: 0,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            backgroundColor: colors.surface1,
          },
      infoBody: { padding: 12, gap: 8 },
      infoTitle: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "600" as const },
      field: { gap: 1 },
      term: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      value: { color: colors.foreground, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
      link: { color: colors.accent, fontSize: FONT_SIZE.caption, textDecorationLine: "underline" as const },
      ask: { color: colors.statusWarning, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
      notes: { gap: 3 },
      buttons: { paddingTop: 4 },
    };
  }, [theme, narrow]);

  function openLink(url: string): void {
    void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
  }

  function who(message: TopicMessage): string {
    if (message.from === "captain") return "You";
    return message.from === "mate" ? "First mate" : (agent?.title ?? "Agent");
  }

  function field(term: string, value: ReactNode) {
    return (
      <View style={styles.field}>
        <Text style={styles.term}>{term}</Text>
        {typeof value === "string" ? (
          <Text selectable style={styles.value}>
            {value}
          </Text>
        ) : (
          value
        )}
      </View>
    );
  }

  const url = card.url;
  const since = card.backlog?.since ?? null;
  const info = (
    <ScrollView style={styles.info} contentContainerStyle={styles.infoBody}>
      <Text style={styles.infoTitle}>{card.title}</Text>
      {field("Status", CAPTAIN_COLUMN_TITLES[captainColumn(card)])}
      {card.project === null ? null : field("Project", card.project)}
      {field("Talking to", talkingTo(card))}
      {since === null ? null : field("Since", shortDate(since))}
      {url === null
        ? null
        : field(
            "Links",
            <Pressable accessibilityRole="link" accessibilityLabel={`Open ${url}`} onPress={() => openLink(url)}>
              <Text style={styles.link}>{linkText(url)}</Text>
            </Pressable>,
          )}
      {ask === null
        ? null
        : field(
            "Waiting on you",
            <View>
              <Text style={styles.ask}>{ask}</Text>
              <View style={styles.buttons}>
                <AnswerButtons actions={cardActions(card)} theme={theme} disabled={toMate?.sending ?? true} onAnswer={onAnswer} />
              </View>
            </View>,
          )}
      {notes.length === 0
        ? null
        : field(
            "Notes",
            <View style={styles.notes}>
              {notes.map((note, index) => (
                <Text key={`${index}:${note}`} selectable style={styles.value}>
                  {note}
                </Text>
              ))}
            </View>,
          )}
      {card.taskId === null ? null : field("Backlog id", card.taskId)}
      {onOpenAgent === null ? null : (
        <View style={[styles.buttons, { alignItems: "flex-start" }]}>
          <IconButton icon="ExternalLink" label="Open agent in Paseo" showLabel theme={theme} onPress={onOpenAgent} />
        </View>
      )}
    </ScrollView>
  );

  if (narrow && showInfo) return <View style={styles.screen}>{info}</View>;

  return (
    <View style={styles.screen}>
      <View style={styles.thread}>
        <View style={styles.scroller}>
          <ScrollView {...follow.scrollProps} style={styles.scroller} contentContainerStyle={styles.messages}>
            {problem === null ? null : <Text style={styles.error}>{problem}</Text>}
            {messages.length === 0 && pending.length === 0 ? (
              <Text style={styles.hint}>{loading ? "Loading the topic…" : "Nothing has been said about this topic yet."}</Text>
            ) : (
              messages.map((message) => (
                <ThreadBubble key={message.id} theme={theme} who={who(message)} mine={message.from === "captain"}>
                  {message.from === "captain" ? message.text : <Markdown source={message.text} theme={theme} onOpenLink={openLink} />}
                </ThreadBubble>
              ))
            )}
            {pending.map((request) => (
              // A direct child of the thread, so its layout is in the thread's coordinates.
              <View key={request.id} onLayout={(event) => follow.reveal(request.id, event.nativeEvent.layout)}>
                <PermissionCard
                  request={request}
                  who={agent?.title ?? "The agent"}
                  theme={theme}
                  compact={compact}
                  onRespond={(response) => respond(request.id, response)}
                  onOpenLink={openLink}
                />
              </View>
            ))}
          </ScrollView>
          {follow.away ? <JumpToEnd theme={theme} onPress={follow.jumpToEnd} /> : null}
        </View>
        {target === null ? null : (
          <ReplyBox
            target={target}
            theme={theme}
            compact={compact}
            toMate={toMate}
            onSent={() => {
              follow.pin();
              void queryClient.invalidateQueries({ queryKey: topicMessagesKey(topicId) });
              onChanged();
            }}
          />
        )}
      </View>
      {narrow ? null : info}
    </View>
  );
}
