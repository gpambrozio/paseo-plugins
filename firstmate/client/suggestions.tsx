/**
 * The first mate's suggestions: one button per next step it wrote in
 * `data/suggestions.md`, each showing its label and the start of the words it
 * puts in the composer. Pressing one never sends anything; the caller puts
 * the prompt in the draft and brings the chat into view.
 *
 * Drawn as a card among the board's columns on a wide layout, and as the
 * Suggestions tab on a phone.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import type { Suggestion } from "../shared/fleet";

export const SUGGESTIONS_TITLE = "Suggestions";
export const SUGGESTIONS_ICON = "Lightbulb";

export function SuggestionList({
  suggestions,
  theme,
  onPick,
}: {
  suggestions: readonly Suggestion[];
  theme: PluginTheme;
  /** Puts the prompt in the composer. */
  onPick: (prompt: string) => void;
}) {
  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      list: { gap: 8 },
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        backgroundColor: colors.surface2,
        paddingHorizontal: 10,
        paddingVertical: 8,
      },
      text: { flex: 1, minWidth: 0, gap: 2 },
      label: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
      prompt: { color: colors.foregroundMuted, fontSize: 12 },
    };
  }, [theme]);

  return (
    <View style={styles.list}>
      {suggestions.map((suggestion, index) => (
        <Pressable
          key={`${index}:${suggestion.label}`}
          accessibilityRole="button"
          accessibilityLabel={`${suggestion.label}: put "${suggestion.prompt}" in the message to the first mate`}
          style={styles.button}
          onPress={() => onPick(suggestion.prompt)}
        >
          <View style={styles.text}>
            <Text style={styles.label} numberOfLines={1}>
              {suggestion.label}
            </Text>
            <Text style={styles.prompt} numberOfLines={2}>
              {suggestion.prompt}
            </Text>
          </View>
          <Icon name="CornerDownLeft" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
      ))}
    </View>
  );
}
