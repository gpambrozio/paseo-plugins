/**
 * One card on the board: a crewmate, a backlog item, or both.
 *
 * Pressing the card opens its actions. The first one is the caller's: the
 * board watches the crewmate without leaving FirstMate, a panel beside a
 * workspace opens it in Paseo. Steering, interrupting and ending go to the
 * crewmate directly; relaunching goes through the first mate, because it
 * owns the brief the new crewmate starts from. Ending archives the agent and
 * leaves its workspace and worktree exactly as they are.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { exitCrew, interruptCrew, relaunchCrew, steerCrew, type ColumnId, type FleetCard } from "../shared/fleet";
import { agentStatusLabel, agentStatusTone, columnTone, modelLabel, opensAsLeft, relativeTime } from "./format";
import { Chip, IconButton, errorText } from "./ui";

/** The card's first action, which opens the crewmate somewhere. */
export interface CardOpener {
  icon: string;
  label: string;
  onPress: () => void;
}

type Draft = { kind: "steer" | "relaunch"; text: string } | { kind: "end" } | null;

/**
 * Whether each card is open, what is half-typed in it, and the column it was
 * in, by card key.
 *
 * A card changes column exactly when the captain is most likely to act on it
 * — its crewmate just stopped — and a card in another column is a different
 * element to React, so it remounts. Kept here, a draft survives the move, and
 * the surface unmounting too. An open card with nothing in progress does not:
 * it goes back to rest in its new column (`opensAsLeft`), or every card the
 * captain had looked into would arrive in Done still showing its actions.
 */
const cardMemory = new Map<string, { expanded: boolean; draft: Draft; column: ColumnId }>();

function useCardMemory(key: string, startExpanded: boolean, column: ColumnId) {
  const remembered = cardMemory.get(key);
  const kept =
    remembered !== undefined && opensAsLeft({ column: remembered.column, inProgress: remembered.draft !== null }, column)
      ? remembered
      : undefined;
  const [expanded, setExpandedState] = useState(kept?.expanded ?? startExpanded);
  const [draft, setDraftState] = useState<Draft>(kept?.draft ?? null);

  function remember(next: { expanded: boolean; draft: Draft }): void {
    if (!next.expanded && next.draft === null) cardMemory.delete(key);
    else cardMemory.set(key, { ...next, column });
  }
  function setExpanded(next: boolean): void {
    remember({ expanded: next, draft });
    setExpandedState(next);
  }
  function setDraft(next: Draft): void {
    remember({ expanded, draft: next });
    setDraftState(next);
  }
  return { expanded, setExpanded, draft, setDraft };
}

const STATE_WORDS: Record<string, string> = {
  working: "Working",
  "needs-decision": "Needs a decision",
  blocked: "Blocked",
  paused: "Paused",
  done: "Done",
  failed: "Failed",
  resolved: "Resolved",
};

export function CrewCard({
  card,
  theme,
  compact,
  opener,
  onChanged,
  startExpanded = false,
}: {
  card: FleetCard;
  theme: PluginTheme;
  compact: boolean;
  /** Null where the crewmate is already in view, or there is nowhere to open it. */
  opener: CardOpener | null;
  /** Called after an action lands, so the board refreshes without waiting for its poll. */
  onChanged: () => void;
  startExpanded?: boolean;
}) {
  const steer = useRpc(steerCrew);
  const interrupt = useRpc(interruptCrew);
  const exit = useRpc(exitCrew);
  const relaunch = useRpc(relaunchCrew);
  const toast = useToast();

  const { expanded, setExpanded, draft, setDraft } = useCardMemory(card.key, startExpanded, card.column);
  const [busy, setBusy] = useState(false);

  const agent = card.agent;
  const tone = columnTone(theme, card.column);
  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      card: {
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: 3,
        borderLeftColor: tone,
        borderRadius: 10,
        backgroundColor: colors.surface0,
        padding: compact ? 10 : 12,
        gap: 6,
      },
      titleRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8 },
      title: { flex: 1, color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
      meta: { color: colors.foregroundMuted, fontSize: 11 },
      report: { color: colors.foreground, fontSize: 12, lineHeight: 17 },
      reportState: { color: tone, fontWeight: "600" as const },
      link: { color: colors.accent, fontSize: 12, textDecorationLine: "underline" as const },
      actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, marginTop: 2 },
      input: {
        color: colors.foreground,
        fontSize: 13,
        minHeight: 60,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: colors.surface1,
        textAlignVertical: "top" as const,
      },
      prompt: { color: colors.foreground, fontSize: 12 },
    };
  }, [theme, compact, tone]);

  function run(label: string, action: () => Promise<unknown>): void {
    setBusy(true);
    action()
      .then(() => {
        toast.show(label, { variant: "success" });
        setDraft(null);
        onChanged();
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setBusy(false));
  }

  function submitDraft(): void {
    if (agent === null || draft === null) return;
    if (draft.kind === "end") {
      run("The worker was ended; its local copy is untouched.", () => exit({ agentId: agent.id }));
      return;
    }
    const text = draft.text.trim();
    if (text === "") return;
    if (draft.kind === "steer") run("Sent to the worker.", () => steer({ agentId: agent.id, text }));
    else run("Asked the first mate to relaunch it.", () => relaunch({ agentId: agent.id, note: text }));
  }

  const backlog = card.backlog;
  const facts = [
    card.project,
    card.kind,
    card.taskId,
    backlog?.blockedBy === null || backlog?.blockedBy === undefined ? null : `after ${backlog.blockedBy}`,
  ].filter((fact): fact is string => fact !== null && fact !== "");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title}. ${expanded ? "Hide" : "Show"} actions`}
      accessibilityState={{ expanded }}
      onPress={() => setExpanded(!expanded)}
      style={styles.card}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>{card.title}</Text>
        {agent === null ? null : <Chip theme={theme} text={agentStatusLabel(agent)} color={agentStatusTone(theme, agent)} />}
      </View>
      {facts.length === 0 ? null : <Text style={styles.meta}>{facts.join(" · ")}</Text>}

      {card.report === null ? null : (
        <Text style={styles.report} numberOfLines={expanded ? undefined : 3}>
          <Text style={styles.reportState}>{STATE_WORDS[card.report.state] ?? card.report.state}: </Text>
          {card.report.text}
        </Text>
      )}
      {backlog?.hold === null || backlog?.hold === undefined ? null : (
        <Text style={styles.report}>
          <Text style={styles.reportState}>Captain's call: </Text>
          {backlog.hold}
        </Text>
      )}
      {agent?.lastError === null || agent?.lastError === undefined ? null : (
        <Text style={[styles.report, { color: theme.colors.statusDanger }]} numberOfLines={expanded ? undefined : 2}>
          {agent.lastError}
        </Text>
      )}
      {agent === null && backlog?.section === "in-flight" ? (
        <Text style={styles.meta}>No worker is running for this item.</Text>
      ) : null}

      {card.url === null ? null : (
        <Text
          accessibilityRole="link"
          style={styles.link}
          numberOfLines={1}
          onPress={() => {
            void openExternalUrl(card.url ?? "").catch((caught: unknown) => toast.error(errorText(caught)));
          }}
        >
          {card.url.replace(/^https?:\/\/(www\.)?github\.com\//, "")}
        </Text>
      )}
      {backlog?.reportPath === null || backlog?.reportPath === undefined ? null : (
        <Text style={styles.meta}>Report: {backlog.reportPath}</Text>
      )}

      <Text style={styles.meta}>
        {[
          agent === null ? null : modelLabel(agent),
          agent === null ? backlog?.outcome ?? backlog?.since ?? null : relativeTime(agent.updatedAt),
        ]
          .filter((part): part is string => part !== null && part !== "")
          .join(" · ")}
      </Text>

      {expanded && agent !== null ? (
        <View style={styles.actions}>
          {opener === null ? null : (
            <IconButton icon={opener.icon} label={opener.label} showLabel theme={theme} onPress={opener.onPress} />
          )}
          <IconButton
            icon="MessageSquare"
            label="Steer"
            showLabel
            theme={theme}
            disabled={busy}
            onPress={() => setDraft({ kind: "steer", text: "" })}
          />
          <IconButton
            icon="Square"
            label="Interrupt"
            showLabel
            theme={theme}
            disabled={busy || (agent.status !== "running" && agent.status !== "initializing")}
            onPress={() => run("Interrupted.", () => interrupt({ agentId: agent.id }))}
          />
          <IconButton
            icon="RotateCcw"
            label="Relaunch"
            showLabel
            theme={theme}
            disabled={busy}
            onPress={() => setDraft({ kind: "relaunch", text: "" })}
          />
          <IconButton
            icon="Power"
            label="End"
            showLabel
            tone="danger"
            theme={theme}
            disabled={busy}
            onPress={() => setDraft({ kind: "end" })}
          />
        </View>
      ) : null}

      {expanded && draft !== null ? (
        <View style={{ gap: 6 }}>
          {draft.kind === "end" ? (
            <Text style={styles.prompt}>
              End this worker? The agent is archived; its workspace and local copy stay exactly as they are.
            </Text>
          ) : (
            <TextInput
              value={draft.text}
              onChangeText={(text) => setDraft({ kind: draft.kind, text })}
              placeholder={
                draft.kind === "steer"
                  ? "Tell the worker… (the first mate hears about it)"
                  : "What the new worker should know — progress so far, what to avoid"
              }
              placeholderTextColor={theme.colors.foregroundMuted}
              multiline
              autoFocus={!compact}
              style={styles.input}
            />
          )}
          <View style={styles.actions}>
            <IconButton
              icon={draft.kind === "end" ? "Power" : "Send"}
              label={draft.kind === "end" ? "End it" : draft.kind === "steer" ? "Send" : "Relaunch"}
              showLabel
              tone={draft.kind === "end" ? "danger" : "accent"}
              theme={theme}
              disabled={busy || (draft.kind !== "end" && draft.text.trim() === "")}
              onPress={submitDraft}
            />
            <IconButton icon="X" label="Cancel" showLabel theme={theme} onPress={() => setDraft(null)} />
          </View>
        </View>
      ) : null}

      {expanded && agent === null ? (
        <View style={styles.actions}>
          <Icon name="Info" size={12} color={theme.colors.foregroundMuted} />
          <Text style={styles.meta}>Ask the first mate to act on backlog items.</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
