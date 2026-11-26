/**
 * The FirstMate screen's main pane: what the captain and the first mate are talking about, one topic per
 * backlog item. Two views behind one switch: the board (`./topics-board`), with one topic opened from it
 * (`./topic-detail`), and the general chat, which is the first mate's conversation without the messages
 * filed under a topic.
 *
 * The switch is the first thing in the pane's bar and nothing before it changes width, so it stays where
 * it is whichever view shows. The screen keeps the view and the open topic, since its own buttons change
 * them too: showing the general chat closes the topic.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import type { AgentSummary, CardAction, Fleet, FleetCard } from "../shared/fleet";
import type { MateAsk } from "./card-answer";
import { MateChat } from "./chat";
import { findOpenCard, openId, readPatch } from "./format";
import { mateReplyText } from "./reply-target";
import { TopicDetail } from "./topic-detail";
import { readKey } from "./topic-format";
import { TopicsBoard } from "./topics-board";
import { FONT_SIZE } from "./type-scale";
import { IconButton, Segmented } from "./ui";

export type TopicsView = "board" | "general";

/** An open topic, by `openId`, and its task id then: `findOpenCard` needs both once a line gains an agent. */
export interface OpenTopic {
  id: string;
  taskId: string | null;
}

const NOTHING_READ: Readonly<Record<string, string>> = {};

const VIEWS: ReadonlyArray<{ value: TopicsView; label: string }> = [
  { value: "board", label: "Board" },
  { value: "general", label: "General chat" },
];

export function TopicsMain({
  fleet,
  mate,
  theme,
  compact,
  narrow,
  hostLabel,
  view,
  onView,
  open,
  onOpen,
  pollSeconds,
  hiddenChatKinds,
  topicsRead,
  onRead,
  toMate,
  onOpenAgent,
  onOpenFile,
  onChanged,
}: {
  fleet: Fleet;
  mate: AgentSummary;
  theme: PluginTheme;
  /** A phone: Enter adds a line and the board leaves Done out. */
  compact: boolean;
  /** A phone, or a pane too narrow for four columns: the board is one list and a topic shows one part at a time. */
  narrow: boolean;
  hostLabel: string;
  view: TopicsView;
  /** Shows a view, which closes the open topic. */
  onView: (view: TopicsView) => void;
  open: OpenTopic | null;
  onOpen: (open: OpenTopic | null) => void;
  pollSeconds: number;
  hiddenChatKinds: readonly string[];
  /** When the captain last had each topic open, by `readKey`; null until the saved map has loaded. */
  topicsRead: Readonly<Record<string, string>> | null;
  /** Saves the read map with a topic read further. */
  onRead: (topicsRead: Record<string, string>) => void;
  toMate: MateAsk;
  /** Shows an agent in Paseo itself; null where the host cannot. */
  onOpenAgent: ((agentId: string) => void) | null;
  onOpenFile: (path: string) => void;
  onChanged: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);

  function setOpen(card: FleetCard | null): void {
    const id = card === null ? null : openId(card);
    onOpen(id === null ? null : { id, taskId: card?.taskId ?? null });
    setShowInfo(false);
  }

  const cards = fleet.cards;
  const openCard = open === null ? null : findOpenCard(cards, open.id, open.taskId);
  // A topic that has left the board closes, rather than leaving an empty view behind.
  useEffect(() => {
    if (open !== null && openCard === null) setOpen(null);
  }, [open, openCard]);

  const openKey = openCard === null ? null : readKey(openCard);
  const openLastAt = openCard?.lastMessage?.at;
  useEffect(() => {
    if (topicsRead === null || openKey === null || openLastAt === undefined) return;
    const next = readPatch(topicsRead, openKey, openLastAt);
    if (next !== null) onRead(next);
  }, [openKey, openLastAt, topicsRead]);

  /** Every topic on the board has a thread here, so the general chat leaves all of their messages to them. */
  const threads = useMemo(
    () => new Set(cards.flatMap((card) => (card.backlog === null ? [] : [card.backlog.id]))),
    [cards],
  );

  /** Tagged, so the exchange is filed with the topic; the captain stays on the board to answer the next one. */
  function answer(card: FleetCard, action: CardAction): void {
    const topicId = card.backlog?.id;
    const text = topicId === undefined ? action.prompt : mateReplyText(topicId, action.prompt);
    toMate.send(text, undefined, onChanged, { keepTab: true });
  }

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      pane: { flex: 1, minHeight: 0 },
      bar: {
        minHeight: 44,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingHorizontal: narrow ? 10 : 14,
        paddingVertical: 7,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      title: { flexShrink: 1, color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" as const },
      spacer: { flex: 1 },
      host: {
        color: colors.foregroundMuted,
        fontSize: FONT_SIZE.caption,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 2,
      },
      body: { flex: 1, minHeight: 0 },
    };
  }, [theme, narrow]);

  const openAgentId = openCard?.agent?.id;

  return (
    <View style={styles.pane}>
      <View style={styles.bar}>
        {/* A narrow bar has no room for the switch beside an open topic's name; Board is one press back. */}
        {narrow && openCard !== null ? null : (
          <Segmented theme={theme} quiet value={openCard === null ? view : null} options={VIEWS} onChange={onView} />
        )}
        {openCard === null ? null : (
          <>
            <IconButton icon="ArrowLeft" label="Board" showLabel theme={theme} onPress={() => setOpen(null)} />
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {openCard.title}
            </Text>
          </>
        )}
        <View style={styles.spacer} />
        {narrow && openCard !== null ? (
          <IconButton
            icon={showInfo ? "MessageSquare" : "Info"}
            label={showInfo ? "Messages" : "Details"}
            showLabel
            theme={theme}
            onPress={() => setShowInfo(!showInfo)}
          />
        ) : (
          <Text style={styles.host} numberOfLines={1}>
            {narrow ? hostLabel : `Host: ${hostLabel}`}
          </Text>
        )}
      </View>
      <View style={styles.body}>
        {openCard !== null ? (
          <TopicDetail
            key={open?.id}
            card={openCard}
            theme={theme}
            compact={compact}
            narrow={narrow}
            showInfo={showInfo}
            pollSeconds={pollSeconds}
            toMate={toMate}
            onAnswer={(action) => answer(openCard, action)}
            onOpenAgent={openAgentId === undefined || onOpenAgent === null ? null : () => onOpenAgent(openAgentId)}
            onChanged={onChanged}
          />
        ) : view === "board" ? (
          <TopicsBoard
            cards={cards}
            theme={theme}
            compact={compact}
            narrow={narrow}
            topicsRead={topicsRead ?? NOTHING_READ}
            sending={toMate.sending}
            onOpen={setOpen}
            onAnswer={answer}
          />
        ) : (
          <MateChat
            key={mate.id}
            mate={mate}
            theme={theme}
            compact={compact}
            hiddenKinds={hiddenChatKinds}
            threads={threads}
            onChanged={onChanged}
            onOpenFile={onOpenFile}
          />
        )}
      </View>
    </View>
  );
}
