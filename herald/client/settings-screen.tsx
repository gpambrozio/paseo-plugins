/**
 * Settings › Plugins › Herald. Two groups, two stores:
 *
 * - **Speech** is the host settings document from `shared/settings.ts` — read
 *   by every client of this daemon, acted on by each according to its own
 *   platform switch. Saved through `useSettings`.
 * - **Summaries** is the daemon's file — which events get a summary and which
 *   model writes it — read by the hooks, so it goes through two RPCs.
 *
 * Async function expressions only; see `client/herald.tsx`.
 */
import { type PluginSurfaceProps, usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsGroup,
  SettingsInput,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { ANNOUNCE_KEYS, readConfig, writeConfig, type AnnounceKey, type HeraldConfig } from "../shared/herald";
import { RATE_OPTIONS, speechSettings, type RateOption, type SpeechSettings } from "../shared/settings";
import { mirrorSettings } from "./announcer";
import { canSpeak, listVoices, onVoicesChanged, speak, speechPlatform, type Voice } from "./web";

const RATE_LABELS: Record<RateOption, string> = {
  "0.8": "Slower",
  "1": "Normal",
  "1.2": "Faster",
  "1.5": "Fast",
};

const ANNOUNCE_LABELS: Record<AnnounceKey, { label: string; hint: string }> = {
  question: { label: "Questions", hint: "The agent asked you something and is waiting for the answer." },
  plan: { label: "Plan approvals", hint: "The agent wrote a plan and wants a go-ahead." },
  permission: { label: "Tool permissions", hint: "Allow-or-deny prompts for commands and edits. Noisy unless agents run restricted." },
  finished: { label: "Finished turns", hint: "The agent stopped and is waiting for your next message." },
  error: { label: "Errors and interruptions", hint: "The turn failed or was cancelled." },
};

interface ModelOption {
  label: string;
  value: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function HeraldSettingsScreen(props: PluginSurfaceProps) {
  const { theme, layout } = props;
  const toast = useToast();
  const paseo = usePaseo();
  const settings = useSettings(speechSettings);
  const read = useRpc(readConfig);
  const write = useRpc(writeConfig);

  // Keep the announcer's fallback current with what this screen shows.
  useEffect(() => {
    if (settings.status === "ready") mirrorSettings(settings.values);
  }, [settings]);

  const saveSpeech = useCallback(
    async function saveSpeech(patch: Partial<SpeechSettings>) {
      if (settings.status !== "ready") return;
      const next = { ...settings.values, ...patch };
      const saved = await settings.save(next, settings.revision);
      if (saved) mirrorSettings(next);
      else toast.error(settings.saveError ?? "The speech settings were not saved.");
    },
    [settings, toast],
  );

  // ---- voices -------------------------------------------------------------
  const [voices, setVoices] = useState<Voice[]>(() => listVoices());
  useEffect(() => onVoicesChanged(() => setVoices(listVoices())), []);
  const voiceOptions = useMemo(() => {
    const options = voices.map((voice) => ({ label: `${voice.name} (${voice.lang})`, value: voice.name }));
    const current = settings.status === "ready" ? settings.values.voice : "";
    if (current !== "" && !options.some((option) => option.value === current)) {
      options.unshift({ label: `${current} (not on this device)`, value: current });
    }
    return [{ label: "System default", value: "" }, ...options];
  }, [voices, settings]);

  const [testing, setTesting] = useState(false);
  const onTest = useCallback(
    async function onTest() {
      if (settings.status !== "ready") return;
      setTesting(true);
      try {
        await speak("This is Herald. Your agents will be announced like this.", {
          voice: settings.values.voice,
          rate: Number(settings.values.rate),
        });
      } catch (caught) {
        toast.error(errorText(caught));
      } finally {
        setTesting(false);
      }
    },
    [settings, toast],
  );

  // ---- daemon config ------------------------------------------------------
  const [config, setConfig] = useState<HeraldConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    read({})
      .then((loaded) => {
        if (!cancelled) setConfig(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setConfigError(errorText(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [read]);

  const saveConfig = useCallback(
    async function saveConfig(next: HeraldConfig) {
      setConfig(next);
      try {
        setConfig(await write(next));
        setConfigError(null);
      } catch (caught) {
        setConfigError(errorText(caught));
        toast.error(errorText(caught));
      }
    },
    [write, toast],
  );

  const [models, setModels] = useState<ModelOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      const available = await paseo.providers.listAvailable();
      const providers = available.providers.filter((entry) => entry.available).map((entry) => entry.provider);
      const lists = await Promise.all(
        providers.map(function (provider) {
          return paseo.providers.listModels(provider).catch(() => null);
        }),
      );
      const options: ModelOption[] = [];
      lists.forEach((result, index) => {
        const provider = providers[index];
        if (result === null || provider === undefined) return;
        (result.models ?? [])
          .filter((model) => model.isSelectable !== false)
          .forEach((model) => options.push({ label: `${provider} · ${model.label}`, value: `${provider}/${model.id}` }));
      });
      if (!cancelled) setModels(options);
    }
    loadModels().catch((caught: unknown) => {
      console.warn("[herald] could not list models", caught);
    });
    return () => {
      cancelled = true;
    };
  }, [paseo]);

  const modelOptions = useMemo(() => {
    const current = config?.summarizer.provider ?? "";
    if (current === "" || models.some((option) => option.value === current)) return models;
    return [{ label: current, value: current }, ...models];
  }, [models, config]);

  const [customModel, setCustomModel] = useState("");

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 12 : 20, gap: 16 },
      note: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
    }),
    [theme, layout.compact],
  );

  const platform = speechPlatform();
  const speech = settings.status === "ready" ? settings.values : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SettingsGroup title="Speech">
        <SettingsSection
          title="Where to speak"
          info={
            <Text style={styles.note}>
              These switches are shared by every device connected to this daemon; each device follows its
              own. You are on {platform === "desktop" ? "the desktop app" : platform === "browser" ? "a browser tab" : "a phone"}.
            </Text>
          }
        >
          <SettingsSwitch
            label="Announce out loud"
            hint="The master switch. Off means nothing is spoken or vibrated anywhere."
            value={speech?.enabled ?? true}
            disabled={speech === null}
            onValueChange={(value) => void saveSpeech({ enabled: value })}
          />
          <SettingsSwitch
            label="Speak on the desktop app"
            value={speech?.speakOnDesktop ?? true}
            disabled={speech === null}
            onValueChange={(value) => void saveSpeech({ speakOnDesktop: value })}
          />
          <SettingsSwitch
            label="Speak in a browser tab"
            hint="A browser only lets a page speak after it has been tapped once."
            value={speech?.speakInBrowser ?? true}
            disabled={speech === null}
            onValueChange={(value) => void saveSpeech({ speakInBrowser: value })}
          />
          <SettingsSwitch
            label="Vibrate on phones"
            hint="Phones cannot speak from a plugin yet; a short buzz is the most they can do."
            value={speech?.vibrateOnMobile ?? false}
            disabled={speech === null}
            onValueChange={(value) => void saveSpeech({ vibrateOnMobile: value })}
          />
        </SettingsSection>
        {canSpeak() ? (
          <SettingsSection title="Voice">
            <SettingsSelect
              label="Voice"
              hint="A system voice on this device. Other devices keep their own default."
              value={speech?.voice ?? ""}
              options={voiceOptions}
              disabled={speech === null}
              onValueChange={(value) => void saveSpeech({ voice: value })}
            />
            <SettingsSelect<RateOption>
              label="Speed"
              value={speech?.rate ?? "1"}
              options={RATE_OPTIONS.map((rate) => ({ label: RATE_LABELS[rate], value: rate }))}
              disabled={speech === null}
              onValueChange={(value) => void saveSpeech({ rate: value })}
            />
            <SettingsAction
              label="Test voice"
              hint="Speaks one sentence with the voice and speed above."
              actionLabel={testing ? "Speaking…" : "Speak"}
              disabled={testing || speech === null}
              onPress={() => void onTest()}
            />
          </SettingsSection>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Summaries">
        <SettingsSection
          title="Model"
          info={
            <Text style={styles.note}>
              Each summary is one short turn of a helper agent on the daemon, placed under the agent it
              describes and archived when it finishes. A small, fast model is plenty for one sentence.
            </Text>
          }
        >
          {configError === null ? null : <Text style={styles.error}>{configError}</Text>}
          <SettingsSelect
            label="Summary model"
            value={config?.summarizer.provider ?? ""}
            options={modelOptions.length > 0 ? modelOptions : [{ label: config?.summarizer.provider ?? "Loading…", value: config?.summarizer.provider ?? "" }]}
            disabled={config === null}
            onValueChange={(value) => {
              if (config !== null && value !== "") void saveConfig({ ...config, summarizer: { ...config.summarizer, provider: value } });
            }}
          />
          <SettingsInput
            label="Or type one"
            hint="provider/model, as Paseo names them — for example claude/claude-haiku-4-5."
            placeholder="provider/model"
            onChangeText={setCustomModel}
            disabled={config === null}
          />
          <SettingsAction
            label="Use the typed model"
            actionLabel="Use"
            disabled={config === null || customModel.trim() === "" || !customModel.includes("/")}
            onPress={() => {
              if (config !== null) void saveConfig({ ...config, summarizer: { ...config.summarizer, provider: customModel.trim() } });
            }}
          />
        </SettingsSection>
        <SettingsSection
          title="What gets announced"
          info={<Text style={styles.note}>An event that is switched off still appears in the Herald panel, without a summary and without being spoken.</Text>}
        >
          {ANNOUNCE_KEYS.map((key) => (
            <SettingsSwitch
              key={key}
              label={ANNOUNCE_LABELS[key].label}
              hint={ANNOUNCE_LABELS[key].hint}
              value={config?.announce[key] ?? true}
              disabled={config === null}
              onValueChange={(value) => {
                if (config !== null) void saveConfig({ ...config, announce: { ...config.announce, [key]: value } });
              }}
            />
          ))}
        </SettingsSection>
      </SettingsGroup>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
