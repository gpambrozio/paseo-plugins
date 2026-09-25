/**
 * Moves a finished crewmate out of Paseo's "Ready to review" once the first
 * mate has read that it finished.
 *
 * Paseo's sidebar files a workspace under "Ready to review" while one of its
 * agents has `requiresAttention` set, which the daemon does when a turn goes
 * from running to idle (`attentionReason: "finished"`), and under "Done" once
 * nothing is left to see. The app clears the flag when you look at the agent.
 * A crewmate is looked at by the first mate, not the captain: Paseo sends the
 * first mate a `<paseo-system>` note when the crewmate finishes, so when a
 * first-mate turn that read such a note completes, the crewmate's flag is
 * cleared the way opening it in the app would.
 *
 * Only a crewmate (`firstmate.role=crew`) whose flag still says "finished" and
 * that has no pending permission is cleared. A permission or an error is the
 * captain's to see: those still show as "Needs input" and "Failed", which
 * Paseo ranks above the flag anyway.
 *
 * The SDK has no call for clearing attention, so it goes over the plugin's own
 * channel (`daemon-session.ts`), as `markMateSeen` does — Paseo's internal
 * message format, not an interface. A failure is logged and changes nothing
 * but the sidebar.
 */
import type { PluginLifecycleRegistration } from "@getpaseo/plugin/server";

import { CREW_LABELS, type FirstmateConfig } from "../shared/fleet";
import { sendSessionRequest } from "./daemon-session";
import { fetchLiveAgent } from "./fleet";
import type { PaseoAgent, PaseoApi, TimelineItem } from "./host-types";

/** The first line of Paseo's finish note: `Agent <id> (<title>) finished.` */
const FINISHED_LINE = /^Agent (\S+) \(.*\) finished\.$/;
const SYSTEM_NOTE = /<paseo-system>\n([^\n]*)/g;

/** The agents the timeline's `<paseo-system>` notes say finished, in order, without repeats. */
export function finishedAgentIds(items: readonly TimelineItem[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.type !== "user_message") continue;
    for (const note of item.text.matchAll(SYSTEM_NOTE)) {
      const finished = FINISHED_LINE.exec(note[1] ?? "");
      if (finished?.[1] !== undefined) ids.add(finished[1]);
    }
  }
  return [...ids];
}

/** Whether clearing this agent's flag hides nothing but a finish the first mate has read. */
export function isClearableCrew(agent: PaseoAgent): boolean {
  return (
    agent.labels[CREW_LABELS.role] === CREW_LABELS.crewRole &&
    agent.requiresAttention === true &&
    agent.attentionReason === "finished" &&
    agent.pendingPermissions.length === 0 &&
    agent.status !== "error" &&
    agent.status !== "running"
  );
}

/**
 * How much of each first mate's timeline has been read, so a note is acted on
 * by the turn that read it and not again by every later one. In memory: after
 * a reload, or when the daemon hands over a shorter timeline than last time,
 * the whole timeline is read once more, which at worst clears a flag the
 * first mate has already been told about.
 */
export class MateTimelineCursor {
  private readonly read = new Map<string, number>();

  /** The items since the last call for this agent, and the cursor moved past them. */
  take(agentId: string, items: readonly TimelineItem[]): readonly TimelineItem[] {
    const from = this.read.get(agentId) ?? 0;
    this.read.set(agentId, items.length);
    return from <= items.length ? items.slice(from) : items;
  }
}

export type ClearAttention = (agentId: string) => Promise<void>;

async function clearOverChannel(agentId: string): Promise<void> {
  await sendSessionRequest({ type: "clear_agent_attention", agentId }, "clear_agent_attention_response");
}

/** Clears each of `agentIds` that is a crewmate with only a read finish on it. Never throws. */
export async function markCrewSeen(
  paseo: PaseoApi,
  agentIds: readonly string[],
  clear: ClearAttention = clearOverChannel,
): Promise<string[]> {
  const results = await Promise.all(
    agentIds.map(async function markOne(agentId): Promise<string | null> {
      try {
        const agent = await fetchLiveAgent(paseo, agentId);
        if (agent === null || !isClearableCrew(agent)) return null;
        await clear(agentId);
        return agentId;
      } catch (error) {
        console.error(`[firstmate] could not mark crewmate ${agentId} as seen:`, error);
        return null;
      }
    }),
  );
  return results.filter((id): id is string => id !== null);
}

/**
 * On each completed first-mate turn, clears the crewmates whose finish notes
 * that turn read. A cancelled or failed turn does not move the cursor, so the
 * next completed one reads its notes.
 */
export function registerCrewSeen(
  server: PluginLifecycleRegistration,
  readConfig: () => Promise<FirstmateConfig>,
  clear: ClearAttention = clearOverChannel,
): () => void {
  const cursor = new MateTimelineCursor();
  return server.on("agent.turn_ended", async (event, { paseo }) => {
    if (event.outcome.kind !== "completed") return;
    try {
      const config = await readConfig();
      if (config.mateAgentId.trim() !== event.agent.id) return;
      const ids = finishedAgentIds(cursor.take(event.agent.id, event.timeline));
      if (ids.length > 0) await markCrewSeen(paseo, ids, clear);
    } catch (error) {
      console.error("[firstmate] could not mark the crew the first mate read about as seen:", error);
    }
  });
}
