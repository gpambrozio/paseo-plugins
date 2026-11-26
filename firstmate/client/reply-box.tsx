/**
 * The box under a card's thread or a crewmate's transcript: one line saying who gets the message, a text
 * box and Send. A card with an agent steers it directly; any other goes to the first mate through the
 * board's sender, tagged with the item's id so the board files it under the card (`./reply-target`).
 *
 * The half-typed text is kept on `globalThis`, as a card's answer is, so it outlives the surface being
 * unmounted. It stays in the box until the daemon has taken the message, and the box is disabled while
 * one is on its way; a failure toasts and leaves the text to send again.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Platform, SafeAreaView, Text, View } from "react-native";

import { steerCrew } from "../shared/fleet";
import type { MateAsk } from "./card-answer";
import { createDraftStore } from "./draft";
import { isSendKey, type WebKeyPressEvent } from "./keys";
import { useKeyboardOverlap } from "./keyboard";
import { mateReplyText, replyKey, replyLabel, type ReplyTarget } from "./reply-target";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton, errorText } from "./ui";

/** The same store every other draft is in; `replyKey`'s prefix keeps this box's slots to itself. */
const replies = createDraftStore(globalThis);

/** Fixed rather than grown with the text, for the reason the chat's composer is. */
const INPUT_HEIGHT = 72;
const INPUT_HEIGHT_COMPACT = 56;

export function ReplyBox({
  target,
  theme,
  compact,
  toMate,
  onSent,
}: {
  target: ReplyTarget;
  theme: PluginTheme;
  compact: boolean;
  /** The board's way to the first mate; a reply to the first mate cannot be sent without it. */
  toMate: MateAsk | null;
  /** After the daemon has taken a message, so the thread and the board catch up without waiting for a poll. */
  onSent: () => void;
}) {
  const steer = useRpc(steerCrew);
  const toast = useToast();
  const slot = replyKey(target);
  const text = useSyncExternalStore(replies.subscribe, () => replies.get(slot));
  const [steering, setSteering] = useState(false);
  const pane = useRef<View>(null);
  /** The keyboard's cover over this box; padding it away lifts the box above the keyboard. */
  const keyboard = useKeyboardOverlap(pane);

  const sending = steering || (target.kind === "mate" && (toMate?.sending ?? false));
  const canSend = !sending && text.trim() !== "" && (target.kind === "agent" || toMate !== null);
  const submitOnEnter = Platform.OS === "web" && !compact;

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      frame: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface0 },
      box: { padding: compact ? 8 : 10, gap: 6 },
      label: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      row: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: 8 },
      input: {
        flex: 1,
        minWidth: 0,
        color: colors.foreground,
        fontSize: FONT_SIZE.body,
        lineHeight: lineHeightFor(FONT_SIZE.body),
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        height: compact ? INPUT_HEIGHT_COMPACT : INPUT_HEIGHT,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: colors.surface1,
        textAlignVertical: "top" as const,
      },
    };
  }, [theme, compact]);

  function clearAndTell(): void {
    replies.set(slot, "");
    onSent();
  }

  function send(): void {
    const words = text.trim();
    if (words === "" || sending) return;
    if (target.kind === "agent") {
      setSteering(true);
      steer({ agentId: target.agentId, text: words })
        .then(clearAndTell)
        .catch((caught: unknown) => toast.error(errorText(caught)))
        .finally(() => setSteering(false));
      return;
    }
    toMate?.send(mateReplyText(target.topicId, words), undefined, clearAndTell, { keepTab: true });
  }

  return (
    <View ref={pane} style={{ paddingBottom: keyboard }}>
      {/* The host pads a surface's top but not its bottom; this is the chat composer's way clear of the home indicator. */}
      <SafeAreaView style={styles.frame}>
        <View style={styles.box}>
          <Text style={styles.label}>{replyLabel(target)}</Text>
          <View style={styles.row}>
            <TextInput
              value={text}
              onChangeText={(next) => replies.set(slot, next)}
              editable={!sending}
              placeholder={target.kind === "agent" ? "Tell the worker…" : "Tell the first mate…"}
              placeholderTextColor={theme.colors.foregroundMuted}
              accessibilityLabel={replyLabel(target)}
              multiline
              onKeyPress={
                submitOnEnter
                  ? (event: WebKeyPressEvent) => {
                      if (!isSendKey(event.nativeEvent) || !canSend) return;
                      event.preventDefault();
                      send();
                    }
                  : undefined
              }
              style={styles.input}
            />
            <IconButton icon="Send" label="Send" tone="accent" theme={theme} disabled={!canSend} onPress={send} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
