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
import { TEMPLATES, message } from "./templates";

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

/** A steer nobody answered in this long is forgotten, so the map cannot grow for the life of the daemon. */
const STEER_TTL_MS = 60 * 60 * 1000;

/**
 * What the captain has said to each crewmate that the first mate has not yet
 * been told about. In memory: a plugin reload forgets it, and the first mate
 * learns of the exchange the next time it looks at that crewmate.
 *
 * A steer is handed over only by a turn that *contains* it — its text is one
 * of the ended turn's user messages. The first `turn_ended` after a steer is
 * not always the answer: the turn that was running when it was sent may end
 * first, and a provider that cannot join a running turn cancels it and starts
 * a new one, so the ended turn has to show it read the words.
 */
export class CaptainSteers {
  private readonly pending = new Map<string, Array<{ text: string; at: number }>>();

  constructor(private readonly now: () => number = Date.now) {}

  record(agentId: string, text: string): void {
    this.pending.set(agentId, [...this.fresh(agentId), { text, at: this.now() }]);
  }

  /** Takes back a steer whose send failed, so it is never relayed as said. */
  forget(agentId: string, text: string): void {
    const kept = this.fresh(agentId).filter((entry) => entry.text !== text);
    if (kept.length === 0) this.pending.delete(agentId);
    else this.pending.set(agentId, kept);
  }

  /** The steers `userMessages` shows were read, removed; null when it shows none of them. */
  take(agentId: string, userMessages: readonly string[]): string[] | null {
    const entries = this.fresh(agentId);
    const read = entries.filter((entry) => userMessages.some((message) => message.includes(entry.text.trim())));
    const left = entries.filter((entry) => !read.includes(entry));
    if (left.length === 0) this.pending.delete(agentId);
    else this.pending.set(agentId, left);
    return read.length === 0 ? null : read.map((entry) => entry.text);
  }

  private fresh(agentId: string): Array<{ text: string; at: number }> {
    const cutoff = this.now() - STEER_TTL_MS;
    return (this.pending.get(agentId) ?? []).filter((entry) => entry.at >= cutoff);
  }
}

/**
 * Recorded before the send, so a turn that ends the instant the message lands
 * still finds it; taken back if the send fails.
 */
export async function steerCrew(paseo: PaseoApi, steers: CaptainSteers, agentId: string, text: string): Promise<void> {
  await requireCrew(paseo, agentId);
  steers.record(agentId, text);
  try {
    await sendWithoutInterrupting(paseo, agentId, text);
  } catch (error) {
    steers.forget(agentId, text);
    throw error;
  }
}

export async function interruptCrew(paseo: PaseoApi, agentId: string): Promise<void> {
  await requireCrew(paseo, agentId);
  await stopAgent(agentId);
}

export async function exitCrew(paseo: PaseoApi, agentId: string): Promise<void> {
  await requireCrew(paseo, agentId);
  await paseo.agents.ref(agentId).archive();
}

/** What the first mate is asked when the captain presses Relaunch (`templates/messages/relaunch.md`). */
export function relaunchText(agent: Pick<PaseoAgent, "id" | "title" | "labels">, note: string): Promise<string> {
  const task = agent.labels[CREW_LABELS.task];
  return message(TEMPLATES.relaunch, {
    worker: task ?? `"${agent.title ?? agent.id}"`,
    agentId: agent.id,
    note: note.trim(),
  });
}

export async function relaunchCrew(paseo: PaseoApi, agentId: string, note: string): Promise<string> {
  const agent = await requireCrew(paseo, agentId);
  return askMate(paseo, await relaunchText(agent, note));
}

/** What the first mate is told when a turn the captain started from the board ends (`templates/messages/steer-relay.md`). */
export async function relayText(
  agent: { id: string; title: string | null },
  captain: readonly string[],
  answer: string | null,
): Promise<string> {
  const response =
    answer === null
      ? await message(TEMPLATES.steerRelayNoAnswer)
      : answer.length <= MAX_RELAYED_CHARS
        ? answer
        : await message(TEMPLATES.steerRelayClipped, { answer: answer.slice(0, MAX_RELAYED_CHARS) });
  return message(TEMPLATES.steerRelay, {
    agentId: agent.id,
    title: agent.title ?? agent.id,
    captain: captain.join("\n\n"),
    response,
  });
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
    // A cancelled turn is the one a steer replaced, not the one that answers it.
    if (event.outcome.kind === "canceled") return;
    const userMessages = event.timeline.flatMap((item) => (item.type === "user_message" ? [item.text] : []));
    const captain = steers.take(event.agent.id, userMessages);
    if (captain === null) return;
    try {
      const mate = await resolveMate(paseo, await readConfig());
      if (mate.agent === null) return;
      await sendWithoutInterrupting(
        paseo,
        mate.agent.id,
        await relayText(event.agent, captain, closingText(event.timeline)),
      );
    } catch (error) {
      console.error(`[firstmate] could not tell the first mate about the captain's words to ${event.agent.id}:`, error);
    }
  });
}
