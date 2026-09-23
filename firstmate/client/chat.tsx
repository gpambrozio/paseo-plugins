/**
 * The conversation with the first mate: its transcript, folded to the words,
 * and a composer. The whole session — every tool call and its output — is
 * one press away in Paseo itself, which is what the Open button is for.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";

import { askMate, type AgentSummary } from "../shared/fleet";
import { ahoyPrompt, bearingsPrompt } from "./commands";
import { useFollowEnd } from "./follow-end";
import { isSendKey, type WebKeyPressEvent } from "./keys";
import { Markdown } from "./markdown";
import { PermissionCard, usePendingRequests } from "./permission-card";
import { transcriptRows, type TranscriptRow } from "./transcript-rows";
import { IconButton, JumpToEnd, MONOSPACE, errorText } from "./ui";
import { useKeyboardOverlap } from "./keyboard";
import { useAgentTimeline } from "./use-timeline";

/**
 * A half-typed message survives the surface unmounting, which it does every
 * time the captain opens a workspace. Not worth persisting; worth not losing.
 */
let cachedDraft = "";

/** A run of tool calls shows this many before folding the rest behind a count. */
const TOOL_RUN_VISIBLE = 2;

/**
 * The composer's height; longer text scrolls inside it. Fixed rather than
 * grown with the text: on the web renderer a textarea's reported content
 * height is never less than its own height, so a box sized from it can grow
 * but never shrink back.
 */
const INPUT_HEIGHT = 120;
const INPUT_HEIGHT_COMPACT = 80;


type Group = { key: string; row: TranscriptRow } | { key: string; tools: Extract<TranscriptRow, { kind: "tool" }>[] };

/** Consecutive tool rows become one group, so a supervision pass is a line, not a page. */
function groupRows(rows: readonly TranscriptRow[]): Group[] {
  const groups: Group[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (row.kind === "tool" && last !== undefined && "tools" in last) {
      last.tools.push(row);
    } else if (row.kind === "tool") {
      groups.push({ key: row.key, tools: [row] });
    } else {
      groups.push({ key: row.key, row });
    }
  }
  return groups;
}

export function MateChat({
  mate,
  theme,
  compact,
  onOpen,
}: {
  mate: AgentSummary;
  theme: PluginTheme;
  compact: boolean;
  /** Opens the first mate in Paseo; absent where the host gives no navigation. */
  onOpen: (() => void) | null;
}) {
  const ask = useRpc(askMate);
  const toast = useToast();
  const timeline = useAgentTimeline(mate.id, `${mate.updatedAt}:${mate.pendingPermissions}`);
  const rows = useMemo(() => transcriptRows(timeline.entries), [timeline.entries]);
  const groups = useMemo(() => groupRows(rows), [rows]);
  const follow = useFollowEnd();
  /** What the first mate is waiting on — a question, a permission, a plan. */
  const { pending, respond } = usePendingRequests(mate.id, timeline.agent?.pendingPermissions, follow.pin);

  const [draft, setDraftState] = useState(cachedDraft);
  const [sending, setSending] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const pane = useRef<View>(null);
  /** The keyboard's cover over this pane; padding it away lifts the composer above the keyboard. */
  const keyboard = useKeyboardOverlap(pane);
  // The transcript shrinks when the keyboard opens; keep its end in view if that is where the captain was.
  useEffect(() => {
    // Not a dependency: `follow` is new every render, and the keyboard opening is the event.
    if (keyboard > 0) follow.keepAtEnd();
  }, [keyboard]);
  const submitOnEnter = Platform.OS === "web" && !compact;

  function setDraft(text: string): void {
    cachedDraft = text;
    setDraftState(text);
  }

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      pane: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
      transcript: { flex: 1 },
      scroller: { flex: 1 },
      transcriptBody: { padding: compact ? 10 : 14, gap: 10 },
      captain: {
        alignSelf: "flex-end" as const,
        maxWidth: "88%" as const,
        backgroundColor: colors.surface2,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      captainText: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
      mate: { alignSelf: "stretch" as const },
      line: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      lineText: { flex: 1, color: colors.foregroundMuted, fontSize: 11 },
      toolText: { flex: 1, color: colors.foregroundMuted, fontSize: 11, fontFamily: MONOSPACE },
      more: { color: colors.accent, fontSize: 11 },
      error: { color: colors.statusDanger, fontSize: 12 },
      hint: { color: colors.foregroundMuted, fontSize: 12, textAlign: "center" as const, padding: 16 },
      composerFrame: {
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.surface0,
      },
      composer: { padding: compact ? 8 : 10, gap: 8 },
      quick: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      inputRow: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: 8 },
      input: {
        flex: 1,
        color: colors.foreground,
        fontSize: 14,
        lineHeight: 20,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        height: compact ? INPUT_HEIGHT_COMPACT : INPUT_HEIGHT,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: colors.surface1,
        textAlignVertical: "top" as const,
      },
    };
  }, [theme, compact]);

  /**
   * The draft is cleared as the message goes, not when the daemon answers:
   * the box stays editable while it is in flight, and a follow-up typed in
   * that second must not be wiped by the reply. A failed send puts the text
   * back, unless something new has been typed since.
   */
  function send(text: string, fromDraft: boolean): void {
    const trimmed = text.trim();
    if (trimmed === "" || sending) return;
    setSending(true);
    follow.pin();
    if (fromDraft) setDraft("");
    ask({ text: trimmed })
      .catch((caught: unknown) => {
        toast.error(errorText(caught));
        if (fromDraft && cachedDraft.trim() === "") setDraft(text);
      })
      .finally(() => setSending(false));
  }

  function openLink(url: string): void {
    void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
  }

  function renderGroup(group: Group) {
    if ("tools" in group) {
      const open = openGroups.has(group.key);
      const shown = open ? group.tools : group.tools.slice(-TOOL_RUN_VISIBLE);
      const hidden = group.tools.length - shown.length;
      return (
        <View key={group.key} style={{ gap: 3 }}>
          {hidden > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show ${hidden} more tool calls`}
              onPress={() => setOpenGroups((current) => new Set([...current, group.key]))}
            >
              <Text style={styles.more}>+ {hidden} more tool calls</Text>
            </Pressable>
          ) : null}
          {shown.map((tool) => (
            <View key={tool.key} style={styles.line}>
              <Icon
                name={tool.status === "failed" ? "X" : tool.status === "running" ? "Loader" : "Wrench"}
                size={11}
                color={tool.status === "failed" ? theme.colors.statusDanger : theme.colors.foregroundMuted}
              />
              <Text style={styles.toolText} numberOfLines={1}>
                {tool.text}
              </Text>
            </View>
          ))}
        </View>
      );
    }
    const row = group.row;
    switch (row.kind) {
      case "captain":
        return (
          <View key={row.key} style={styles.captain}>
            <Text selectable style={styles.captainText}>
              {row.text}
            </Text>
          </View>
        );
      case "mate":
        return (
          <View key={row.key} style={styles.mate}>
            <Markdown source={row.text} theme={theme} onOpenLink={openLink} />
          </View>
        );
      case "error":
        return (
          <Text key={row.key} style={styles.error}>
            {row.text}
          </Text>
        );
      default:
        return (
          <View key={row.key} style={styles.line}>
            <Icon name="Bell" size={11} color={theme.colors.foregroundMuted} />
            <Text style={styles.lineText}>{row.text}</Text>
          </View>
        );
    }
  }

  return (
    <View ref={pane} style={[styles.pane, { paddingBottom: keyboard }]}>
      <View style={styles.transcript}>
        <ScrollView {...follow.scrollProps} style={styles.scroller} contentContainerStyle={styles.transcriptBody}>
          {timeline.error === null ? null : <Text style={styles.error}>{timeline.error}</Text>}
          {groups.length === 0 && pending.length === 0 ? (
            <Text style={styles.hint}>{timeline.loading ? "Loading the conversation…" : "Nothing said yet. Ask below."}</Text>
          ) : (
            groups.map(renderGroup)
          )}
          {pending.map((request) => (
            // A direct child of the transcript, so its layout is in the transcript's coordinates.
            <View key={request.id} onLayout={(event) => follow.reveal(request.id, event.nativeEvent.layout)}>
              <PermissionCard
                request={request}
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
      {/*
        The host pads a surface's top, under its header, but not its bottom, so
        on a phone the composer would sit on the home indicator. React Native's
        own SafeAreaView is the one inset source a plugin can import — the
        safe-area-context library is not among the host's modules. It pads
        only the edges it overlaps, and it replaces any padding in its own
        style, which is why the composer's padding is on the view inside.
        Deprecated in React Native 0.81 but present; the web renderer pads by
        the browser's safe-area insets, which are zero on a desktop.
      */}
      <SafeAreaView style={styles.composerFrame}>
        <View style={styles.composer}>
          <View style={styles.quick}>
            <IconButton
              icon="Compass"
              label="Bearings"
              showLabel
              theme={theme}
              disabled={sending}
              onPress={() => send(bearingsPrompt(""), false)}
            />
            <IconButton
              icon="Anchor"
              label="Ahoy"
              showLabel
              theme={theme}
              disabled={sending}
              onPress={() => send(ahoyPrompt(""), false)}
            />
            {onOpen === null ? null : (
              <IconButton icon="ExternalLink" label="Open in Paseo" showLabel theme={theme} onPress={onOpen} />
            )}
          </View>
          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={
                submitOnEnter
                  ? "Tell the first mate what you need, captain… (Enter sends, Shift+Enter for a new line)"
                  : "Tell the first mate what you need, captain…"
              }
              placeholderTextColor={theme.colors.foregroundMuted}
              multiline
              onKeyPress={
                submitOnEnter
                  ? (event: WebKeyPressEvent) => {
                      // Nothing to send, or a send in flight: Enter is left alone, as Paseo leaves it.
                      if (!isSendKey(event.nativeEvent) || sending || draft.trim() === "") return;
                      event.preventDefault();
                      send(draft, true);
                    }
                  : undefined
              }
              style={styles.input}
            />
            <IconButton
              icon="Send"
              label="Send"
              tone="accent"
              theme={theme}
              disabled={sending || draft.trim() === ""}
              onPress={() => send(draft, true)}
            />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
