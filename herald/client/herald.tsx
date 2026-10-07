/**
 * The Herald screen: every agent waiting on the user, each with the sentence
 * Herald wrote for it, a button to open the session, and a button to hear it
 * again. Opened with an `agent` param — the sidebar popover does that — it
 * scrolls that agent's card into view and outlines it.
 *
 * Two sources, joined by agent id in `client/rows.ts` and loaded by
 * `client/waiting.ts`, which the sidebar row reads too. An agent Paseo flags
 * that Herald has no entry for (an event before the plugin loaded, say) is
 * still listed, with what Paseo knows about the reason.
 *
 * Async **function expressions**, never async arrows, anywhere in this file:
 * the app `eval`s the client bundle, and Hermes's eval compiler on iOS and
 * Android evaluates an async arrow to `undefined`. Same reason every closure
 * over a list element goes through `.map`, never a `for…of` body.
 */
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { getAnnouncer, isMutedHere, setMutedHere, speechText } from "./announcer";
import { lookOf, relativeTime, rowSubtitle, rowTitle, toneColor, withAlpha, type Row } from "./rows";
import { focusedAgentId } from "./screen";
import { useWaiting, useWaitingNudges } from "./waiting";
import { canPlaySpeech, speechPlatform } from "./web";

/**
 * Opening the settings screen is a `PluginClientContext` capability:
 * `PluginScreenProps` carries no `openSettings`, so the screen cannot reach
 * its own settings on its own. `index.client.tsx` has the context and hands the
 * opener down here at contribution time — which happens before any screen can
 * mount — and the header button calls it. Module scope belongs to this client's
 * bundle eval, the same place the other plugins here keep their surface caches.
 */
let openSettingsScreen: ((id: string) => void) | null = null;

export function bindSettingsOpener(open: ((id: string) => void) | null): void {
  openSettingsScreen = open;
}

const TEST_SENTENCE = "This is Herald. Your agents will be announced like this.";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Styles

function useStyles({ theme, layout }: PluginScreenProps) {
  return useMemo(() => {
    const { colors } = theme;
    const separator = withAlpha(colors.foregroundMuted, "33");
    const pad = layout.compact ? 12 : 16;
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: pad,
        paddingVertical: layout.compact ? 10 : 12,
        borderBottomWidth: 1,
        borderBottomColor: separator,
      },
      title: { color: colors.foreground, fontSize: layout.compact ? 17 : 19, fontWeight: "600" as const },
      count: {
        color: colors.accentForeground,
        backgroundColor: colors.accent,
        borderRadius: 10,
        paddingHorizontal: 7,
        paddingVertical: 1,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      spacer: { flex: 1 },
      toolButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: separator,
      },
      toolButtonText: { color: colors.foreground, fontSize: 13 },
      hint: {
        color: colors.foregroundMuted,
        fontSize: 12,
        paddingHorizontal: pad,
        paddingTop: 8,
        lineHeight: 17,
      },
      banner: {
        marginHorizontal: pad,
        marginTop: 10,
        padding: 10,
        borderRadius: 8,
        backgroundColor: withAlpha(colors.statusDanger, "22"),
      },
      bannerText: { color: colors.statusDanger, fontSize: 13 },
      list: { padding: pad, gap: 10 },
      empty: { padding: pad * 2, alignItems: "center" as const, gap: 8 },
      emptyTitle: { color: colors.foreground, fontSize: 15, fontWeight: "600" as const },
      emptyText: { color: colors.foregroundMuted, fontSize: 13, textAlign: "center" as const },
      card: {
        backgroundColor: colors.surface1,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: separator,
        padding: layout.compact ? 12 : 14,
        gap: 8,
      },
      cardTop: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      cardTitle: { color: colors.foreground, fontSize: 15, fontWeight: "600" as const, flexShrink: 1 },
      cardMeta: { color: colors.foregroundMuted, fontSize: 12 },
      reasonPill: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
      },
      reasonText: { fontSize: 12, fontWeight: "600" as const },
      headline: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
      detail: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 18 },
      summary: { color: colors.foreground, fontSize: 14, lineHeight: 20, fontStyle: "italic" as const },
      summaryMuted: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 20, fontStyle: "italic" as const },
      pending: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      pendingText: { color: colors.foregroundMuted, fontSize: 13 },
      cardPressed: { backgroundColor: colors.surface2 },
      cardFocused: { borderColor: colors.accent },
      speaker: { padding: 4 },
    };
  }, [theme, layout.compact]);
}

type Styles = ReturnType<typeof useStyles>;

// ---------------------------------------------------------------------------
// Rows

interface RowCardProps {
  row: Row;
  title: string;
  /** The agent the screen was opened on, from the sidebar popover. */
  focused: boolean;
  props: PluginScreenProps;
  styles: Styles;
  onOpen: ((agentId: string) => void) | null;
  onSpeak: (row: Row) => void;
  /** Where the card sits in the list, so the screen can scroll a focused one into view. */
  onPlaced: (agentId: string, y: number) => void;
}

/**
 * The whole card opens the session; the speaker right after the title says
 * the sentence again — beside the title, not at the card's edge, so it is seen. Nested pressables: the speaker takes the touch
 * and the card does not also open.
 */
function RowCard({ row, title, focused, props, styles, onOpen, onSpeak, onPlaced }: RowCardProps) {
  const look = lookOf(row.reason);
  const color = toneColor(props.theme, look.tone);
  const muted = props.theme.colors.foregroundMuted;
  const entry = row.entry;
  const subtitle = rowSubtitle(row);
  const spoken = entry === null ? null : speechText(entry);
  // Hidden outright where nothing can play it, rather than offered and failing.
  const canSpeakRow = canPlaySpeech() && (entry === null || spoken !== null);

  let summaryNode: ReactElement | null;
  if (entry === null) {
    summaryNode = null;
  } else if (entry.summary.status === "pending") {
    summaryNode = (
      <View style={styles.pending}>
        <ActivityIndicator size="small" color={muted} />
        <Text style={styles.pendingText}>Writing the summary…</Text>
      </View>
    );
  } else if (entry.summary.status === "ready") {
    summaryNode = <Text style={styles.summary}>{entry.summary.text}</Text>;
  } else if (entry.summary.status === "failed") {
    summaryNode = (
      <View style={{ gap: 2 }}>
        <Text style={styles.summaryMuted}>{entry.summary.fallback}</Text>
        <Text style={styles.cardMeta}>Summary failed: {entry.summary.error}</Text>
      </View>
    );
  } else {
    summaryNode = <Text style={styles.cardMeta}>Not announced: this kind of event is switched off in settings.</Text>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
      disabled={onOpen === null}
      onPress={onOpen === null ? undefined : () => onOpen(row.agentId)}
      onLayout={(event) => onPlaced(row.agentId, event.nativeEvent.layout.y)}
      style={({ pressed }) => [
        styles.card,
        focused ? styles.cardFocused : null,
        pressed ? styles.cardPressed : null,
      ]}
    >
      <View style={styles.cardTop}>
        <View style={[styles.reasonPill, { backgroundColor: withAlpha(color, "22") }]}>
          <Icon name={look.icon} size={13} color={color} />
          <Text style={[styles.reasonText, { color }]}>{look.label}</Text>
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {title}
        </Text>
        {canSpeakRow ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Speak the summary for ${title}`}
            hitSlop={8}
            onPress={() => onSpeak(row)}
            style={styles.speaker}
          >
            <Icon name="Volume2" size={16} color={props.theme.colors.foreground} />
          </Pressable>
        ) : null}
        <View style={styles.spacer} />
        <Text style={styles.cardMeta}>{relativeTime(row.at)}</Text>
      </View>
      {subtitle === null ? null : (
        <Text style={styles.cardMeta} numberOfLines={1}>
          {subtitle}
        </Text>
      )}
      {entry === null ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.headline}>{look.label === "Needs you" ? "Waiting for you." : `${look.label}.`}</Text>
          <Text style={styles.detail}>No summary: this happened before Herald was watching this agent.</Text>
        </View>
      ) : (
        <View style={{ gap: 2 }}>
          <Text style={styles.headline}>{entry.headline}</Text>
          {entry.detail === null ? null : (
            <Text style={styles.detail} numberOfLines={4}>
              {entry.detail}
            </Text>
          )}
        </View>
      )}
      {summaryNode}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Screen

export function HeraldScreen(props: PluginScreenProps) {
  const styles = useStyles(props);
  const toast = useToast();
  const waiting = useWaiting();
  useWaitingNudges();

  const rows = waiting.data?.rows ?? null;
  const workspaceNames = useMemo(() => waiting.data?.workspaceNames ?? {}, [waiting.data]);
  const error = waiting.error === null ? null : errorText(waiting.error);
  const [muted, setMuted] = useState(isMutedHere());
  const [testing, setTesting] = useState(false);

  // The agent the popover asked for: scrolled to once per request, when its
  // card has been laid out, and outlined for as long as the param stands.
  const focusId = focusedAgentId(props.params);
  const scrollRef = useRef<ScrollView>(null);
  const placed = useRef(new Map<string, number>());
  const scrolledTo = useRef<string | null>(null);
  const scrollToFocus = useCallback(
    function scrollToFocus() {
      if (focusId === null || scrolledTo.current === focusId) return;
      const y = placed.current.get(focusId);
      if (y === undefined) return;
      scrolledTo.current = focusId;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    },
    [focusId],
  );
  useEffect(() => {
    if (focusId === null) scrolledTo.current = null;
    scrollToFocus();
  }, [focusId, scrollToFocus]);
  const onPlaced = useCallback(
    function onPlaced(agentId: string, y: number) {
      placed.current.set(agentId, y);
      if (agentId === focusId) scrollToFocus();
    },
    [focusId, scrollToFocus],
  );
  const focusGone = focusId !== null && rows !== null && !rows.some((row) => row.agentId === focusId);

  const openAgent = props.navigation?.openAgent;
  const onOpen = useMemo(
    () => (openAgent === undefined ? null : (agentId: string) => openAgent({ agentId })),
    [openAgent],
  );

  const onSpeak = useCallback(
    async function onSpeak(row: Row) {
      const announcer = getAnnouncer();
      if (announcer === null) return;
      try {
        const blocked =
          row.entry !== null
            ? await announcer.speakEntry(row.entry)
            : await announcer.speakText(
                `${row.title?.trim() || workspaceNames[row.workspaceId ?? ""] || "An agent"} is waiting for you.`,
              );
        if (blocked !== null) toast.show(blocked, { variant: "info" });
      } catch (caught) {
        toast.error(errorText(caught));
      }
    },
    [toast, workspaceNames],
  );

  const onTest = useCallback(
    async function onTest() {
      const announcer = getAnnouncer();
      if (announcer === null) return;
      setTesting(true);
      try {
        await announcer.speakText(TEST_SENTENCE, { force: true });
      } catch (caught) {
        toast.error(errorText(caught));
      } finally {
        setTesting(false);
      }
    },
    [toast],
  );

  const toggleMute = useCallback(() => {
    const next = !isMutedHere();
    setMutedHere(next);
    setMuted(next);
  }, []);

  const platform = speechPlatform();
  let hint: string | null = null;
  if (platform === "mobile") {
    hint = "Phones cannot play audio from a plugin yet, so there is nothing to press here. Herald vibrates instead when that is switched on in Settings › Plugins › Herald.";
  } else if (!canPlaySpeech()) {
    hint = "This browser can neither play audio nor speak, so summaries can only be read here.";
  } else if (platform === "browser") {
    hint = "In a browser tab, tap Test voice once so the page is allowed to speak.";
  }

  const foreground = props.theme.colors.foreground;
  const count = rows?.length ?? 0;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Icon name="Megaphone" size={18} color={foreground} />
        <Text style={styles.title}>Herald</Text>
        {count > 0 ? <Text style={styles.count}>{count}</Text> : null}
        <View style={styles.spacer} />
        {canPlaySpeech() ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={muted ? "Unmute on this device" : "Mute on this device"}
              onPress={toggleMute}
              style={styles.toolButton}
            >
              <Icon name={muted ? "VolumeX" : "Volume2"} size={14} color={foreground} />
              {props.layout.compact ? null : (
                <Text style={styles.toolButtonText}>{muted ? "Muted here" : "Mute here"}</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Test voice"
              onPress={() => void onTest()}
              disabled={testing}
              style={styles.toolButton}
            >
              <Icon name="Play" size={14} color={foreground} />
              {props.layout.compact ? null : <Text style={styles.toolButtonText}>Test voice</Text>}
            </Pressable>
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh"
          onPress={() => void waiting.refetch()}
          style={styles.toolButton}
        >
          <Icon name="RefreshCw" size={14} color={foreground} />
        </Pressable>
        {openSettingsScreen === null ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Herald settings"
            onPress={() => openSettingsScreen?.("herald")}
            style={styles.toolButton}
          >
            <Icon name="Settings" size={14} color={foreground} />
          </Pressable>
        )}
      </View>
      {hint === null ? null : <Text style={styles.hint}>{hint}</Text>}
      {focusGone ? <Text style={styles.hint}>That agent is no longer waiting for you.</Text> : null}
      {error === null ? null : (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      )}
      <ScrollView ref={scrollRef} contentContainerStyle={styles.list}>
        {rows === null ? (
          <View style={styles.empty}>
            <ActivityIndicator color={props.theme.colors.foregroundMuted} />
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing needs you right now</Text>
            <Text style={styles.emptyText}>
              When an agent asks a question, pauses for permission, or finishes, it shows up here with a
              one-sentence summary.
            </Text>
          </View>
        ) : (
          rows.map((row) => (
            <RowCard
              key={row.agentId}
              row={row}
              title={rowTitle(row, workspaceNames)}
              focused={row.agentId === focusId}
              props={props}
              styles={styles}
              onOpen={onOpen}
              onSpeak={onSpeak}
              onPlaced={onPlaced}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
