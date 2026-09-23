/**
 * Settings › Plugins › Herald. Two groups, two stores:
 *
 * - **Speech** is the host settings document from `shared/settings.ts` — read
 *   by every client of this daemon, acted on by each according to its own
 *   platform switch. Saved through `useSettings`.
 * - **Summaries** is the daemon's file — which events get a summary, which
 *   model writes it, and the prompt it is written from — read by the hooks, so
 *   it goes through two RPCs.
 *
 * Async function expressions only; see `client/herald.tsx`.
 */
import { type PluginSurfaceProps, usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsGroup,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import {
  ANNOUNCE_KEYS,
  listSpeechVoices,
  readConfig,
  writeConfig,
  type AnnounceKey,
  type HeraldConfig,
  type SpeechVoice,
} from "../shared/herald";
import {
  RATE_OPTIONS,
  speechSettings,
  type RateOption,
  type SpeechEngine,
  type SpeechSettings,
} from "../shared/settings";
import { getAnnouncer, mirrorSettings } from "./announcer";
import { OptionPicker, type PickerOption } from "./option-picker";
import { PromptEditor } from "./prompt-editor";
import { canSpeak, listVoices, onVoicesChanged, speechPlatform, type Voice } from "./web";

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
  const voiceOptions = useMemo((): PickerOption[] => {
    const options: PickerOption[] = voices.map((voice) => ({ label: voice.name, value: voice.name, detail: voice.lang }));
    const current = settings.status === "ready" ? settings.values.voice : "";
    if (current !== "" && !options.some((option) => option.value === current)) {
      options.unshift({ label: current, value: current, detail: "not on this device" });
    }
    return [{ label: "System default", value: "" }, ...options];
  }, [voices, settings]);

  // ---- the daemon Mac's voices ---------------------------------------------
  const fetchSayVoices = useRpc(listSpeechVoices);
  const [sayVoices, setSayVoices] = useState<{ available: boolean; voices: SpeechVoice[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSayVoices({})
      .then((result) => {
        if (!cancelled) setSayVoices(result);
      })
      .catch((caught: unknown) => {
        console.warn("[herald] could not list say voices", caught);
        if (!cancelled) setSayVoices({ available: false, voices: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [fetchSayVoices]);
  const sayVoiceOptions = useMemo((): PickerOption[] => {
    const options: PickerOption[] = (sayVoices?.voices ?? []).map((voice) => ({
      label: voice.name,
      value: voice.name,
      detail: voice.lang,
    }));
    const current = settings.status === "ready" ? settings.values.sayVoice : "";
    if (current !== "" && !options.some((option) => option.value === current)) {
      options.unshift({ label: current, value: current, detail: "not installed on the daemon" });
    }
    return [{ label: "The Mac's default voice", value: "" }, ...options];
  }, [sayVoices, settings]);

  const [testing, setTesting] = useState(false);
  const onTest = useCallback(
    async function onTest() {
      const announcer = getAnnouncer();
      if (announcer === null) return;
      setTesting(true);
      try {
        // Forced: this is where the voice is chosen, so it has to speak even
        // with announcements off, and on the web it is the press that hands
        // the browser its audio permission.
        await announcer.speakText("This is Herald. Your agents will be announced like this.", { force: true });
      } catch (caught) {
        toast.error(errorText(caught));
      } finally {
        setTesting(false);
      }
    },
    [toast],
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

  const [models, setModels] = useState<PickerOption[]>([]);
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
      const options: PickerOption[] = [];
      lists.forEach((result, index) => {
        const provider = providers[index];
        if (result === null || provider === undefined) return;
        (result.models ?? [])
          .filter((model) => model.isSelectable !== false)
          .forEach((model) => options.push({ label: model.label, value: `${provider}/${model.id}`, detail: provider }));
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

  const modelOptions = useMemo((): PickerOption[] => {
    const current = config?.summarizer.provider ?? "";
    if (current === "" || models.some((option) => option.value === current)) return models;
    return [{ label: current, value: current, detail: "typed in" }, ...models];
  }, [models, config]);

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
        {platform === "mobile" ? null : (
          <SettingsSection
            title="Voice"
            info={
              <Text style={styles.note}>
                The daemon Mac can render each sentence with its own voices, which sound far better than a
                browser's, and this device plays the audio. If the daemon is not a Mac, or a render fails,
                the browser voice is used instead.
              </Text>
            }
          >
            <SettingsSelect<SpeechEngine>
              label="Voice source"
              value={speech?.engine ?? "say"}
              options={[
                {
                  label: sayVoices?.available === false ? "The daemon Mac (say) — not available" : "The daemon Mac (say)",
                  value: "say",
                },
                { label: "This device's browser voice", value: "web" },
              ]}
              disabled={speech === null}
              onValueChange={(value) => void saveSpeech({ engine: value })}
            />
            {speech?.engine === "say" ? (
              <OptionPicker
                label="Mac voice"
                hint="Installed on the daemon Mac. Add more under System Settings › Accessibility › Spoken Content there."
                title="Mac voice"
                searchPlaceholder="Search voices or languages"
                value={speech.sayVoice}
                options={sayVoiceOptions}
                disabled={sayVoices === null || !sayVoices.available}
                onSelect={(value) => void saveSpeech({ sayVoice: value })}
                theme={theme}
                compact={layout.compact}
              />
            ) : canSpeak() ? (
              <OptionPicker
                label="Browser voice"
                hint="A system voice on this device. Other devices keep their own default."
                title="Browser voice"
                searchPlaceholder="Search voices or languages"
                value={speech?.voice ?? ""}
                options={voiceOptions}
                disabled={speech === null}
                onSelect={(value) => void saveSpeech({ voice: value })}
                theme={theme}
                compact={layout.compact}
              />
            ) : null}
            <SettingsSelect<RateOption>
              label="Speed"
              value={speech?.rate ?? "1"}
              options={RATE_OPTIONS.map((rate) => ({ label: RATE_LABELS[rate], value: rate }))}
              disabled={speech === null}
              onValueChange={(value) => void saveSpeech({ rate: value })}
            />
            <SettingsAction
              label="Test voice"
              hint="Speaks one sentence with the settings above."
              actionLabel={testing ? "Speaking…" : "Speak"}
              disabled={testing || speech === null}
              onPress={() => void onTest()}
            />
          </SettingsSection>
        )}
      </SettingsGroup>

      <SettingsGroup title="Summaries">
        <SettingsSection
          title="Model"
          info={
            <Text style={styles.note}>
              Each summary is one short turn of a helper agent on the daemon, placed under the agent it
              describes. A small, fast model is plenty for one sentence.
            </Text>
          }
        >
          {configError === null ? null : <Text style={styles.error}>{configError}</Text>}
          <OptionPicker
            label="Summary model"
            title="Summary model"
            searchPlaceholder="Search models or providers"
            value={config?.summarizer.provider ?? ""}
            options={modelOptions}
            disabled={config === null}
            onSelect={(value) => {
              if (config !== null && value !== "") void saveConfig({ ...config, summarizer: { ...config.summarizer, provider: value } });
            }}
            theme={theme}
            compact={layout.compact}
          />
        </SettingsSection>
        <SettingsSection
          title="Prompt"
          info={
            <Text style={styles.note}>
              What the helper is asked, before every summary. Herald fills in the agent, the event and
              what was said; the rest is yours — the length, the tone, the language, what matters for
              each kind of event.
            </Text>
          }
        >
          <PromptEditor
            label="Summary prompt"
            hint="Opens the prompt for editing, with the list of placeholders Herald fills in."
            value={config?.summarizer.prompt ?? ""}
            disabled={config === null}
            onSave={(next) => {
              if (config !== null) void saveConfig({ ...config, summarizer: { ...config.summarizer, prompt: next } });
            }}
            theme={theme}
            compact={layout.compact}
          />
        </SettingsSection>
        <SettingsSection
          title="Helper sessions"
          info={
            <Text style={styles.note}>
              A helper agent is a session like any other, so every summary would otherwise leave one
              behind in your history. Herald deletes each one as its sentence is written, and clears any
              left over shortly after the daemon starts.
            </Text>
          }
        >
          <SettingsSwitch
            label="Delete the helper when it is done"
            hint="Off keeps every helper session, so you can read what it was asked and what it answered."
            value={config?.cleanup.deleteHelpers ?? true}
            disabled={config === null}
            onValueChange={(value) => {
              if (config !== null) void saveConfig({ ...config, cleanup: { ...config.cleanup, deleteHelpers: value } });
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
          <SettingsSwitch
            label="Agents started by another agent"
            hint="Subagents and FirstMate workers report to the agent that started them, and Paseo tells it when they finish, fail or need a permission, so you hear that agent instead. On announces both."
            value={config?.subagents.announce ?? false}
            disabled={config === null}
            onValueChange={(value) => {
              if (config !== null) void saveConfig({ ...config, subagents: { ...config.subagents, announce: value } });
            }}
          />
        </SettingsSection>
      </SettingsGroup>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
