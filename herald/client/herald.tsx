/**
 * The surface: every agent waiting on the user, each with the sentence Herald
 * wrote for it, a button to open the session, and a button to hear it again.
 *
 * Two sources, joined by agent id. Paseo's own attention flag decides who is
 * listed — it is what the sidebar badges already follow — and Herald's entries
 * explain why, in a sentence. An agent Paseo flags that Herald has no entry
 * for (an event before the plugin loaded, say) is still listed, with what Paseo
 * knows about the reason.
 *
 * Async **function expressions**, never async arrows, anywhere in this file:
 * the app `eval`s the client bundle, and Hermes's eval compiler on iOS and
 * Android evaluates an async arrow to `undefined`. Same reason every closure
 * over a list element goes through `.map`, never a `for…of` body.
 */
import { type PluginSurfaceProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { listAttention, type AttentionEntry, type AttentionReason } from "../shared/herald";
import { watchAgents } from "./agents";
import { getAnnouncer, isMutedHere, setMutedHere, speechText } from "./announcer";
import { canPlaySpeech, speechPlatform } from "./web";

/**
 * Opening the settings screen is a `PluginClientContext` capability:
 * `PluginSurfaceProps` carries no `openSettings`, so the surface cannot reach
 * its own settings on its own. `index.client.tsx` has the context and hands the
 * opener down here at contribution time — which happens before any surface can
 * mount — and the header button calls it. Module scope belongs to this client's
 * bundle eval, the same place the other plugins here keep their surface caches.
 */
let openSettingsScreen: ((id: string) => void) | null = null;

export function bindSettingsOpener(open: ((id: string) => void) | null): void {
  openSettingsScreen = open;
}

/** A row's reason: one of Herald's, or "attention" when only Paseo's flag is known. */
type RowReason = AttentionReason | "attention";

interface Row {
  agentId: string;
  title: string | null;
  workspaceId: string | null;
  cwd: string;
  reason: RowReason;
  /** ISO time the row sorts by: the event, or when Paseo flagged the agent. */
  at: string;
  entry: AttentionEntry | null;
}

/** The fields this surface reads off a Paseo agent snapshot. */
interface FlaggedAgent {
  id: string;
  title: string | null;
  workspaceId: string | null;
  cwd: string;
  status: string;
  attentionReason: "finished" | "error" | "permission" | null;
  at: string;
}

/**
 * A Paseo-flagged agent worth a row: one whose session is still open. Paseo
 * keeps an agent flagged until the user's next message, however long ago the
 * turn ended, and that is right — a question asked a week ago is still
 * unanswered. A *closed* session is not waiting on anyone until it is opened
 * again, and a turn reported as finished on an agent that is *running* was
 * not the end of anything — some providers say a turn is done and carry on.
 * Those two are the cases dropped here.
 */
function isCurrent(agent: FlaggedAgent): boolean {
  if (agent.status === "closed") return false;
  if (agent.attentionReason === "finished" && agent.status === "running") return false;
  return true;
}

/**
 * Module-scope caches, because the surface is unmounted whenever the user
 * navigates to an agent — which the Open button does — and mounted fresh on
 * the way back. The list repaints before the first load answers.
 *
 * Workspace names come from the host API, not `useWorkspace`: the SDK's state
 * hooks are for workspace and agent panels and throw in a sidebar surface
 * ("Plugin state hooks must run inside a workspace panel").
 */
let cachedRows: Row[] | null = null;
let cachedWorkspaceNames: Record<string, string> = {};

const IDLE_REFRESH_MS = 10_000;
const BUSY_REFRESH_MS = 2_500;

const TEST_SENTENCE = "This is Herald. Your agents will be announced like this.";

function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;
}

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function basename(path: string): string {
  const parts = path.split("/").filter((part) => part !== "");
  return parts[parts.length - 1] ?? path;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ReasonLook {
  icon: string;
  label: string;
  tone: "accent" | "success" | "warning" | "danger" | "muted";
}

function lookOf(reason: RowReason): ReasonLook {
  switch (reason) {
    case "question":
      return { icon: "MessageCircle", label: "Question", tone: "accent" };
    case "plan":
      return { icon: "ClipboardList", label: "Plan to approve", tone: "accent" };
    case "permission":
      return { icon: "Shield", label: "Permission", tone: "warning" };
    case "finished":
      return { icon: "Check", label: "Finished", tone: "success" };
    case "error":
      return { icon: "X", label: "Error", tone: "danger" };
    case "canceled":
      return { icon: "Ban", label: "Interrupted", tone: "muted" };
    case "attention":
      return { icon: "Megaphone", label: "Needs you", tone: "accent" };
  }
}

/**
 * Herald's entries win over Paseo's flags for the same agent, since they carry
 * the reason and the sentence. A *finished* entry on an agent that is working
 * again is already withheld by the daemon, which knows each entry's agent
 * without having to enumerate every running one — see `Liveness`.
 */
function joinRows(entries: AttentionEntry[], flagged: FlaggedAgent[]): Row[] {
  const byAgent = new Map<string, Row>();
  entries.forEach((entry) => {
    byAgent.set(entry.agentId, {
      agentId: entry.agentId,
      title: entry.agentTitle,
      workspaceId: entry.workspaceId,
      cwd: entry.cwd,
      reason: entry.reason,
      at: entry.createdAt,
      entry,
    });
  });
  flagged.forEach((agent) => {
    if (byAgent.has(agent.id) || !isCurrent(agent)) return;
    byAgent.set(agent.id, {
      agentId: agent.id,
      title: agent.title,
      workspaceId: agent.workspaceId,
      cwd: agent.cwd,
      reason: agent.attentionReason ?? "attention",
      at: agent.at,
      entry: null,
    });
  });
  return [...byAgent.values()].sort((a, b) => b.at.localeCompare(a.at));
}

// ---------------------------------------------------------------------------
// Styles

function useStyles({ theme, layout }: PluginSurfaceProps) {
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
      speaker: { padding: 4 },
    };
  }, [theme, layout.compact]);
}

type Styles = ReturnType<typeof useStyles>;

function toneColor(theme: PluginSurfaceProps["theme"], tone: ReasonLook["tone"]): string {
  const { colors } = theme;
  switch (tone) {
    case "accent":
      return colors.accent;
    case "success":
      return colors.statusSuccess;
    case "warning":
      return colors.statusWarning;
    case "danger":
      return colors.statusDanger;
    case "muted":
      return colors.foregroundMuted;
  }
}

// ---------------------------------------------------------------------------
// Rows

interface RowCardProps {
  row: Row;
  workspaceName: string | null;
  props: PluginSurfaceProps;
  styles: Styles;
  onOpen: ((agentId: string) => void) | null;
  onSpeak: (row: Row) => void;
}

/**
 * The whole card opens the session; the speaker right after the title says
 * the sentence again — beside the title, not at the card's edge, so it is seen. Nested pressables: the speaker takes the touch
 * and the card does not also open.
 */
function RowCard({ row, workspaceName, props, styles, onOpen, onSpeak }: RowCardProps) {
  const look = lookOf(row.reason);
  const color = toneColor(props.theme, look.tone);
  const muted = props.theme.colors.foregroundMuted;
  const entry = row.entry;
  // Agents are usually untitled; the workspace names the work. Under it, the
  // agent's own title or, failing that, what it was last asked — which is
  // what tells two untitled agents in one workspace apart.
  const title = workspaceName ?? entry?.workspaceTitle ?? basename(row.cwd);
  const subtitle = row.title?.trim() || entry?.lastRequest || null;
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
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
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
// Surface

export function HeraldSurface(props: PluginSurfaceProps) {
  const styles = useStyles(props);
  const paseo = usePaseo();
  const list = useRpc(listAttention);
  const toast = useToast();

  const [rows, setRows] = useState<Row[] | null>(cachedRows);
  const [workspaceNames, setWorkspaceNames] = useState<Record<string, string>>(cachedWorkspaceNames);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(isMutedHere());
  const [testing, setTesting] = useState(false);
  const busyRef = useRef(false);

  const refresh = useCallback(
    async function refresh() {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const [attention, flagged, workspaces] = await Promise.all([
          list({}),
          paseo.agents.list({ filter: { requiresAttention: true }, page: { limit: 100 } }),
          paseo.workspaces.list({ page: { limit: 200 } }),
        ]);
        const names: Record<string, string> = {};
        workspaces.entries.forEach((workspace) => {
          names[workspace.id] = workspace.title ?? workspace.name;
        });
        cachedWorkspaceNames = names;
        setWorkspaceNames(names);
        const agents: FlaggedAgent[] = flagged.entries.map((item) => ({
          id: item.agent.id,
          title: item.agent.title ?? null,
          workspaceId: item.agent.workspaceId ?? null,
          cwd: item.agent.cwd,
          status: item.agent.status,
          attentionReason: item.agent.attentionReason ?? null,
          at: item.agent.attentionTimestamp ?? item.agent.updatedAt,
        }));
        const next = joinRows(attention.entries, agents);
        cachedRows = next;
        setRows(next);
        setError(null);
      } catch (caught) {
        setError(errorText(caught));
      } finally {
        busyRef.current = false;
      }
    },
    [list, paseo],
  );

  // A poll, quickened while a summary is being written, plus a nudge from
  // Paseo's own agent stream so a new arrival shows within a moment.
  const pending = rows?.some((row) => row.entry?.summary.status === "pending") ?? false;
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pending ? BUSY_REFRESH_MS : IDLE_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [refresh, pending]);
  // Its own effect, so the observation is not closed and reopened every time
  // `pending` flips the poll's pace.
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const unwatch = watchAgents(paseo, () => {
      if (debounce !== null) clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 400);
    });
    return () => {
      if (debounce !== null) clearTimeout(debounce);
      unwatch();
    };
  }, [refresh, paseo]);

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
    [toast],
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
          onPress={() => void refresh()}
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
      {error === null ? null : (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.list}>
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
              workspaceName={row.workspaceId === null ? null : workspaceNames[row.workspaceId] ?? null}
              props={props}
              styles={styles}
              onOpen={onOpen}
              onSpeak={onSpeak}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
