/**
 * Moves a finished crewmate out of Paseo's "Ready to review" once the first
 * mate has been told it finished.
 *
 * Paseo's sidebar files a workspace under "Ready to review" while one of its
 * agents has `requiresAttention` set, which the daemon does when a turn goes
 * from running to idle (`attentionReason: "finished"`), and under "Done" once
 * nothing is left to see. The app clears the flag when you look at the agent.
 * A crewmate is looked at by the first mate, not the captain: Paseo sends the
 * first mate a `<paseo-system>` note when the crewmate finishes, so a crewmate
 * whose finish is older than the start of a first-mate turn that completed has
 * been read, and its flag is cleared the way opening it in the app would.
 *
 * The note itself cannot be the signal: the daemon keeps every
 * `<paseo-system>` message out of the timeline (`isSystemInjectedEnvelope` in
 * Paseo's agent manager), so no hook or timeline read ever sees one. The time
 * the crewmate finished (`attentionTimestamp`) is the one trace the note leaves.
 *
 * Only a crewmate (`firstmate.role=crew`) the first mate created — so the note
 * went to it — whose flag still says "finished" and that has no pending
 * permission is cleared. A permission or an error is the captain's to see:
 * those still show as "Needs input" and "Failed", which Paseo ranks above the
 * flag anyway.
 *
 * The SDK has no call for clearing attention, so it goes over the plugin's own
 * channel (`daemon-session.ts`), as `markMateSeen` does — Paseo's internal
 * message format, not an interface. A failure is logged and changes nothing
 * but the sidebar.
 */
import type { PluginLifecycleRegistration } from "@getpaseo/plugin/server";

import { CREW_LABELS, type FirstmateConfig } from "../shared/fleet";
import { sendSessionRequest } from "./daemon-session";
import { listAgents } from "./fleet";
import type { PaseoAgent, PaseoApi } from "./host-types";

/** The label Paseo puts on an agent created through its MCP tools, naming the agent that created it. */
const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";

/**
 * Whether clearing this agent's flag hides nothing but a finish that `mateId`
 * was told about before `readSince`.
 */
export function isClearableCrew(agent: PaseoAgent, mateId: string, readSince: Date): boolean {
  const finishedAt = Date.parse(agent.attentionTimestamp ?? "");
  return (
    agent.labels[CREW_LABELS.role] === CREW_LABELS.crewRole &&
    agent.labels[PARENT_AGENT_ID_LABEL] === mateId &&
    agent.requiresAttention === true &&
    agent.attentionReason === "finished" &&
    finishedAt <= readSince.getTime() &&
    agent.pendingPermissions.length === 0 &&
    agent.status !== "error" &&
    agent.status !== "running"
  );
}

export type ClearAttention = (agentId: string) => Promise<void>;

async function clearOverChannel(agentId: string): Promise<void> {
  await sendSessionRequest({ type: "clear_agent_attention", agentId }, "clear_agent_attention_response");
}

/**
 * Clears each crewmate of `mateId` with only a finish from before `readSince`
 * on it, and returns the ones cleared. Never throws.
 */
export async function markCrewSeen(
  paseo: PaseoApi,
  mateId: string,
  readSince: Date,
  clear: ClearAttention = clearOverChannel,
): Promise<string[]> {
  let crew: PaseoAgent[];
  try {
    crew = await listAgents(paseo, {
      labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole, [PARENT_AGENT_ID_LABEL]: mateId },
    });
  } catch (error) {
    console.error("[firstmate] could not list the crew to mark as seen:", error);
    return [];
  }
  const results = await Promise.all(
    crew
      .filter((agent) => isClearableCrew(agent, mateId, readSince))
      .map(async function markOne(agent): Promise<string | null> {
        try {
          await clear(agent.id);
          return agent.id;
        } catch (error) {
          console.error(`[firstmate] could not mark crewmate ${agent.id} as seen:`, error);
          return null;
        }
      }),
  );
  return results.filter((id): id is string => id !== null);
}

/**
 * On each completed first-mate turn, clears the crewmates that finished before
 * it started. A turn that started before the plugin loaded is skipped; the next
 * one catches up, as does the next completed turn after a cancelled or failed one.
 */
export function registerCrewSeen(
  server: PluginLifecycleRegistration,
  readConfig: () => Promise<FirstmateConfig>,
  clear: ClearAttention = clearOverChannel,
  now: () => Date = () => new Date(),
): () => void {
  const startedAt = new Map<string, Date>();
  const unregisterStart = server.on("agent.turn_started", (event) => {
    startedAt.set(event.agent.id, now());
  });
  const unregisterEnd = server.on("agent.turn_ended", async (event, { paseo }) => {
    const readSince = startedAt.get(event.agent.id);
    startedAt.delete(event.agent.id);
    if (event.outcome.kind !== "completed" || readSince === undefined) return;
    try {
      const mateId = (await readConfig()).mateAgentId.trim();
      if (mateId !== event.agent.id) return;
      const cleared = await markCrewSeen(paseo, mateId, readSince, clear);
      if (cleared.length > 0) {
        console.log(`[firstmate] cleared ${cleared.length} crewmates the first mate has read about`);
      }
    } catch (error) {
      console.error("[firstmate] could not mark the crew the first mate read about as seen:", error);
    }
  });
  return () => {
    unregisterStart();
    unregisterEnd();
  };
}
