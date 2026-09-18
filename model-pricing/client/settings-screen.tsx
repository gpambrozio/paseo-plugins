/**
 * Settings › Plugins › Model pricing.
 *
 * One store, unlike herald's two: every value here is drawn and none is read by
 * the daemon, so the whole screen is the host settings document from
 * `shared/settings.ts` and there is no config RPC.
 *
 * The provider switches are the "what to refresh" half of the request as well
 * as the "what to show" half — the surface passes the enabled ids into
 * `pricing.load`, so a provider switched off is not fetched either.
 *
 * Async function expressions only; see `client/pricing.tsx`.
 */
import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsGroup, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo } from "react";
import { ScrollView, Text, View } from "react-native";

import { PROVIDERS } from "../shared/providers";
import { displaySettings, INPUT_WEIGHTS, type DisplaySettings, type InputWeight } from "../shared/settings";

/**
 * Six presets rather than a free number: `SettingsSelect`'s popover does not
 * scroll, which caps a select at about ten options — and a slider would imply
 * a precision the ranking does not have.
 */
const WEIGHT_LABELS: Record<InputWeight, string> = {
  "100": "Input only",
  "80": "80 / 20 — agent workloads",
  "75": "75 / 25",
  "50": "50 / 50 — a plain average",
  "25": "25 / 75",
  "0": "Output only",
};

/** Why a user might care that a provider is on, beyond its name. */
const PROVIDER_HINTS: Record<string, string> = {
  anthropic: "Claude models. Prices come from the models.dev catalog.",
  openai: "GPT models. Prices come from the models.dev catalog.",
  fireworks: "Open-weight models hosted by Fireworks. From the models.dev catalog.",
  ollama: "The models Ollama hosts in its cloud, not the ones pulled on this machine.",
  openrouter: "Several hundred models from one gateway, read live from OpenRouter itself.",
};

export function PricingSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(displaySettings);
  const toast = useToast();

  const save = useCallback(
    async function save(patch: Partial<DisplaySettings>) {
      if (settings.status !== "ready") return;
      const saved = await settings.save({ ...settings.values, ...patch }, settings.revision);
      if (!saved) toast.error(settings.saveError ?? "Those settings were not saved.");
    },
    [settings, toast],
  );

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 12 : 20, gap: 16 },
      note: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      pad: { height: 24 },
    }),
    [theme, layout.compact],
  );

  const display = settings.status === "ready" ? settings.values : null;
  const chosen = new Set(display?.providers ?? []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SettingsGroup title="Model pricing">
        <SettingsSection
          title="Providers"
          info={
            <Text style={styles.note}>
              A provider switched off is not fetched and not shown. Anthropic, OpenAI and Fireworks do not
              publish prices through their own APIs, so those three and Ollama Cloud are read from the
              community models.dev catalog; OpenRouter publishes its own and is read directly. No API keys
              are needed for any of it.
            </Text>
          }
        >
          {PROVIDERS.map((provider) => (
            <SettingsSwitch
              key={provider.id}
              label={provider.label}
              hint={PROVIDER_HINTS[provider.id] ?? provider.doc}
              value={chosen.has(provider.id)}
              disabled={display === null}
              onValueChange={(value) => {
                if (display === null) return;
                const next = value
                  ? [...display.providers.filter((id) => id !== provider.id), provider.id]
                  : display.providers.filter((id) => id !== provider.id);
                void save({ providers: next });
              }}
            />
          ))}
        </SettingsSection>

        <SettingsSection
          title="The table"
          info={
            <Text style={styles.note}>
              The relative column blends each model's input and output price into one number and divides it
              by the cheapest model on screen, so the cheapest always reads 1.0×. How much of that blend is
              input is a real choice: an agent that reads a repository and writes a patch is mostly input,
              a chat that drafts prose is mostly output, and the ranking reorders between the two.
            </Text>
          }
        >
          <SettingsSelect<InputWeight>
            label="Input / output blend"
            hint="Used only for the relative column. The prices themselves are always shown in full."
            value={display?.inputWeight ?? "80"}
            options={INPUT_WEIGHTS.map((weight) => ({ label: WEIGHT_LABELS[weight], value: weight }))}
            disabled={display === null}
            onValueChange={(value) => void save({ inputWeight: value })}
          />
          <SettingsSwitch
            label="Only models that can call tools"
            hint="On by default: a model that cannot call a tool cannot run an agent. Models whose provider does not say either way are always shown."
            value={display?.toolCallOnly ?? true}
            disabled={display === null}
            onValueChange={(value) => void save({ toolCallOnly: value })}
          />
        </SettingsSection>
      </SettingsGroup>

      <View style={styles.pad} />
    </ScrollView>
  );
}
