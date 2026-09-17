/**
 * A settings row that opens the summary prompt for editing. The host's
 * `SettingsInput` is a single line, so — as with `client/option-picker.tsx` —
 * the editor is a host `Modal` with scrolling off, holding a multiline host
 * `TextInput` that takes the whole body.
 *
 * The draft is local until *Save*, so *Cancel* really cancels, and the daemon
 * is not written on every keystroke. Saving an empty prompt is saving the
 * default one; there is no such thing as no prompt.
 *
 * Async function expressions only; see `client/herald.tsx`.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { SettingsRow } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { DEFAULT_SUMMARY_PROMPT, PROMPT_PLACEHOLDERS } from "../shared/herald";

interface PromptEditorProps {
  label: string;
  hint?: string;
  /** The template as saved. Empty means the default one is in use. */
  value: string;
  disabled?: boolean;
  onSave(next: string): void;
  theme: PluginTheme;
  compact: boolean;
}

function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;
}

export function isDefaultPrompt(value: string): boolean {
  return value.trim() === "" || value.trim() === DEFAULT_SUMMARY_PROMPT.trim();
}

/**
 * What the model is asked to answer with is what `parseSummaryText` reads, so
 * a prompt that stopped asking for it is worth a word — but not a refusal: the
 * parser falls back to the reply as prose, which is a working, if less
 * predictable, summary.
 */
function promptWarning(draft: string): string | null {
  if (draft.trim() === "") return null;
  if (draft.includes("speech")) return null;
  return 'This prompt no longer asks for a JSON object with a "speech" key. Herald will speak whatever the model replies, trimmed to the first 45 words.';
}

export function PromptEditor(props: PromptEditorProps) {
  const { theme, compact, value, onSave } = props;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const styles = useMemo(() => {
    const { colors } = theme;
    const separator = withAlpha(colors.foregroundMuted, "33");
    return {
      trigger: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: separator,
        backgroundColor: colors.surface1,
      },
      triggerText: { color: colors.foreground, fontSize: 13 },
      triggerDisabled: { opacity: 0.5 },
      body: { flex: 1 },
      content: { flex: 1, padding: compact ? 12 : 16, gap: 10 },
      editor: {
        flex: 1,
        minHeight: 180,
        color: colors.foreground,
        fontSize: 13,
        lineHeight: 19,
        fontFamily: "monospace" as const,
        textAlignVertical: "top" as const,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: separator,
        backgroundColor: colors.surface1,
      },
      legend: { maxHeight: compact ? 120 : 160 },
      legendTitle: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
      legendNote: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      legendRow: { flexDirection: "row" as const, gap: 8, paddingVertical: 3 },
      legendName: { color: colors.accent, fontSize: 12, fontFamily: "monospace" as const, width: 108 },
      legendText: { color: colors.foregroundMuted, fontSize: 12, flex: 1, lineHeight: 17 },
      warning: { color: colors.statusWarning, fontSize: 12, lineHeight: 17 },
      buttons: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      spacer: { flex: 1 },
      button: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: separator,
        backgroundColor: colors.surface1,
      },
      buttonText: { color: colors.foreground, fontSize: 13 },
      primary: { backgroundColor: colors.accent, borderColor: colors.accent },
      primaryText: { color: colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
    };
  }, [theme, compact]);

  const warning = promptWarning(draft);

  return (
    <>
      <SettingsRow label={props.label} {...(props.hint === undefined ? {} : { hint: props.hint })}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.label}: ${isDefaultPrompt(value) ? "the default" : "customised"}. Edit`}
          disabled={props.disabled === true}
          onPress={() => {
            setDraft(value.trim() === "" ? DEFAULT_SUMMARY_PROMPT : value);
            setOpen(true);
          }}
          style={[styles.trigger, props.disabled === true ? styles.triggerDisabled : null]}
        >
          <Text style={styles.triggerText}>{isDefaultPrompt(value) ? "Default — edit…" : "Customised — edit…"}</Text>
        </Pressable>
      </SettingsRow>
      <Modal title={props.label} open={open} onOpenChange={setOpen}>
        <Modal.Content scrollable={false} style={styles.body} contentContainerStyle={styles.content}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            placeholder={DEFAULT_SUMMARY_PROMPT}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.editor}
          />
          <ScrollView style={styles.legend}>
            <Text style={styles.legendTitle}>Placeholders</Text>
            <Text style={styles.legendNote}>
              Herald fills each of these in before sending the prompt. A line whose placeholder has
              nothing to fill it for that event is left out whole, so a label and its placeholder
              belong on one line. Anything else in double braces is sent as you typed it.
            </Text>
            {PROMPT_PLACEHOLDERS.map((placeholder) => (
              <View key={placeholder.name} style={styles.legendRow}>
                <Text style={styles.legendName}>{`{{${placeholder.name}}}`}</Text>
                <Text style={styles.legendText}>{placeholder.description}</Text>
              </View>
            ))}
          </ScrollView>
          {warning === null ? null : <Text style={styles.warning}>{warning}</Text>}
          <View style={styles.buttons}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setDraft(DEFAULT_SUMMARY_PROMPT)}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Restore the default</Text>
            </Pressable>
            <View style={styles.spacer} />
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.button}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onSave(isDefaultPrompt(draft) ? "" : draft);
                setOpen(false);
              }}
              style={[styles.button, styles.primary]}
            >
              <Text style={styles.primaryText}>Save</Text>
            </Pressable>
          </View>
        </Modal.Content>
      </Modal>
    </>
  );
}
