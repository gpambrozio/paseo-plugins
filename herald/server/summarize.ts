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
import { DEFAULT_SUMMARY_PROMPT, type AttentionReason, type PromptPlaceholder } from "../shared/herald";
import { displayName, firstWords, plainText } from "./timeline";

export const HELPER_TITLE = "Herald summary";

/** Enough of a final message for a summary; the rest is never what the user needs to hear. */
const MAX_OUTPUT_CHARS = 6000;
const MAX_USER_CHARS = 600;

export interface SummaryRequest {
  agent: { id: string; workspaceId: string | null; workspaceTitle: string | null; cwd: string; title: string | null };
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
  /** The user's prompt template. Blank or absent means the default one. */
  prompt?: string;
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

/** Everything the helper wrote in code fences, with the fences and language tags removed. */
function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g, "$1").trim();
}

/**
 * The sentence inside the helper's JSON: the `speech` property the schema
 * asks for, or — because a model has been seen answering under `spoken` —
 * whatever the first non-empty string property is.
 */
function sentenceIn(json: unknown): string | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const record = json as Record<string, unknown>;
  const preferred = record.speech;
  if (typeof preferred === "string" && preferred.trim() !== "") return preferred;
  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

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

/** What each `{{placeholder}}` is worth for one event. Empty means "not there for this one". */
export function promptValues(request: SummaryRequest): Record<PromptPlaceholder, string> {
  const name = displayName({ workspaceTitle: request.agent.workspaceTitle, agentTitle: request.agent.title }) ?? "an agent";
  const folder = basename(request.agent.cwd);
  return {
    agent: name,
    workspace: request.agent.workspaceTitle?.trim() || folder,
    folder,
    event: describeReason(request.reason),
    headline: request.headline.trim(),
    detail: request.detail?.trim() ?? "",
    request: request.lastUser === null ? "" : clip(request.lastUser.trim(), MAX_USER_CHARS),
    output: request.output.trim() === "" ? "" : clip(request.output.trim(), MAX_OUTPUT_CHARS),
  };
}

/**
 * The user's template with this event's values in it.
 *
 * Two rules, both of them things the settings screen tells the user:
 *
 * - **A line whose placeholder is empty for this event is left out whole.**
 *   That is what keeps `Detail: {{detail}}` from reaching the model as a bare
 *   `Detail:` when the event carries none, without the template needing any
 *   notion of a conditional. Runs of blank lines left behind are collapsed.
 * - **A name we do not know is left exactly as typed**, so a prompt that talks
 *   about `{{ }}` for its own reasons is not quietly mangled.
 */
export function renderPrompt(template: string, values: Readonly<Record<string, string>>): string {
  const kept: string[] = [];
  for (const line of template.split("\n")) {
    let missing = false;
    const rendered = line.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (whole, name: string) => {
      const value = values[name];
      if (value === undefined) return whole;
      if (value === "") missing = true;
      return value;
    });
    if (missing) continue;
    if (rendered.trim() === "" && kept[kept.length - 1]?.trim() === "") continue;
    kept.push(rendered);
  }
  return kept.join("\n").trim();
}

export function buildPrompt(request: SummaryRequest, template?: string): string {
  const chosen = template?.trim() === "" || template === undefined ? DEFAULT_SUMMARY_PROMPT : template;
  return renderPrompt(chosen, promptValues(request));
}

/**
 * `outputSchema` is a request, not a guarantee: against a live daemon Claude
 * has returned the object inside a ```json fence, and once under a key of its
 * own choosing. So: fences off, then the JSON object anywhere in the text,
 * then any string in it; and a model that wrote plain prose instead is still
 * worth hearing, so that is the last resort rather than a failure.
 */
export function parseSummaryText(lastMessage: string | null): string {
  const raw = lastMessage?.trim() ?? "";
  if (raw === "") throw new Error("The summary agent returned nothing.");
  const unfenced = stripFences(raw);
  const candidates = [unfenced];
  const braces = unfenced.match(/\{[\s\S]*\}/);
  if (braces !== null && braces[0] !== unfenced) candidates.push(braces[0]);
  for (const candidate of candidates) {
    try {
      const sentence = sentenceIn(JSON.parse(candidate));
      if (sentence !== null) return plainText(sentence);
    } catch {
      // Not JSON; try the next candidate.
    }
  }
  return firstWords(unfenced, 45);
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
    prompt: buildPrompt(request, deps.prompt),
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
