/**
 * The contracts both halves agree on: what one "needs you" entry looks like,
 * the RPC that lists them, and the daemon-side configuration document.
 *
 * Which side owns a value follows the rule in the root CLAUDE.md — the side that
 * has to *read* it. Everything in `HeraldConfigSchema` is read by the daemon's
 * hooks (which events to summarise, which model writes the summary), so it
 * lives in the daemon's own file behind two RPCs. How the summary is *spoken*
 * is read only by the app and lives in `shared/settings.ts`.
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Why an agent is waiting. The first three come from permission requests —
 * Paseo maps Claude's AskUserQuestion to `question` and ExitPlanMode to
 * `plan`, and everything else that pauses for approval is `permission`. The
 * last three come from how a turn ended.
 */
export const ATTENTION_REASONS = [
  "question",
  "plan",
  "permission",
  "finished",
  "error",
  "canceled",
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];
export const AttentionReasonSchema = z.enum(ATTENTION_REASONS);

/**
 * The summary's lifecycle. `pending` while the helper agent is writing;
 * `ready` with its sentence; `failed` with the reason and a deterministic
 * fallback built from the raw event; `off` when the event kind is switched
 * off in the daemon config — recorded so the panel can still show the
 * headline, but never spoken.
 */
export const SummaryStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("ready"), text: z.string(), model: z.string() }),
  z.object({ status: z.literal("failed"), error: z.string(), fallback: z.string() }),
  z.object({ status: z.literal("off"), fallback: z.string() }),
]);
export type SummaryState = z.infer<typeof SummaryStateSchema>;

export const AttentionEntrySchema = z.object({
  agentId: z.string(),
  workspaceId: z.string().nullable(),
  /**
   * The name the user knows the work by. Agents are usually untitled, so the
   * workspace's title (or name) is the headline and the agent's own title,
   * when it has one, is the second line. Defaulted so entries written before
   * the field existed still load.
   */
  workspaceTitle: z.string().nullable().default(null),
  agentTitle: z.string().nullable(),
  /**
   * The start of what the user last asked this agent, for telling two
   * untitled agents in one workspace apart. Null for a pause, which carries
   * no timeline.
   */
  lastRequest: z.string().nullable().default(null),
  cwd: z.string(),
  reason: AttentionReasonSchema,
  /** Unique per event, so a client can remember what it has already spoken. */
  eventId: z.string(),
  /** The permission request this entry answers to, when it is one. */
  requestId: z.string().nullable(),
  createdAt: z.string(),
  /** One line built without a model: the question, the command, "Finished". */
  headline: z.string(),
  /** The choices, the command, or the start of the final message. */
  detail: z.string().nullable(),
  summary: SummaryStateSchema,
});
export type AttentionEntry = z.infer<typeof AttentionEntrySchema>;

export const listAttention = defineRpc({
  name: "herald.list",
  input: z.object({}),
  output: z.object({ entries: z.array(AttentionEntrySchema) }),
});

// ---------------------------------------------------------------------------
// Speech rendered on the daemon

export const SpeechVoiceSchema = z.object({ name: z.string(), lang: z.string() });
export type SpeechVoice = z.infer<typeof SpeechVoiceSchema>;

/**
 * The daemon Mac's `say` voices, and whether `say` is there at all. The app
 * cannot run a command, but the daemon can, and its voices are better than
 * the browser's; so the daemon renders the sentence to audio and the app plays
 * the bytes.
 */
export const listSpeechVoices = defineRpc({
  name: "herald.speech.voices",
  input: z.object({}),
  output: z.object({ available: z.boolean(), voices: z.array(SpeechVoiceSchema) }),
});

export const MAX_SPEECH_CHARS = 2000;

export const renderSpeech = defineRpc({
  name: "herald.speech.render",
  input: z.object({
    text: z.string().min(1).max(MAX_SPEECH_CHARS),
    /** A `say` voice name, or empty for the Mac's default. */
    voice: z.string().default(""),
    /** A multiplier on the voice's natural pace. */
    rate: z.number().min(0.5).max(2).default(1),
  }),
  output: z.object({ mimeType: z.string(), base64: z.string() }),
});

// ---------------------------------------------------------------------------
// Daemon-side configuration

/** The event kinds a user can switch off. A canceled turn follows `error`. */
export const ANNOUNCE_KEYS = ["question", "plan", "permission", "finished", "error"] as const;
export type AnnounceKey = (typeof ANNOUNCE_KEYS)[number];

export function announceKeyFor(reason: AttentionReason): AnnounceKey {
  return reason === "canceled" ? "error" : reason;
}

export const DEFAULT_SUMMARIZER = {
  /** `provider/model`, the format the Paseo SDK takes. */
  provider: "claude/claude-haiku-4-5",
  /** How long one summary may take before it is given up on and the fallback is used. */
  timeoutMs: 90_000,
};

export const DEFAULT_ANNOUNCE: Record<AnnounceKey, boolean> = {
  question: true,
  plan: true,
  permission: true,
  finished: true,
  error: true,
};

/**
 * Spelled with full defaults at every level so that parsing `{}` — a daemon
 * that has never saved — yields a complete document. Zod 4 returns a
 * `.default()` value as-is without parsing it, which is why the defaults are
 * complete objects rather than `{}`.
 */
export const HeraldConfigSchema = z.object({
  summarizer: z
    .object({
      provider: z.string().min(1).default(DEFAULT_SUMMARIZER.provider),
      timeoutMs: z.number().int().min(10_000).max(600_000).default(DEFAULT_SUMMARIZER.timeoutMs),
    })
    .default(DEFAULT_SUMMARIZER),
  announce: z
    .object({
      question: z.boolean().default(true),
      plan: z.boolean().default(true),
      permission: z.boolean().default(true),
      finished: z.boolean().default(true),
      error: z.boolean().default(true),
    })
    .default(DEFAULT_ANNOUNCE),
});
export type HeraldConfig = z.infer<typeof HeraldConfigSchema>;

export const DEFAULT_CONFIG: HeraldConfig = {
  summarizer: { ...DEFAULT_SUMMARIZER },
  announce: { ...DEFAULT_ANNOUNCE },
};

export const readConfig = defineRpc({
  name: "herald.config.read",
  input: z.object({}),
  output: HeraldConfigSchema,
});

export const writeConfig = defineRpc({
  name: "herald.config.write",
  input: HeraldConfigSchema,
  output: HeraldConfigSchema,
});
