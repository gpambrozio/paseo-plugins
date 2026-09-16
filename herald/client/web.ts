/**
 * Every browser global this plugin touches, in the one module the root
 * CLAUDE.md allows them in. Each export declares the narrow shape of the
 * globals it uses, gates on `Platform.OS`, and gives native the alternative or
 * a no-op — so the rest of `client/` never reaches for `window` and typechecks
 * without the DOM library.
 *
 * Speech is the Web Speech API and nothing else: the host provides plugin code
 * no audio module, and React Native core has none. That is why a phone gets a
 * vibration at most, and why the two web cases differ — the Electron desktop
 * speaks unprompted, a browser tab only once the page has been tapped, because
 * Chromium and WebKit drop `speak()` without user activation and fire no event.
 */
import { Platform, Vibration } from "react-native";

interface WebVoice {
  readonly name: string;
  readonly lang: string;
  readonly default: boolean;
}

interface WebUtterance {
  text: string;
  rate: number;
  voice: WebVoice | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

interface WebSynth {
  speak(utterance: WebUtterance): void;
  cancel(): void;
  getVoices(): WebVoice[];
  readonly speaking: boolean;
  addEventListener?(type: "voiceschanged", listener: () => void): void;
  removeEventListener?(type: "voiceschanged", listener: () => void): void;
}

interface WebGlobals {
  speechSynthesis?: WebSynth;
  SpeechSynthesisUtterance?: new (text: string) => WebUtterance;
  /** The desktop preload's bridge; present in the Electron renderer and nowhere else. */
  paseoDesktop?: unknown;
}

function web(): WebGlobals | null {
  return Platform.OS === "web" ? (globalThis as WebGlobals) : null;
}

export type SpeechPlatform = "desktop" | "browser" | "mobile";

export function speechPlatform(): SpeechPlatform {
  const globals = web();
  if (globals === null) return "mobile";
  return globals.paseoDesktop === undefined ? "browser" : "desktop";
}

export function canSpeak(): boolean {
  const globals = web();
  return (
    globals !== null &&
    typeof globals.speechSynthesis?.speak === "function" &&
    typeof globals.SpeechSynthesisUtterance === "function"
  );
}

export interface Voice {
  name: string;
  lang: string;
}

/** Empty until the browser has loaded its voice list; see `onVoicesChanged`. */
export function listVoices(): Voice[] {
  const synth = web()?.speechSynthesis;
  if (synth === undefined) return [];
  return synth
    .getVoices()
    .map((voice) => ({ name: voice.name, lang: voice.lang }))
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}

export function onVoicesChanged(listener: () => void): () => void {
  const synth = web()?.speechSynthesis;
  if (synth?.addEventListener === undefined) return () => {};
  synth.addEventListener("voiceschanged", listener);
  return () => synth.removeEventListener?.("voiceschanged", listener);
}

export interface SpeakOptions {
  /** A voice name from `listVoices`, or empty for the platform default. */
  voice: string;
  rate: number;
}

/**
 * Chromium collects an utterance that nothing references before it ends, and
 * then never fires `onend`; holding it here until it finishes is the known
 * workaround.
 */
const inFlight = new Set<WebUtterance>();

/**
 * Resolves when the utterance ends. It also resolves after a generous guard
 * time, because a browser that dropped the call for lack of user activation
 * fires nothing at all, and a queue waiting on that event would never move.
 * Rejects only when there is no speech synthesis here.
 */
export function speak(text: string, options: SpeakOptions): Promise<void> {
  const globals = web();
  const synth = globals?.speechSynthesis;
  const Utterance = globals?.SpeechSynthesisUtterance;
  if (synth === undefined || Utterance === undefined || !canSpeak()) {
    return Promise.reject(new Error("Speech synthesis is not available here."));
  }
  return new Promise<void>((resolve) => {
    const utterance = new Utterance(text);
    utterance.rate = options.rate;
    if (options.voice !== "") {
      const match = synth.getVoices().find((voice) => voice.name === options.voice);
      if (match !== undefined) utterance.voice = match;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      inFlight.delete(utterance);
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    inFlight.add(utterance);
    setTimeout(finish, Math.max(8_000, text.length * 150));
    synth.speak(utterance);
  });
}

export function stopSpeaking(): void {
  web()?.speechSynthesis?.cancel();
}

/** The most a phone can do from plugin code. A no-op on web. */
export function vibrate(): void {
  if (Platform.OS !== "web") Vibration.vibrate();
}
