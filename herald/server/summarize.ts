/**
 * One summary is one short-lived Paseo agent: created as a delegated child of
 * the agent it describes, so it shows under that agent's subagent track rather
 * than as a tab of its own, and archived by the daemon the moment its single
 * turn ends (`autoArchive`).
 *
 * The SDK cannot mark an agent internal, so this helper is visible and fires
 * this plugin's own hooks. `HELPER_TITLE` is one of the two things
 * `server/hooks.ts` uses to recognise and ignore it; the id reported through
 * `onHelperCreated` is the other.
 */
import type { PaseoApi } from "@getpaseo/client";
import { z } from "zod";

import type { AttentionReason } from "../shared/herald";
import { firstWords, plainText } from "./timeline";

export const HELPER_TITLE = "Herald summary";

/** Enough of a final message for a summary; the rest is never what the user needs to hear. */
const MAX_OUTPUT_CHARS = 6000;
const MAX_USER_CHARS = 600;

export interface SummaryRequest {
  agent: { id: string; workspaceId: string | null; cwd: string; title: string | null };
  reason: AttentionReason;
  headline: string;
  detail: string | null;
  /** What the agent said after the user's last message; empty for a pause. */
  output: string;
  lastUser: string | null;
}

export interface SummarizerDeps {
  paseo: PaseoApi;
  /** `provider/model`, as the SDK takes it. */
  provider: string;
  timeoutMs: number;
  /** Called as soon as the helper exists, before its first turn can end. */
  onHelperCreated?: (helperId: string) => void;
}

export interface Summary {
  text: string;
  model: string;
}

const SUMMARY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    speech: {
      type: "string",
      description: "One or two spoken sentences, under 35 words, plain text.",
    },
  },
  required: ["speech"],
  additionalProperties: false,
} as const;

const SummaryOutput = z.object({ speech: z.string().trim().min(1) });

function describeReason(reason: AttentionReason): string {
  switch (reason) {
    case "question":
      return "The agent has paused to ask the user a question.";
    case "plan":
      return "The agent has written a plan and is waiting for the user to approve it.";
    case "permission":
      return "The agent has paused for permission to do something.";
    case "finished":
      return "The agent finished its turn and is waiting for the user.";
    case "error":
      return "The agent's turn failed with an error.";
    case "canceled":
      return "The agent's turn was interrupted.";
  }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[…truncated]`;
}

function basename(path: string): string {
  const parts = path.split("/").filter((part) => part !== "");
  return parts[parts.length - 1] ?? path;
}

export function buildPrompt(request: SummaryRequest): string {
  const name = request.agent.title?.trim() || "an agent";
  const lines = [
    "You are Herald. You tell a developer, out loud, what one of their coding agents needs.",
    "Answer with the JSON object only. Do not run tools, read files, or ask anything back.",
    "",
    `Agent: "${name}", working in ${basename(request.agent.cwd)}.`,
    `Event: ${describeReason(request.reason)}`,
    `Headline: ${request.headline}`,
  ];
  if (request.detail !== null && request.detail.trim() !== "") {
    lines.push(`Detail: ${request.detail.trim()}`);
  }
  if (request.lastUser !== null) {
    lines.push("", "What the user last asked for:", clip(request.lastUser, MAX_USER_CHARS));
  }
  if (request.output.trim() !== "") {
    lines.push("", "What the agent said:", clip(request.output, MAX_OUTPUT_CHARS));
  }
  lines.push(
    "",
    "Write what should be spoken: one or two sentences, under 35 words, plain text with no markdown,",
    "no code, and no file paths unless nothing else identifies the work. Start with the agent's name.",
    "For a question, say what is being asked and the choices. For finished work, say what was done",
    "and whether anything is left for the user. For a permission, say what the agent wants to do.",
  );
  return lines.join("\n");
}

/**
 * The daemon returns structured output as a JSON string in `lastMessage`. A
 * model that ignored the schema and wrote prose is still worth hearing, so
 * that is the last resort rather than a failure.
 */
export function parseSummaryText(lastMessage: string | null): string {
  const raw = lastMessage?.trim() ?? "";
  if (raw === "") throw new Error("The summary agent returned nothing.");
  const candidates = [raw];
  const braces = raw.match(/\{[\s\S]*\}/);
  if (braces !== null && braces[0] !== raw) candidates.push(braces[0]);
  for (const candidate of candidates) {
    try {
      const parsed = SummaryOutput.safeParse(JSON.parse(candidate));
      if (parsed.success) return plainText(parsed.data.speech);
    } catch {
      // Not JSON; try the next candidate.
    }
  }
  return firstWords(raw, 45);
}

export async function summarize(request: SummaryRequest, deps: SummarizerDeps): Promise<Summary> {
  if (request.agent.workspaceId === null) {
    throw new Error("The agent has no workspace, so there is nowhere to place a summary helper.");
  }
  const workspace = deps.paseo.workspaces.ref(request.agent.workspaceId);
  const helper = await workspace.agents.create({
    config: { provider: deps.provider },
    parent: request.agent.id,
    title: HELPER_TITLE,
    autoArchive: true,
    outputSchema: SUMMARY_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    prompt: buildPrompt(request),
    labels: { "herald.role": "summarizer" },
  });
  deps.onHelperCreated?.(helper.id);
  try {
    const result = await helper.waitForFinish(deps.timeoutMs);
    if (result.status === "permission") {
      // The prompt forbids tools; a helper that asks anyway is answered so it
      // does not sit in the subagent track waiting forever, then given up on.
      const pending = result.final?.pendingPermissions ?? [];
      await Promise.all(
        pending.map((request) =>
          helper.respondToPermission({
            requestId: request.id,
            response: { behavior: "deny", message: "Herald summaries must not use tools.", interrupt: true },
          }),
        ),
      );
      throw new Error("The summary agent tried to use a tool.");
    }
    if (result.status !== "idle") {
      throw new Error(result.error ?? `The summary agent ended with status ${result.status}.`);
    }
    return { text: parseSummaryText(result.lastMessage), model: deps.provider };
  } catch (error) {
    // autoArchive only fires on a finished turn; a helper that timed out or
    // was denied is still there and has to be put away by hand.
    void helper.archive().catch(() => {});
    throw error;
  }
}
