/**
 * One crewmate, watched without leaving FirstMate: its card, with every action
 * the board has, beside its live transcript — the prompt it was given, its
 * reasoning, each tool call and what came back, its plan, and anything it is
 * waiting on, answered here.
 *
 * It takes the board's place — the right-hand pane, or the Crew tab on a
 * phone — so the chat with the first mate stays beside it. Paseo's own view of
 * the agent is one press away, for what this leaves out: attachments, the
 * model and mode pickers, the full history.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { FleetCard } from "../shared/fleet";
import { activityRows, type ActivityRow, type PlanStatus } from "./activity-rows";
import { CrewCard } from "./card";
import { useFollowEnd } from "./follow-end";
import { agentStatusLabel, agentStatusTone } from "./format";
import { Markdown } from "./markdown";
import { PermissionCard, usePendingRequests } from "./permission-card";
import { Chip, IconButton, JumpToEnd, MONOSPACE, Spinner, errorText } from "./ui";
import { useAgentTimeline } from "./use-timeline";

/** How much of a crewmate's history is read: its tail, this many entries long. */
const TIMELINE_LIMIT = 200;
/** Below this width the card sits above the transcript instead of beside it. */
const SIDE_BY_SIDE_WIDTH = 680;
const CARD_COLUMN_WIDTH = 300;
/**
 * A prompt or reasoning longer than this is folded until pressed. Only text
 * that gets the Show all toggle is clamped: a paragraph judged short can still
 * wrap past the fold on a phone, and clamping it would hide the rest for good.
 */
const FOLDED_LINES = 6;

const LABELS: Partial<Record<ActivityRow["kind"], string>> = {
  prompt: "PROMPT",
  reasoning: "REASONING",
  reply: "WORKER",
  plan: "PLAN",
};

function isLong(text: string): boolean {
  return text.split("\n").length > FOLDED_LINES || text.length > 480;
}

export function CrewmateView({
  agentId,
  card,
  theme,
  compact,
  onBack,
  onOpen,
  onChanged,
}: {
  agentId: string;
  /** Null once the crewmate has left the board — ended, or archived. */
  card: FleetCard | null;
  theme: PluginTheme;
  compact: boolean;
  onBack: () => void;
  /** Opens the crewmate in Paseo; absent where the host gives no navigation. */
  onOpen: (() => void) | null;
  onChanged: () => void;
}) {
  const [width, setWidth] = useState(0);
  const agent = card?.agent ?? null;
  const sideBySide = !compact && width >= SIDE_BY_SIDE_WIDTH;

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      screen: { flex: 1, minHeight: 0 },
      bar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: compact ? 10 : 12,
        paddingTop: compact ? 0 : 12,
        paddingBottom: 8,
      },
      title: { flex: 1, color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
      body: { flex: 1, minHeight: 0, paddingHorizontal: compact ? 10 : 12, paddingBottom: compact ? 10 : 12, gap: 10 },
      bodySide: { flexDirection: "row" as const },
      cardColumn: { width: CARD_COLUMN_WIDTH, flexGrow: 0, flexShrink: 0 },
      cardStacked: { flexGrow: 0, maxHeight: "45%" as const },
      gone: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      transcriptFrame: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: colors.surface1,
        overflow: "hidden" as const,
      },
    };
  }, [theme, compact]);

  const cardView =
    card === null ? (
      <Text style={styles.gone}>This worker is no longer on the board — it was ended or archived.</Text>
    ) : (
      <CrewCard card={card} theme={theme} compact={compact} opener={null} onChanged={onChanged} startExpanded={!compact} />
    );

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <IconButton icon="ChevronLeft" label="Crew" showLabel theme={theme} onPress={onBack} />
        <Text style={styles.title} numberOfLines={1}>
          {card?.title ?? "Worker"}
        </Text>
        {agent === null ? null : <Chip theme={theme} text={agentStatusLabel(agent)} color={agentStatusTone(theme, agent)} />}
        {onOpen === null ? null : (
          <IconButton icon="ExternalLink" label="Open in Paseo" showLabel={!compact} theme={theme} onPress={onOpen} />
        )}
      </View>
      <View
        style={[styles.body, sideBySide ? styles.bodySide : null]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        <ScrollView
          style={sideBySide ? styles.cardColumn : styles.cardStacked}
          // The steer and relaunch boxes are in here; on iOS the system scrolls the focused one into view.
          automaticallyAdjustKeyboardInsets
        >
          {cardView}
        </ScrollView>
        <View style={styles.transcriptFrame}>
          <ActivityTranscript
            agentId={agentId}
            revision={agent === null ? "" : `${agent.updatedAt}:${agent.pendingPermissions}`}
            theme={theme}
            compact={compact}
            onOpen={onOpen}
          />
        </View>
      </View>
    </View>
  );
}

function ActivityTranscript({
  agentId,
  revision,
  theme,
  compact,
  onOpen,
}: {
  agentId: string;
  /** Changes when the board's poll sees the crewmate change; a second trigger for a re-read. */
  revision: string;
  theme: PluginTheme;
  compact: boolean;
  onOpen: (() => void) | null;
}) {
  const toast = useToast();
  const timeline = useAgentTimeline(agentId, revision, TIMELINE_LIMIT);
  const rows = useMemo(() => activityRows(timeline.entries), [timeline.entries]);
  const follow = useFollowEnd();
  const { pending, respond } = usePendingRequests(agentId, timeline.agent?.pendingPermissions, follow.pin);
  /** Tool rows showing their detail, and prompts and reasoning shown whole, by row key. */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const running = timeline.agent?.status === "running" || timeline.agent?.status === "initializing";

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      body: { padding: compact ? 10 : 14, gap: 8 },
      label: { color: colors.foregroundMuted, fontSize: 10, fontWeight: "600" as const, letterSpacing: 0.6, marginTop: 4 },
      prompt: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: 10 },
      promptText: { color: colors.foreground, fontSize: 13, lineHeight: 19 },
      reasoning: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontStyle: "italic" as const },
      more: { color: colors.accent, fontSize: 11, marginTop: 2 },
      tool: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        backgroundColor: colors.surface0,
        paddingHorizontal: 10,
        paddingVertical: 7,
        gap: 8,
      },
      toolHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      toolLabel: { color: colors.foreground, fontSize: 12, fontWeight: "600" as const },
      toolSummary: { flex: 1, color: colors.foregroundMuted, fontSize: 11, fontFamily: MONOSPACE },
      detail: {
        color: colors.foreground,
        fontSize: 11,
        lineHeight: 16,
        fontFamily: MONOSPACE,
        backgroundColor: colors.surface2,
        borderRadius: 6,
        padding: 8,
      },
      planRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8 },
      planText: { flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 18 },
      planDone: { color: colors.foregroundMuted, textDecorationLine: "line-through" as const },
      planActive: { fontWeight: "600" as const },
      line: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      lineText: { flex: 1, color: colors.foregroundMuted, fontSize: 11 },
      error: { color: colors.statusDanger, fontSize: 12 },
      hint: { color: colors.foregroundMuted, fontSize: 12, textAlign: "center" as const, padding: 16 },
      link: { color: colors.accent, fontSize: 11, textDecorationLine: "underline" as const },
    };
  }, [theme, compact]);

  function toggle(key: string): void {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openLink(url: string): void {
    void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
  }

  /** Lines to clamp a foldable text to, or undefined to draw it whole. */
  function foldedLines(key: string, text: string): number | undefined {
    return isLong(text) && !open.has(key) ? FOLDED_LINES : undefined;
  }

  function foldToggle(key: string, text: string) {
    if (!isLong(text)) return null;
    return (
      <Pressable accessibilityRole="button" onPress={() => toggle(key)}>
        <Text style={styles.more}>{open.has(key) ? "Show less" : "Show all"}</Text>
      </Pressable>
    );
  }

  function planIcon(status: PlanStatus) {
    const { colors } = theme;
    if (status === "completed") return <Icon name="SquareCheck" size={14} color={colors.statusSuccess} />;
    if (status === "in_progress") return <Icon name="CircleDot" size={14} color={colors.accent} />;
    return <Icon name="Square" size={14} color={colors.foregroundMuted} />;
  }

  function toolStatusIcon(status: Extract<ActivityRow, { kind: "tool" }>["status"]) {
    const { colors } = theme;
    if (status === "running") return <Spinner size={12} color={colors.accent} />;
    if (status === "failed") return <Icon name="CircleX" size={12} color={colors.statusDanger} />;
    if (status === "canceled") return <Icon name="Ban" size={12} color={colors.foregroundMuted} />;
    return null;
  }

  function renderRow(row: ActivityRow) {
    switch (row.kind) {
      case "prompt":
        return (
          <View style={styles.prompt}>
            <Text selectable style={styles.promptText} numberOfLines={foldedLines(row.key, row.text)}>
              {row.text}
            </Text>
            {foldToggle(row.key, row.text)}
          </View>
        );
      case "reasoning": {
        const text = row.text.trim();
        return (
          <View>
            <Text selectable style={styles.reasoning} numberOfLines={foldedLines(row.key, text)}>
              {text}
            </Text>
            {foldToggle(row.key, text)}
          </View>
        );
      }
      case "reply":
        return <Markdown source={row.text} theme={theme} onOpenLink={openLink} />;
      case "tool": {
        const expanded = open.has(row.key) && row.detail !== null;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${row.label} ${row.summary}`}
            accessibilityState={{ expanded, disabled: row.detail === null }}
            disabled={row.detail === null}
            onPress={() => toggle(row.key)}
            style={styles.tool}
          >
            <View style={styles.toolHead}>
              <Icon name={row.icon} size={13} color={theme.colors.foregroundMuted} />
              <Text style={styles.toolLabel}>{row.label}</Text>
              <Text style={styles.toolSummary} numberOfLines={1}>
                {row.summary}
              </Text>
              {toolStatusIcon(row.status)}
              {row.detail === null ? null : (
                <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={13} color={theme.colors.foregroundMuted} />
              )}
            </View>
            {!expanded || row.detail === null ? null : row.markdown ? (
              <Markdown source={row.detail} theme={theme} fontSize={12} onOpenLink={openLink} />
            ) : (
              <Text selectable style={styles.detail}>
                {row.detail}
              </Text>
            )}
          </Pressable>
        );
      }
      case "plan":
        return (
          <View style={{ gap: 4 }}>
            {row.items.map((item, index) => (
              <View key={index} style={styles.planRow}>
                {planIcon(item.status)}
                <Text
                  style={[
                    styles.planText,
                    item.status === "completed" ? styles.planDone : null,
                    item.status === "in_progress" ? styles.planActive : null,
                  ]}
                >
                  {item.text}
                </Text>
              </View>
            ))}
          </View>
        );
      case "error":
        return <Text style={styles.error}>{row.text}</Text>;
      default:
        return (
          <View style={styles.line}>
            <Icon name="Bell" size={11} color={theme.colors.foregroundMuted} />
            <Text style={styles.lineText}>{row.text}</Text>
          </View>
        );
    }
  }

  return (
    <View style={{ flex: 1 }}>
      {/*
        A question's free-text box is at the end of this list; on iOS the system
        insets it for the keyboard and scrolls the focused box into view.
      */}
      <ScrollView {...follow.scrollProps} contentContainerStyle={styles.body} automaticallyAdjustKeyboardInsets>
        {timeline.hasOlder ? (
          <View style={styles.line}>
            <Icon name="History" size={11} color={theme.colors.foregroundMuted} />
            <Text style={styles.lineText}>
              Only the latest activity is shown here.{" "}
              {onOpen === null ? null : (
                <Text accessibilityRole="link" style={styles.link} onPress={onOpen}>
                  The rest is in Paseo.
                </Text>
              )}
            </Text>
          </View>
        ) : null}
        {timeline.error === null ? null : <Text style={styles.error}>{timeline.error}</Text>}
        {rows.length === 0 && pending.length === 0 ? (
          <Text style={styles.hint}>{timeline.loading ? "Loading the worker's activity…" : "Nothing has happened yet."}</Text>
        ) : (
          rows.map((row, index) => {
            const label = LABELS[row.kind];
            const previous = rows[index - 1];
            return (
              <View key={row.key} style={{ gap: 4 }}>
                {label === undefined || previous?.kind === row.kind ? null : <Text style={styles.label}>{label}</Text>}
                {renderRow(row)}
              </View>
            );
          })
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
        {running && pending.length === 0 ? (
          <View style={styles.line}>
            <Spinner size={11} color={theme.colors.accent} />
            <Text style={styles.lineText}>Working…</Text>
          </View>
        ) : null}
      </ScrollView>
      {follow.away ? <JumpToEnd theme={theme} onPress={follow.jumpToEnd} /> : null}
    </View>
  );
}
