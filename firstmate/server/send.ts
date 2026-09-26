/**
 * Talking to an agent without cutting it off, as far as its provider allows.
 *
 * `PaseoAgentHandle.send` interrupts a running turn by default. For the first
 * mate that is the wrong thing: it may be halfway through dispatching three
 * crewmates when the captain adds a fourth request. The daemon also accepts
 * `activeTurnBehavior: "steer"`: where the provider can take a message in the
 * middle of a turn, the message joins it; where it cannot, the daemon
 * replaces the running turn with one that starts from the message; and an
 * idle agent simply starts a turn. That is exactly how Paseo delivers its own
 * finish notifications to the agent that created a crewmate, so a first mate
 * is never worse off for a message from the board than for one from Paseo.
 *
 * The SDK's options type does not declare the field, but the handle passes its
 * options through to the daemon untouched (checked against 0.9.0 and 0.9.1),
 * so it is set here in one place. Should a later SDK drop it, the message is
 * still delivered — as an interruption, which is the default.
 */
import type { PaseoApi } from "./host-types";

type SendOptions = NonNullable<Parameters<ReturnType<PaseoApi["agents"]["ref"]>["send"]>[1]>;

/**
 * What can go with the words: the send's own `images` and `attachments`, as Paseo's composer fills them,
 * and a `messageId`, which the timeline keeps as the message's `clientMessageId`.
 */
export type SendExtras = Pick<SendOptions, "images" | "attachments" | "messageId">;

export async function sendWithoutInterrupting(
  paseo: PaseoApi,
  agentId: string,
  text: string,
  extras: SendExtras = {},
): Promise<void> {
  const options: SendOptions & { activeTurnBehavior: "steer" } = { ...extras, activeTurnBehavior: "steer" };
  await paseo.agents.ref(agentId).send(text, options);
}
