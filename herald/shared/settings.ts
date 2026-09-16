/**
 * How a summary is spoken, per daemon: the app reads it, the daemon never
 * does, so it is a host settings document rather than a daemon file.
 *
 * `scope: "host"` reaches every authorized client of one daemon, which is
 * why the platform switches exist: the same document is read on the desktop
 * app, in a browser tab, and on a phone, and each one only acts on its own
 * switch. That is how "speak on my Mac but not on my laptop's browser" is
 * expressed without per-device storage, which the SDK does not have.
 */
import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const RATE_OPTIONS = ["0.8", "1", "1.2", "1.5"] as const;
export type RateOption = (typeof RATE_OPTIONS)[number];

/**
 * Where the voice comes from. `say` has the daemon Mac render the sentence
 * with its own voices and the app play the audio; `web` is the browser's own
 * speech synthesis, which every web client has but which sounds worse. `say`
 * falls back to `web` when the daemon is not a Mac or the render fails.
 */
export const SPEECH_ENGINES = ["say", "web"] as const;
export type SpeechEngine = (typeof SPEECH_ENGINES)[number];

export const speechSettings = defineSettings({
  id: "speech",
  scope: "host",
  version: 1,
  schema: z.object({
    /** The master switch. Off means nothing is spoken or vibrated anywhere. */
    enabled: z.boolean().default(true),
    /** The Electron desktop app, which can speak without a click. */
    speakOnDesktop: z.boolean().default(true),
    /** A browser tab, which speaks only after the page has been tapped once. */
    speakInBrowser: z.boolean().default(true),
    /** Phones cannot speak from plugin code; a short buzz is the most they can do. */
    vibrateOnMobile: z.boolean().default(false),
    engine: z.enum(SPEECH_ENGINES).default("say"),
    /** A `say` voice on the daemon Mac by name, or empty for its default. */
    sayVoice: z.string().default(""),
    /** A browser voice by name, or empty for the platform default. Used by the `web` engine. */
    voice: z.string().default(""),
    /** Speech rate as a multiplier; kept as a string because it is picked from a list. */
    rate: z.enum(RATE_OPTIONS).default("1"),
  }),
});

export type SpeechSettings = z.infer<typeof speechSettings.schema>;

export const DEFAULT_SPEECH: SpeechSettings = {
  enabled: true,
  speakOnDesktop: true,
  speakInBrowser: true,
  vibrateOnMobile: false,
  engine: "say",
  sayVoice: "",
  voice: "",
  rate: "1",
};
