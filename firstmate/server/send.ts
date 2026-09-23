/**
 * Talking to an agent without cutting it off.
 *
 * `PaseoAgentHandle.send` interrupts a running turn by default. For the first
 * mate that is the wrong thing: it may be halfway through dispatching three
 * crewmates when the captain adds a fourth request, and an interrupted
 * dispatch leaves a worktree with nobody in it. The daemon also accepts
 * `activeTurnBehavior: "steer"` — the message joins the running turn, or
 * starts a turn if there is none — which is exactly what Paseo itself uses to
 * deliver a crewmate's finish notification to the agent that created it.
 *
 * The SDK's options type does not declare the field, but the handle passes its
 * options through to the daemon untouched (checked against 0.9.0 and 0.9.1),
 * so it is set here in one place. Should a later SDK drop it, the message is
 * still delivered — as an interruption, which is the old behaviour.
 */
import type { PaseoApi } from "./host-types";

type SendOptions = NonNullable<Parameters<ReturnType<PaseoApi["agents"]["ref"]>["send"]>[1]>;

export async function sendWithoutInterrupting(paseo: PaseoApi, agentId: string, text: string): Promise<void> {
  const options: SendOptions & { activeTurnBehavior: "steer" } = { activeTurnBehavior: "steer" };
  await paseo.agents.ref(agentId).send(text, options);
}
