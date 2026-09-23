/**
 * FirstMate beside a workspace or an agent: the crewmate's card, found by the
 * workspace it works in or by its own id, with the same actions the board
 * has. In the first mate's own tab it says so and counts the crew; anywhere
 * else it offers to tell the first mate about this place.
 *
 * Both panels read the fleet the board reads, under the same query key, so a
 * board and a panel open together poll once between them.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import {
  useAgent,
  useRpc,
  useSettings,
  useWorkspace,
  type PluginAgentPanelProps,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { askMate, type FleetCard } from "../shared/fleet";
import { displaySettings } from "../shared/settings";
import { CrewCard } from "./card";
import { FLEET_QUERY_KEY, useFleet } from "./fleet";
import { groupCards } from "./format";
import { IconButton, errorText } from "./ui";

type Navigation = PluginWorkspacePanelProps["navigation"];

function PanelBody({
  theme,
  compact,
  navigation,
  match,
  place,
}: {
  theme: PluginTheme;
  compact: boolean;
  navigation: Navigation;
  /** Which card this panel is about. */
  match: { agentId: string | null; workspaceId: string | null };
  /** How the note to the first mate names this place: "the workspace …", "the agent …". */
  place: string;
}) {
  const display = useSettings(displaySettings);
  const fleet = useFleet(display.status === "ready" ? display.values.pollSeconds : 5);
  const queryClient = useQueryClient();
  const ask = useRpc(askMate);
  const toast = useToast();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const data = fleet.data ?? null;
  const isMate = data?.mate !== null && data?.mate !== undefined && data.mate.id === match.agentId;
  const cards: FleetCard[] = useMemo(() => {
    const all = data?.cards ?? [];
    if (match.agentId !== null) {
      const byAgent = all.filter((card) => card.agent?.id === match.agentId);
      if (byAgent.length > 0) return byAgent;
    }
    return match.workspaceId === null ? [] : all.filter((card) => card.agent?.workspaceId === match.workspaceId);
  }, [data, match.agentId, match.workspaceId]);

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 },
      content: { padding: compact ? 12 : 16, gap: 10, paddingBottom: 24 },
      title: { color: colors.foreground, fontSize: 15, fontWeight: "600" as const },
      muted: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
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
    };
  }, [theme, compact]);

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: FLEET_QUERY_KEY });
  }

  function sendNote(): void {
    const text = note.trim();
    if (text === "" || sending) return;
    setSending(true);
    ask({ text: `${text}\n\n(Sent from ${place}.)` })
      .then(() => {
        setNote("");
        toast.show("Sent to the first mate.", { variant: "success" });
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setSending(false));
  }

  let summary: string;
  if (data === null) summary = fleet.error === null ? "Loading…" : errorText(fleet.error);
  else if (isMate) {
    const groups = groupCards(data.cards);
    summary = `This is the first mate. ${groups.get("working")?.length ?? 0} working, ${groups.get("blocked")?.length ?? 0} blocked, ${groups.get("queued")?.length ?? 0} queued.`;
  } else if (cards.length === 0) summary = "No FirstMate worker is running here.";
  else summary = cards.length === 1 ? "A FirstMate worker." : `${cards.length} FirstMate workers.`;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
      <Text style={styles.title}>FirstMate</Text>
      <Text style={styles.muted}>{summary}</Text>
      {cards.map((card) => {
        const agentId = card.agent?.id ?? null;
        return (
          <CrewCard
            key={card.key}
            card={card}
            theme={theme}
            compact={compact}
            opener={
              navigation === undefined || agentId === null
                ? null
                : { icon: "ExternalLink", label: "Open", onPress: () => navigation.openAgent({ agentId }) }
            }
            onChanged={refresh}
            startExpanded
          />
        );
      })}
      {data?.mate === null || data?.mate === undefined || isMate ? null : (
        <View style={{ gap: 6 }}>
          <Text style={styles.muted}>Tell the first mate something about this:</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. the tests here need a database first"
            placeholderTextColor={theme.colors.foregroundMuted}
            multiline
            style={styles.input}
          />
          <View style={{ flexDirection: "row" }}>
            <IconButton
              icon="Send"
              label={sending ? "Sending…" : "Send to the first mate"}
              showLabel
              tone="accent"
              theme={theme}
              disabled={sending || note.trim() === ""}
              onPress={sendNote}
            />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

export function WorkspacePanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, (value) => ({ name: value.name, directory: value.directory }));
  return (
    <PanelBody
      theme={theme}
      compact={layout.compact}
      navigation={navigation}
      match={{ agentId: null, workspaceId }}
      place={`the workspace "${workspace?.name ?? workspaceId}" (${workspace?.directory ?? "unknown directory"})`}
    />
  );
}

export function AgentPanel({ theme, layout, agentId, workspaceId, navigation }: PluginAgentPanelProps) {
  const title = useAgent(agentId, (value) => value.title);
  return (
    <PanelBody
      theme={theme}
      compact={layout.compact}
      navigation={navigation}
      match={{ agentId, workspaceId }}
      place={`the agent "${title ?? agentId}" (${agentId})`}
    />
  );
}
