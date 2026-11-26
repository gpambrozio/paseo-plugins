/**
 * One message of a topic's thread or of the general chat: who said it, over a bubble with the words. The captain's
 * sit on the right in the accent colour, everyone else's on the left.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";

import { FONT_SIZE, lineHeightFor } from "./type-scale";

export function ThreadBubble({
  theme,
  who,
  mine,
  children,
}: {
  theme: PluginTheme;
  who: string;
  /** The captain's own message. */
  mine: boolean;
  /** The words: a string for the captain's, anything else — Markdown — drawn as given. */
  children: ReactNode;
}) {
  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      message: { maxWidth: "86%" as const, gap: 2 },
      mine: { alignSelf: "flex-end" as const, alignItems: "flex-end" as const },
      theirs: { alignSelf: "flex-start" as const },
      who: { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro },
      bubble: { borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: colors.surface2 },
      myBubble: { backgroundColor: colors.accent },
      myText: { color: colors.accentForeground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) },
    };
  }, [theme]);

  return (
    <View style={[styles.message, mine ? styles.mine : styles.theirs]}>
      <Text style={styles.who}>{who}</Text>
      <View style={[styles.bubble, mine ? styles.myBubble : null]}>
        {typeof children === "string" ? (
          <Text selectable style={styles.myText}>
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}
