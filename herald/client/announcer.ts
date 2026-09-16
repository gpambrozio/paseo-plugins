/**
 * The part that runs while the app is open, whether or not the Herald panel
 * is on screen. `index.client.tsx` starts one per connected client and stops
 * it on cleanup; a surface would not do, because a surface is unmounted the
 * moment the user navigates anywhere.
 *
 * It pulls, because a plugin has no server-to-client push: a short poll of
 * the entries RPC, quickened when Paseo's own agent stream reports an agent
 * needing attention or a summary is still being written. Each entry is spoken
 * once per device, remembered by its event id.
 *
 * Async **function expressions**, never async arrows, anywhere in this file —
 * Hermes evaluates an async arrow in an eval'd bundle to `undefined`.
 */
import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";

import { listAttention, renderSpeech, type AttentionEntry } from "../shared/herald";
import { DEFAULT_SPEECH, speechSettings, type SpeechSettings } from "../shared/settings";
import { canPlayAudio, canSpeak, playAudio, speak, speechPlatform, vibrate } from "./web";

const IDLE_POLL_MS = 10_000;
const BUSY_POLL_MS = 2_000;

/**
 * The settings as last read by anything — the announcer's own RPC read or a
 * mounted screen's `useSettings` — and the fallback when the read fails.
 */
let mirroredSettings: SpeechSettings | null = null;

export function mirrorSettings(values: SpeechSettings): void {
  mirroredSettings = values;
}

/**
 * Muted on this device only. Module scope so it survives navigating away and
 * back, and nothing more: the settings document is shared by every client of
 * the daemon, which is the wrong place for "not right now, not here".
 */
let mutedHere = false;

export function isMutedHere(): boolean {
  return mutedHere;
}

export function setMutedHere(muted: boolean): void {
  mutedHere = muted;
}

/** What is said for an entry, or null when there is nothing to say yet or ever. */
export function speechText(entry: AttentionEntry): string | null {
  switch (entry.summary.status) {
    case "ready":
      return entry.summary.text;
    case "failed":
      return entry.summary.fallback;
    case "pending":
    case "off":
      return null;
  }
}

export interface Announcer {
  stop(): void;
  /** Poll now rather than at the next tick. */
  poke(): void;
  readSettings(): Promise<SpeechSettings>;
  /** Speak (or vibrate for) one entry regardless of whether it was announced before. */
  speakEntry(entry: AttentionEntry): Promise<void>;
  speakText(text: string): Promise<void>;
}

let active: Announcer | null = null;

/** The running announcer, for the panel's buttons. Null before the client entry has run. */
export function getAnnouncer(): Announcer | null {
  return active;
}

export function startAnnouncer(client: PluginClientContext): Announcer {
  let stopped = false;
  let polling = false;
  let seeded = false;
  let warnedSettings = false;
  let warnedSay = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const spoken = new Set<string>();
  /** Deliveries queue behind one another, so a button press never talks over the poll. */
  let chain: Promise<void> = Promise.resolve();

  async function readSettings(): Promise<SpeechSettings> {
    try {
      const result = await client.rpc(settingsRpc(speechSettings.id).read, {});
      if (result.status === "ready") {
        const parsed = speechSettings.schema.safeParse(result.values);
        if (parsed.success) {
          mirroredSettings = parsed.data;
          return parsed.data;
        }
      }
    } catch (error) {
      if (!warnedSettings) {
        warnedSettings = true;
        console.warn("[herald] could not read speech settings, using the last known values", error);
      }
    }
    return mirroredSettings ?? DEFAULT_SPEECH;
  }

  function allowedHere(settings: SpeechSettings): boolean {
    if (!settings.enabled || mutedHere) return false;
    switch (speechPlatform()) {
      case "desktop":
        return settings.speakOnDesktop;
      case "browser":
        return settings.speakInBrowser;
      case "mobile":
        return settings.vibrateOnMobile;
    }
  }

  /**
   * The daemon Mac's voice when asked for and reachable, the browser's voice
   * otherwise. A failed render or a refused playback falls through to the
   * browser voice rather than to silence, and is logged once.
   */
  async function deliverNow(text: string, settings: SpeechSettings): Promise<void> {
    if (speechPlatform() === "mobile") {
      vibrate();
      return;
    }
    const rate = Number(settings.rate);
    if (settings.engine === "say" && canPlayAudio()) {
      try {
        const audio = await client.rpc(renderSpeech, { text, voice: settings.sayVoice, rate });
        await playAudio(`data:${audio.mimeType};base64,${audio.base64}`);
        return;
      } catch (error) {
        if (!warnedSay) {
          warnedSay = true;
          console.warn("[herald] the daemon's say voice is unavailable, using the browser voice", error);
        }
      }
    }
    if (!canSpeak()) return;
    await speak(text, { voice: settings.voice, rate });
  }

  function deliver(text: string, settings: SpeechSettings): Promise<void> {
    const next = chain.then(
      function run() {
        return deliverNow(text, settings);
      },
      function runAfterFailure() {
        return deliverNow(text, settings);
      },
    );
    chain = next.catch(() => {});
    return next;
  }

  async function announce(entries: AttentionEntry[], settings: SpeechSettings): Promise<void> {
    // Oldest first, so a batch that arrived together reads in order.
    const ordered = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const entry of ordered) {
      spoken.add(entry.eventId);
      const text = speechText(entry);
      if (text !== null && allowedHere(settings)) await deliver(text, settings);
    }
  }

  function schedule(delay: number): void {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void poll(), delay);
  }

  async function poll(): Promise<void> {
    if (stopped || polling) return;
    polling = true;
    let busy = false;
    try {
      const { entries } = await client.rpc(listAttention, {});
      const present = new Set(entries.map((entry) => entry.eventId));
      if (!seeded) {
        // Whatever was already waiting when this client came up has been
        // waiting a while; the panel shows it, but it is not news to announce.
        entries.forEach((entry) => spoken.add(entry.eventId));
        seeded = true;
      }
      busy = entries.some((entry) => entry.summary.status === "pending");
      const fresh = entries.filter(
        (entry) => !spoken.has(entry.eventId) && entry.summary.status !== "pending",
      );
      if (fresh.length > 0) await announce(fresh, await readSettings());
      // Forget ids that are gone; an event id never comes back.
      for (const id of [...spoken]) if (!present.has(id)) spoken.delete(id);
    } catch (error) {
      console.warn("[herald] could not list what needs attention", error);
    } finally {
      polling = false;
      schedule(busy ? BUSY_POLL_MS : IDLE_POLL_MS);
    }
  }

  // Paseo's own stream says an agent needs attention before the summary is
  // ready; use it to start polling quickly rather than waiting for the tick.
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "upsert" && update.agent.requiresAttention) schedule(BUSY_POLL_MS / 2);
  });

  const announcer: Announcer = {
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
      if (active === announcer) active = null;
    },
    poke() {
      schedule(0);
    },
    readSettings,
    async speakEntry(entry) {
      const text = speechText(entry) ?? `${entry.agentTitle ?? "An agent"}: ${entry.headline}`;
      await deliver(text, await readSettings());
    },
    async speakText(text) {
      await deliver(text, await readSettings());
    },
  };
  active = announcer;
  schedule(500);
  return announcer;
}
