/**
 * The GitHub card that opens the transcript of an agent this board launched.
 *
 * The row itself is written by `sendToChatHandler` and persisted by the daemon;
 * this is only its renderer. That split is why the schema is re-validated here
 * rather than trusted: the host hands back whatever JSON was stored, including
 * rows written by an older build of this plugin, so `BoardTimelineItemSchema`
 * is the boundary. A row that fails it renders as nothing, which is the same
 * outcome as never having appended one.
 */
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import type { BoardTimelineItem } from "../shared/board";
import { openExternalUrl } from "./web";

/**
 * Enough labels to characterise the card, not enough to wrap the row twice.
 * The transcript is a reading column, and a card carrying fifteen labels would
 * otherwise push the agent's first reply off the screen.
 */
const MAX_LABELS = 4;

export function BoardTimelineCard({
  theme,
  layout,
  item,
}: PluginTimelineItemProps<BoardTimelineItem>) {
  const { repository, number, title, url, author, labels } = item.data;

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
      slug: { color: colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
      title: {
        color: colors.foreground,
        fontSize: layout.compact ? 15 : 14,
        lineHeight: layout.compact ? 21 : 20,
        fontWeight: "600" as const,
      },
      footer: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
        gap: 6,
      },
      author: { color: colors.foregroundMuted, fontSize: 11 },
      label: {
        color: colors.foregroundMuted,
        fontSize: 11,
        overflow: "hidden" as const,
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderWidth: 1,
        borderColor: colors.border,
      },
    };
  }, [theme, layout]);

  const shown = labels.slice(0, MAX_LABELS);
  const hidden = labels.length - shown.length;

  return (
    <Pressable
      style={styles.card}
      accessibilityRole="link"
      accessibilityLabel={`${repository} #${number}: ${title}`}
      onPress={() => openExternalUrl(url)}
    >
      <View style={styles.header}>
        <Icon name="Github" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.slug} numberOfLines={1}>
          {repository} #{number}
        </Text>
      </View>

      <Text style={styles.title} numberOfLines={3}>
        {title}
      </Text>

      {author === null && shown.length === 0 ? null : (
        <View style={styles.footer}>
          {author === null ? null : <Text style={styles.author}>@{author}</Text>}
          {/* `.map`, not `for…of`: a closure in a loop body would capture the
              loop binding's final value in an eval'd bundle. */}
          {shown.map((label) => (
            <Text key={label} style={styles.label} numberOfLines={1}>
              {label}
            </Text>
          ))}
          {hidden > 0 ? <Text style={styles.author}>+{hidden}</Text> : null}
        </View>
      )}
    </Pressable>
  );
}
