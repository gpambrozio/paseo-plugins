/** What invoking a skill sends: `/name`, followed by the arguments when there are any. */
export function invocationText(name: string, args: string): string {
  const trimmed = args.trim();
  return trimmed ? `/${name} ${trimmed}` : `/${name}`;
}

/**
 * Sends one invocation and reports back only to the screen that started it, and
 * only while that screen is still showing.
 *
 * A send can outlast its screen: the user goes back to the list and picks
 * another skill, or dismisses the popover and opens it again, before the send
 * answers. Its success must not then clear the newer selection or close the
 * newer popover — Paseo's `close()` is not scoped to one opening — so `onSent`
 * runs only while `isShowing()` still holds. The send itself is never
 * abandoned, and a failure nobody is looking at goes to `onUnseenFailure`
 * rather than nowhere.
 */
export async function sendInvocation(options: {
  send: (text: string) => Promise<unknown>;
  text: string;
  isShowing: () => boolean;
  onSent: () => void;
  onFailure: (message: string) => void;
  onUnseenFailure: (message: string) => void;
}): Promise<void> {
  try {
    await options.send(options.text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.isShowing()) options.onFailure(message);
    else options.onUnseenFailure(message);
    return;
  }
  if (options.isShowing()) options.onSent();
}
