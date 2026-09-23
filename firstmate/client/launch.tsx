/**
 * What the board shows before there is a first mate: launch one, or adopt an
 * agent that is already running.
 *
 * Launching writes the charter and records into the home and starts the
 * agent there; the plugin does nothing else on its behalf. Adopting is for an
 * agent the captain started by hand — ideally in the home, where the charter
 * is; the list says which ones are.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { adoptMate, launchMate, listCandidates, readConfig } from "../shared/fleet";
import { modelLabel, relativeTime, shortPath } from "./format";
import { useModeOptions, useModelOptions, withCurrent } from "./models";
import { OptionPicker } from "./option-picker";
import { IconButton, errorText } from "./ui";

const PROVIDER_DEFAULT = "";

export function LaunchPanel({
  theme,
  compact,
  home,
  onLaunched,
}: {
  theme: PluginTheme;
  compact: boolean;
  home: string;
  onLaunched: (agentId: string) => void;
}) {
  const launch = useRpc(launchMate);
  const adopt = useRpc(adoptMate);
  const candidates = useRpc(listCandidates);
  const read = useRpc(readConfig);
  const toast = useToast();

  const config = useQuery({ queryKey: ["firstmate", "config"], queryFn: () => read({}) });
  const models = useModelOptions();
  const [provider, setProvider] = useState("");
  const [modeId, setModeId] = useState(PROVIDER_DEFAULT);
  const [busy, setBusy] = useState(false);

  // The last launch's choice is the default for the next one.
  useEffect(() => {
    const saved = config.data?.config;
    if (saved === undefined) return;
    setProvider((current) => (current === "" ? saved.mateProvider : current));
    setModeId((current) => (current === PROVIDER_DEFAULT ? saved.mateModeId : current));
  }, [config.data]);

  const modes = useModeOptions(provider);
  const modeOptions = useMemo(() => [{ label: "Provider default", value: PROVIDER_DEFAULT }, ...modes], [modes]);

  const agents = useQuery({ queryKey: ["firstmate", "candidates"], queryFn: () => candidates({}) });

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      panel: { padding: compact ? 12 : 20, gap: 18, maxWidth: 760 },
      title: { color: colors.foreground, fontSize: compact ? 18 : 22, fontWeight: "600" as const },
      body: { color: colors.foreground, fontSize: 13, lineHeight: 19 },
      muted: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      actions: { flexDirection: "row" as const, gap: 8, flexWrap: "wrap" as const },
      candidate: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      candidateText: { flex: 1, gap: 2 },
      candidateTitle: { color: colors.foreground, fontSize: 13 },
    };
  }, [theme, compact]);

  function doLaunch(): void {
    if (provider === "" || busy) return;
    setBusy(true);
    launch({ provider, modeId })
      .then((result) => {
        toast.show("The first mate is aboard.", { variant: "success" });
        onLaunched(result.agentId);
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setBusy(false));
  }

  function doAdopt(agentId: string): void {
    setBusy(true);
    adopt({ agentId })
      .then(() => {
        toast.show("Adopted as the first mate.", { variant: "success" });
        onLaunched(agentId);
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setBusy(false));
  }

  const list = agents.data?.agents ?? [];

  return (
    <View style={styles.panel}>
      <View style={{ gap: 6 }}>
        <Text style={styles.title}>Hoist the first mate</Text>
        <Text style={styles.body}>
          You talk to one agent — the first mate — and it runs the crew: every task goes to a worker agent in its
          own git worktree, and the first mate supervises them and brings you finished pull requests, findings and
          the decisions only you can make.
        </Text>
        <Text style={styles.muted}>
          Its home is {shortPath(home, 72)}. Launching writes its charter (AGENTS.md) and records there, and starts it.
          Change the home in the FirstMate settings.
        </Text>
      </View>

      <SettingsSection title="Launch">
        <OptionPicker
          label="Model"
          hint="The first mate's own model. It picks the crew's unless the settings name one."
          title="The first mate's model"
          value={provider}
          options={withCurrent(models.options, provider)}
          searchPlaceholder={models.loading ? "Loading models…" : "Search models"}
          onSelect={setProvider}
          theme={theme}
          compact={compact}
        />
        <SettingsSelect
          label="Mode"
          hint="Its permission mode. It runs Paseo's tools constantly, so a mode that asks before each one is tiring."
          value={modeOptions.some((option) => option.value === modeId) ? modeId : PROVIDER_DEFAULT}
          options={modeOptions}
          onValueChange={setModeId}
          disabled={provider === ""}
        />
      </SettingsSection>
      <View style={styles.actions}>
        <IconButton
          icon="Ship"
          label={busy ? "Launching…" : "Launch the first mate"}
          showLabel
          tone="accent"
          theme={theme}
          disabled={busy || provider === ""}
          onPress={doLaunch}
        />
      </View>

      {list.length === 0 ? null : (
        <View style={{ gap: 4 }}>
          <Text style={styles.muted}>Or adopt an agent that is already running:</Text>
          {list.slice(0, 12).map((agent) => (
            <View key={agent.id} style={styles.candidate}>
              <View style={styles.candidateText}>
                <Text style={styles.candidateTitle} numberOfLines={1}>
                  {agent.title ?? "Untitled agent"}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {[
                    modelLabel(agent),
                    agent.cwd === agents.data?.home ? "in the home" : shortPath(agent.cwd, 40),
                    relativeTime(agent.updatedAt),
                  ].join(" · ")}
                </Text>
              </View>
              <IconButton
                icon="UserCheck"
                label="Adopt"
                showLabel
                theme={theme}
                disabled={busy}
                onPress={() => doAdopt(agent.id)}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
