/**
 * The first mate's suggestions: one button per next step it wrote in
 * `data/suggestions.md`, each showing its label and the start of the words it
 * sends. Pressing one sends them to the first mate straight away; the caller
 * does that and brings the chat into view. Each has a trash button beside it,
 * which takes that one line out of the file without sending anything.
 *
 * Drawn as a card among the board's columns on a wide layout, and as the
 * Suggestions tab on a phone.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";

import type { Suggestion } from "../shared/fleet";
import { suggestionRemovals } from "./suggestion-removals";

export const SUGGESTIONS_TITLE = "Suggestions";
export const SUGGESTIONS_ICON = "Lightbulb";

export function SuggestionList({
  suggestions,
  theme,
  disabled,
  onPick,
  onRemove,
}: {
  suggestions: readonly Suggestion[];
  theme: PluginTheme;
  /** A message is already on its way to the first mate. */
  disabled: boolean;
  /** Sends the prompt to the first mate. */
  onPick: (prompt: string) => void;
  /** Takes the suggestion out of the first mate's file; settles once the board has the new list. */
  onRemove: (suggestion: Suggestion) => Promise<void>;
}) {
  /** Suggestions whose removal is on its way, kept across this list's unmounts; see `./suggestion-removals`. */
  const gate = suggestionRemovals;
  useSyncExternalStore(gate.subscribe, gate.version);
  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      list: { gap: 8 },
      card: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        backgroundColor: colors.surface2,
      },
      button: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingLeft: 10,
        paddingRight: 4,
        paddingVertical: 8,
        opacity: disabled ? 0.5 : 1,
      },
      trash: { alignSelf: "stretch" as const, justifyContent: "center" as const, paddingLeft: 6, paddingRight: 10 },
      text: { flex: 1, minWidth: 0, gap: 2 },
      label: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
      prompt: { color: colors.foregroundMuted, fontSize: 12 },
    };
  }, [theme, disabled]);

  function remove(suggestion: Suggestion): void {
    // The board's own handler reports a failure; the gate only needs to reopen once it settles.
    void gate.run(suggestion, () => onRemove(suggestion));
  }

  return (
    <View style={styles.list}>
      {suggestions.map((suggestion, index) => {
        const busy = gate.pending(suggestion);
        return (
          // The trash is the card's sibling, not its child, so pressing it never presses the card.
          <View key={`${index}:${suggestion.label}`} style={[styles.card, busy ? { opacity: 0.5 } : null]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${suggestion.label}: send "${suggestion.prompt}" to the first mate`}
              accessibilityState={{ disabled: disabled || busy }}
              disabled={disabled || busy}
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
              <Icon name="Send" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove suggestion: ${suggestion.label}`}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              hitSlop={6}
              style={styles.trash}
              onPress={() => remove(suggestion)}
            >
              <Icon name="Trash2" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
