/**
 * What the captain can do to one crewmate from the board: steer it, interrupt
 * its turn, end it, or have the first mate relaunch it.
 *
 * None of these tears anything down. Ending a crewmate archives the agent and
 * leaves its workspace and worktree exactly as they are; relaunching is the
 * first mate's job, because it owns the brief and the backlog.
 *
 * Steering goes straight to the crewmate — the captain's words are
 * authoritative, as if typed into its tab — and the first mate hears about it
 * when that turn ends, through `CaptainSteers` and the `turn_ended` hook.
 */
import type { PluginLifecycleRegistration } from "@getpaseo/plugin/server";

import { CREW_LABELS, type FirstmateConfig } from "../shared/fleet";
import { stopAgent } from "./cli";
import { closingText, fetchLiveAgent, resolveMate } from "./fleet";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { askMate } from "./mate";
import { sendWithoutInterrupting } from "./send";

/** The most of a crewmate's answer relayed to the first mate; the same cap Paseo's own notification uses. */
const MAX_RELAYED_CHARS = 4000;

/** Refuses anything that is not a live crewmate, so the board cannot be pointed at an arbitrary agent. */
async function requireCrew(paseo: PaseoApi, agentId: string): Promise<PaseoAgent> {
  const agent = await fetchLiveAgent(paseo, agentId);
  if (agent === null) throw new Error(`Paseo has no live agent ${agentId}.`);
  if (agent.labels[CREW_LABELS.role] !== CREW_LABELS.crewRole) {
    throw new Error(`${agent.title ?? agentId} is not one of the crew.`);
  }
  return agent;
}

/**
 * Crewmates the captain has spoken to since their last turn ended, and what
 * was said. In memory: a plugin reload forgets them, and the first mate then
 * learns of the exchange the next time it looks at that crewmate.
 */
export class CaptainSteers {
  private readonly pending = new Map<string, string[]>();

  record(agentId: string, text: string): void {
    this.pending.set(agentId, [...(this.pending.get(agentId) ?? []), text]);
  }

  take(agentId: string): string[] | null {
    const texts = this.pending.get(agentId) ?? null;
    this.pending.delete(agentId);
    return texts;
  }
}

export async function steerCrew(paseo: PaseoApi, steers: CaptainSteers, agentId: string, text: string): Promise<void> {
  await requireCrew(paseo, agentId);
  steers.record(agentId, text);
  await sendWithoutInterrupting(paseo, agentId, text);
}

export async function interruptCrew(paseo: PaseoApi, agentId: string): Promise<void> {
  await requireCrew(paseo, agentId);
  await stopAgent(agentId);
}

export async function exitCrew(paseo: PaseoApi, agentId: string): Promise<void> {
  await requireCrew(paseo, agentId);
  await paseo.agents.ref(agentId).archive();
}

export function relaunchText(agent: Pick<PaseoAgent, "id" | "title" | "labels">, note: string): string {
  const task = agent.labels[CREW_LABELS.task];
  const subject = task === undefined ? `the worker "${agent.title ?? agent.id}"` : `the worker on ${task}`;
  return [
    `ahoy! Relaunch ${subject} (crewmate ${agent.id}) in the same local copy, as step 4 of your stuck-crewmate ladder says.`,
    `The captain's note for the new worker: ${note.trim()}`,
  ].join("\n");
}

export async function relaunchCrew(paseo: PaseoApi, agentId: string, note: string): Promise<string> {
  const agent = await requireCrew(paseo, agentId);
  return askMate(paseo, relaunchText(agent, note));
}

/** What the first mate is told when a turn the captain started from the board ends. */
export function relayText(
  agent: { id: string; title: string | null },
  captain: readonly string[],
  answer: string | null,
): string {
  const clipped =
    answer === null
      ? "(it ended the turn without a message)"
      : answer.length <= MAX_RELAYED_CHARS
        ? answer
        : `${answer.slice(0, MAX_RELAYED_CHARS)}\n[truncated; use get_agent_activity for the rest]`;
  return [
    "<firstmate-board>",
    `The captain spoke to crewmate ${agent.id} (${agent.title ?? "untitled"}) directly from the FirstMate board. Their words are authoritative: reconcile the brief and the backlog with them.`,
    "<captain-message>",
    captain.join("\n\n"),
    "</captain-message>",
    "<agent-response>",
    clipped,
    "</agent-response>",
    "</firstmate-board>",
  ].join("\n");
}

/**
 * Paseo tells the first mate when a crewmate *it* prompted finishes. A turn
 * the captain started from the board was prompted by nobody Paseo knows to
 * notify, so this hook does it: when that turn ends, the first mate gets what
 * the captain said and what the crewmate answered.
 */
export function registerSteerRelay(
  server: PluginLifecycleRegistration,
  steers: CaptainSteers,
  readConfig: () => Promise<FirstmateConfig>,
): () => void {
  return server.on("agent.turn_ended", async (event, { paseo }) => {
    const captain = steers.take(event.agent.id);
    if (captain === null) return;
    try {
      const mate = await resolveMate(paseo, await readConfig());
      if (mate.agent === null) return;
      await sendWithoutInterrupting(
        paseo,
        mate.agent.id,
        relayText(event.agent, captain, closingText(event.timeline)),
      );
    } catch (error) {
      console.error(`[firstmate] could not tell the first mate about the captain's words to ${event.agent.id}:`, error);
    }
  });
}
