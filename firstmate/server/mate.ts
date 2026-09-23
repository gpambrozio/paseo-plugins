/**
 * The first mate: launching one, adopting one, and carrying the captain's
 * words to it.
 *
 * The plugin never dispatches a crewmate. It gives the first mate a home and a
 * charter and starts it there; from then on the first mate owns intake,
 * dispatch and supervision, with Paseo's own tools.
 */
import { CREW_LABELS, type AgentSummary, type FirstmateConfig } from "../shared/fleet";
import { readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./config";
import { fetchLiveAgent, listAgents, resolveMate, summarizeAgent } from "./fleet";
import { prepareHome } from "./home";
import type { PaseoApi } from "./host-types";
import { sendWithoutInterrupting } from "./send";

export const MATE_TITLE = "First mate";

/**
 * The first turn. Claude and Codex both read `AGENTS.md` from the working
 * directory on their own; the sentence asking it to read the file is for a
 * harness that does not, and costs nothing when the charter is already loaded.
 */
export const LAUNCH_PROMPT = [
  "ahoy! You are the first mate, and I am your captain.",
  "Your charter is AGENTS.md in this directory; if it is not already part of your instructions, read it in full now.",
  "Then take the helm as its section 3 says, and report to me in one short message.",
].join(" ");

const NO_MATE = "There is no first mate yet. Open the FirstMate board and launch one.";

/** Refused when a first mate is already aboard, so a second click cannot start a second one. */
export async function launchMate(
  paseo: PaseoApi,
  input: { provider: string; modeId: string },
): Promise<{ agentId: string; workspaceId: string | null }> {
  const config = await readFirstmateConfig();
  const current = await resolveMate(paseo, config);
  if (current.agent !== null) {
    throw new Error(
      `A first mate is already aboard (${current.agent.title ?? current.agent.id}). Open it, or release it in the FirstMate settings first.`,
    );
  }
  const home = resolveHome(config);
  await prepareHome(home, config);

  const workspace = await paseo.workspaces.open(home);
  const modeId = input.modeId.trim();
  const agent = await workspace.agents.create({
    config: modeId === "" ? { provider: input.provider } : { provider: input.provider, modeId },
    title: MATE_TITLE,
    labels: { [CREW_LABELS.role]: CREW_LABELS.mateRole },
    prompt: LAUNCH_PROMPT,
  });
  await updateFirstmateConfig({ mateAgentId: agent.id, mateProvider: input.provider, mateModeId: modeId });
  return { agentId: agent.id, workspaceId: workspace.id };
}

/**
 * Makes an existing agent the first mate. The charter is written into the
 * home either way, so an agent already working there picks it up on its next
 * session; one working elsewhere never sees it, which the board points out.
 */
export async function adoptMate(paseo: PaseoApi, agentId: string): Promise<FirstmateConfig> {
  if ((await fetchLiveAgent(paseo, agentId)) === null) throw new Error(`Paseo has no live agent ${agentId}.`);
  const config = await readFirstmateConfig();
  await prepareHome(resolveHome(config), config);
  return updateFirstmateConfig({ mateAgentId: agentId });
}

export async function releaseMate(): Promise<FirstmateConfig> {
  return updateFirstmateConfig({ mateAgentId: "" });
}

/** Every live agent that could be adopted, those already working in the home first. */
export async function listCandidates(paseo: PaseoApi): Promise<{ home: string; agents: AgentSummary[] }> {
  const home = resolveHome(await readFirstmateConfig());
  const agents = (await listAgents(paseo))
    .filter((agent) => agent.labels[CREW_LABELS.role] !== CREW_LABELS.crewRole)
    .map(summarizeAgent)
    .sort((a, b) => {
      const inHome = Number(b.cwd === home) - Number(a.cwd === home);
      return inHome !== 0 ? inHome : b.updatedAt.localeCompare(a.updatedAt);
    });
  return { home, agents };
}

/** The first mate's id, or a sentence saying there is none. */
export async function requireMate(paseo: PaseoApi): Promise<string> {
  const mate = await resolveMate(paseo, await readFirstmateConfig());
  if (mate.agent === null) throw new Error(NO_MATE);
  return mate.agent.id;
}

/** Delivers the captain's words, joining the first mate's turn if it is mid-way through one. */
export async function askMate(paseo: PaseoApi, text: string): Promise<string> {
  const agentId = await requireMate(paseo);
  await sendWithoutInterrupting(paseo, agentId, text);
  return agentId;
}
