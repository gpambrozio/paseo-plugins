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
import { nameHomeOnce } from "./home-name";
import type { PaseoApi } from "./host-types";
import { sendSessionRequest } from "./daemon-session";
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

/**
 * The first turn after a restart. The new first mate has the records but not
 * the conversation, and Paseo notifies only the agent that prompted a
 * crewmate — so crewmates its predecessor started will finish without a word
 * to it, which is what the heartbeat is for.
 */
export const RESTART_PROMPT = [
  "ahoy! You are the first mate, and I am your captain.",
  "This is a fresh start: another first mate held the helm before you, and its conversation is gone; what it knew is in your records.",
  "Your charter is AGENTS.md in this directory; if it is not already part of your instructions, read it in full now.",
  "Then take the helm as its section 3 says.",
  "Crewmates your predecessor started will not wake you when they finish, so while any are in flight keep a heartbeat as section 7 says.",
  "Report to me in one short message.",
].join(" ");

/** What a first mate is started with. Empty strings leave the provider's default. */
interface MateSetup {
  provider: string;
  modeId: string;
  thinkingOptionId: string;
}

const NO_MATE = "There is no first mate yet. Open the FirstMate board and launch one.";

/**
 * The launch or restart in progress, if any. The "already aboard" check below
 * reads the config, which is only written once the agent exists, so two
 * launches that overlap — a double press, the desktop and a phone — would both
 * pass it. Every client of this daemon reaches the same plugin process, so
 * holding the change here is enough to make the second one wait for the first
 * — and then refuse, or restart the first mate the first one started.
 */
let changing: Promise<unknown> | null = null;

async function oneAtATime<T>(change: () => Promise<T>): Promise<T> {
  while (changing !== null) await changing.catch(() => {});
  const run = change();
  changing = run;
  try {
    return await run;
  } finally {
    if (changing === run) changing = null;
  }
}

/** Refused when a first mate is already aboard, so a second launch cannot start a second one. */
export async function launchMate(
  paseo: PaseoApi,
  input: { provider: string; modeId: string },
): Promise<{ agentId: string; workspaceId: string | null }> {
  return oneAtATime(async () => {
    const config = await readFirstmateConfig();
    const current = await resolveMate(paseo, config);
    if (current.agent !== null) {
      throw new Error(
        `A first mate is already aboard (${current.agent.title ?? current.agent.id}). Open it, or release it in the FirstMate settings first.`,
      );
    }
    return startMate(paseo, config, { ...input, thinkingOptionId: "" }, LAUNCH_PROMPT);
  });
}

const MID_TURN = "The first mate is in the middle of a turn.";

function isMidTurn(agent: { status: string }): boolean {
  return agent.status === "running" || agent.status === "initializing";
}

/**
 * Archives the first mate and launches a new one set up the same way, from
 * the live agent rather than the config: its model, mode or thinking may have
 * been changed in its own tab since launch, and an adopted one has nothing in
 * the config at all. Refused mid-turn, as Compact is: a turn cut off halfway
 * through a dispatch can leave a crewmate the records never heard of.
 *
 * The old one is archived before the new one starts, so two first mates never
 * hold the helm at once. Archiving stops its turn and ends its heartbeat —
 * Paseo retires a schedule whose agent is archived — and leaves its
 * conversation readable in Paseo's history. A launch that fails after that
 * leaves no first mate, which the board shows with its launch panel.
 */
export async function restartMate(paseo: PaseoApi): Promise<{ agentId: string; workspaceId: string | null }> {
  return oneAtATime(async () => {
    const config = await readFirstmateConfig();
    const { agent } = await resolveMate(paseo, config);
    if (agent === null) throw new Error(NO_MATE);
    if (isMidTurn(agent)) throw new Error(`${MID_TURN} Restart it once it is idle.`);
    const setup: MateSetup = {
      provider: agent.model === null ? agent.provider : `${agent.provider}/${agent.model}`,
      modeId: agent.currentModeId ?? "",
      thinkingOptionId: agent.thinkingOptionId ?? "",
    };
    await paseo.agents.ref(agent.id).archive();
    try {
      return await startMate(paseo, config, setup, RESTART_PROMPT);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`The old first mate was archived, but the new one did not start: ${reason}`);
    }
  });
}

/** Writes the home and starts a first mate in it. Callers hold `oneAtATime` and have checked the helm. */
async function startMate(
  paseo: PaseoApi,
  config: FirstmateConfig,
  setup: MateSetup,
  prompt: string,
): Promise<{ agentId: string; workspaceId: string | null }> {
  const home = resolveHome(config);
  await prepareHome(home, config);

  const workspace = await paseo.workspaces.open(home);
  nameHomeOnce(paseo, workspace.id, home);
  const modeId = setup.modeId.trim();
  const thinkingOptionId = setup.thinkingOptionId.trim();
  const agent = await workspace.agents.create({
    config: {
      provider: setup.provider,
      ...(modeId === "" ? {} : { modeId }),
      ...(thinkingOptionId === "" ? {} : { thinkingOptionId }),
    },
    title: MATE_TITLE,
    labels: { [CREW_LABELS.role]: CREW_LABELS.mateRole },
    prompt,
  });
  await updateFirstmateConfig({ mateAgentId: agent.id, mateProvider: setup.provider, mateModeId: modeId });
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

/**
 * Sends `/compact`, the command Paseo's own composer sends: Claude Code,
 * Codex and OpenCode each compact on it. A plain send, since a slash command
 * must be a turn of its own — so it is refused while a turn is running, where
 * a send would interrupt it, and a steer would bury the command in a message.
 */
export async function compactMate(paseo: PaseoApi): Promise<string> {
  const { agent } = await resolveMate(paseo, await readFirstmateConfig());
  if (agent === null) throw new Error(NO_MATE);
  if (isMidTurn(agent)) throw new Error(`${MID_TURN} Compact it once it is idle.`);
  await paseo.agents.ref(agent.id).send("/compact");
  return agent.id;
}

/** Delivers the captain's words, joining the first mate's turn if it is mid-way through one. */
export async function askMate(paseo: PaseoApi, text: string): Promise<string> {
  const agentId = await requireMate(paseo);
  await sendWithoutInterrupting(paseo, agentId, text);
  return agentId;
}

/**
 * Clears the first mate's attention flag while the captain has the FirstMate
 * panel open, as looking at the agent in Paseo would. The SDK has no call for
 * it, so it goes over the plugin's own channel (`daemon-session.ts`). Skipped
 * for a first mate waiting on a permission, as Paseo's own "mark as read"
 * skips one: the flag is the only prompt to answer it.
 */
export async function markMateSeen(paseo: PaseoApi): Promise<{ cleared: boolean }> {
  const { agent } = await resolveMate(paseo, await readFirstmateConfig());
  if (agent === null || agent.requiresAttention !== true) return { cleared: false };
  if (agent.pendingPermissions.length > 0 || agent.attentionReason === "permission") return { cleared: false };
  await sendSessionRequest({ type: "clear_agent_attention", agentId: agent.id }, "clear_agent_attention_response");
  return { cleared: true };
}
