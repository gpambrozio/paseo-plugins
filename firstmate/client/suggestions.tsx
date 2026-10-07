/**
 * The first mate's suggestions: one button per next step it wrote in
 * `data/suggestions.md`, each showing its label and the start of the words it
 * sends. Pressing one sends them to the first mate straight away; the caller
 * does that and brings the chat into view. Each has a trash button beside it,
 * which takes that one line out of the file without sending anything.
 *
 * A card cuts a long label to one line and its prompt to two. A chevron beside
 * the trash, shown only when something is cut (`./suggestion-fold`), opens the
 * whole suggestion below the card, wrapped and selectable, without sending it.
 *
 * Drawn as a card among the board's columns on a wide layout, and as the
 * Suggestions tab on a phone.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";

import type { Suggestion } from "../shared/fleet";
import { chevronLabel, isCut, showsChevron } from "./suggestion-fold";
import { suggestionRemovals } from "./suggestion-removals";
import { FONT_SIZE } from "./type-scale";

export const SUGGESTIONS_TITLE = "Suggestions";
export const SUGGESTIONS_ICON = "Lightbulb";

type CardStyles = ReturnType<typeof cardStyles>;

function cardStyles(theme: PluginTheme, disabled: boolean) {
  const { colors } = theme;
  const text = { flex: 1, minWidth: 0, gap: 2 };
  return {
    list: { gap: 8 },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surface2,
    },
    row: { flexDirection: "row" as const, alignItems: "center" as const },
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
    chevron: { alignSelf: "stretch" as const, justifyContent: "center" as const, paddingHorizontal: 6 },
    trash: { alignSelf: "stretch" as const, justifyContent: "center" as const, paddingLeft: 6, paddingRight: 10 },
    text: { ...text, overflow: "hidden" as const },
    // The same text unclamped, laid out at the same width and never seen, to measure against.
    whole: { ...text, position: "absolute" as const, top: 0, left: 0, right: 0, opacity: 0 },
    label: { color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" as const },
    prompt: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small },
    full: {
      color: colors.foregroundMuted,
      fontSize: FONT_SIZE.small,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
  };
}

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
  const styles = useMemo(() => cardStyles(theme, disabled), [theme, disabled]);

  function remove(suggestion: Suggestion): void {
    // The board's own handler reports a failure; the gate only needs to reopen once it settles.
    void gate.run(suggestion, () => onRemove(suggestion));
  }

  return (
    <View style={styles.list}>
      {suggestions.map((suggestion, index) => (
        <SuggestionCard
          key={`${index}:${suggestion.label}`}
          suggestion={suggestion}
          theme={theme}
          styles={styles}
          disabled={disabled}
          busy={gate.pending(suggestion)}
          onPick={() => onPick(suggestion.prompt)}
          onRemove={() => remove(suggestion)}
        />
      ))}
    </View>
  );
}

function SuggestionCard({
  suggestion,
  theme,
  styles,
  disabled,
  busy,
  onPick,
  onRemove,
}: {
  suggestion: Suggestion;
  theme: PluginTheme;
  styles: CardStyles;
  disabled: boolean;
  busy: boolean;
  onPick: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Heights of the folded text as shown and laid out whole; both come back with every change of width.
  const [shown, setShown] = useState<number | null>(null);
  const [whole, setWhole] = useState<number | null>(null);
  const muted = theme.colors.foregroundMuted;

  return (
    <View style={[styles.card, busy ? { opacity: 0.5 } : null]}>
      <View style={styles.row}>
        {/* The chevron and the trash are the send button's siblings, not its children, so neither presses it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${suggestion.label}: send "${suggestion.prompt}" to the first mate`}
          accessibilityState={{ disabled: disabled || busy }}
          disabled={disabled || busy}
          style={styles.button}
          onPress={onPick}
        >
          {expanded ? (
            <View style={styles.text}>
              <Text style={styles.label}>{suggestion.label}</Text>
            </View>
          ) : (
            <View style={styles.text} onLayout={(event) => setShown(event.nativeEvent.layout.height)}>
              <Text style={styles.label} numberOfLines={1}>
                {suggestion.label}
              </Text>
              <Text style={styles.prompt} numberOfLines={2}>
                {suggestion.prompt}
              </Text>
              <View
                style={styles.whole}
                pointerEvents="none"
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                onLayout={(event) => setWhole(event.nativeEvent.layout.height)}
              >
                <Text style={styles.label}>{suggestion.label}</Text>
                <Text style={styles.prompt}>{suggestion.prompt}</Text>
              </View>
            </View>
          )}
          <Icon name="Send" size={14} color={muted} />
        </Pressable>
        {showsChevron(expanded, isCut(shown, whole)) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chevronLabel(expanded, suggestion.label)}
            accessibilityState={{ expanded }}
            aria-expanded={expanded}
            style={styles.chevron}
            onPress={() => setExpanded(!expanded)}
          >
            <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={14} color={muted} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove suggestion: ${suggestion.label}`}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          hitSlop={6}
          style={styles.trash}
          onPress={onRemove}
        >
          <Icon name="Trash2" size={14} color={muted} />
        </Pressable>
      </View>
      {expanded ? (
        <Text style={styles.full} selectable>
          {suggestion.prompt}
        </Text>
      ) : null}
    </View>
  );
}
