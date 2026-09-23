/**
 * The words behind `/bearings` and `/ahoy`, shared by the slash commands and
 * the chat pane's buttons. They are plain requests, not slash commands, on
 * purpose: a leading `/` would be read by the first mate's own harness as one
 * of *its* commands. The charter (§10) says what each request means.
 */

/** `/bearings [file] [include PRs]` — the options are passed through in the captain's words. */
export function bearingsPrompt(args: string): string {
  const options = args.trim();
  return options === "" ? "Bearings, please." : `Bearings, please — ${options}.`;
}

export function ahoyPrompt(args: string): string {
  const extra = args.trim();
  return extra === "" ? "Ahoy!" : `Ahoy! ${extra}`;
}
