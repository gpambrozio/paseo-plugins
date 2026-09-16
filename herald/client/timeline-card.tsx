/**
 * Herald's card in an agent's transcript: the sentence written about the
 * turn or question just above it, and a play icon right after the header's
 * label that says it again — absent on iOS and Android, which cannot play it.
 *
 * The row is written by the daemon (`server/card.ts`); this only draws it.
 * The host re-validates `data` against `HeraldCardSchema` before calling this,
 * so an older row that no longer fits renders as unavailable rather than here.
 *
 * Async function expressions only; see `client/herald.tsx`.
 */
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import type { AttentionReason } from "../shared/herald";
import type { HeraldCard } from "../shared/timeline";
import { getAnnouncer } from "./announcer";
import { canPlaySpeech } from "./web";

function reasonLabel(reason: AttentionReason): string {
  switch (reason) {
    case "question":
      return "Question";
    case "plan":
      return "Plan to approve";
    case "permission":
      return "Permission";
    case "finished":
      return "Finished";
    case "error":
      return "Error";
    case "canceled":
      return "Interrupted";
  }
}

function spokenText(card: HeraldCard): string | null {
  switch (card.summary.status) {
    case "ready":
      return card.summary.text;
    case "failed":
      return card.summary.fallback;
    case "pending":
    case "off":
      return null;
  }
}

export function HeraldTimelineCard({ theme, layout, item }: PluginTimelineItemProps<HeraldCard>) {
  const card = item.data;
  const text = spokenText(card);
  const toast = useToast();
  const [speaking, setSpeaking] = useState(false);

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      card: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        backgroundColor: colors.surface1,
        paddingHorizontal: layout.compact ? 10 : 12,
        paddingVertical: layout.compact ? 8 : 10,
        gap: 6,
      },
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      brand: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      reason: { color: colors.foregroundMuted, fontSize: 12 },
      spacer: { flex: 1 },
      text: {
        color: colors.foreground,
        fontSize: layout.compact ? 15 : 14,
        lineHeight: layout.compact ? 21 : 20,
        fontStyle: "italic" as const,
      },
      pending: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      pendingText: { color: colors.foregroundMuted, fontSize: 13 },
      note: { color: colors.foregroundMuted, fontSize: 11 },
      play: { padding: 4 },
      playDisabled: { opacity: 0.4 },
    };
  }, [theme, layout.compact]);

  const play = useCallback(
    async function play() {
      const announcer = getAnnouncer();
      if (announcer === null || text === null) return;
      setSpeaking(true);
      try {
        await announcer.speakText(text);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setSpeaking(false);
      }
    },
    [text, toast],
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Icon name="Megaphone" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.brand}>Herald</Text>
        <Text style={styles.reason}>· {reasonLabel(card.reason)}</Text>
        {canPlaySpeech() ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={speaking ? "Speaking" : "Play the summary"}
            hitSlop={8}
            disabled={text === null || speaking}
            onPress={() => void play()}
            style={[styles.play, text === null || speaking ? styles.playDisabled : null]}
          >
            <Icon name={speaking ? "Volume2" : "Play"} size={14} color={theme.colors.foreground} />
          </Pressable>
        ) : null}
        <View style={styles.spacer} />
      </View>
      {card.summary.status === "pending" ? (
        <View style={styles.pending}>
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          <Text style={styles.pendingText}>Writing the summary…</Text>
        </View>
      ) : (
        <Text style={styles.text}>{text ?? card.headline}</Text>
      )}
      {card.summary.status === "failed" ? (
        <Text style={styles.note}>Summary failed: {card.summary.error}</Text>
      ) : null}
    </View>
  );
}
