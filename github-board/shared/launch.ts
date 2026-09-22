/**
 * What both ways of sending a card need at runtime: `sendToChatHandler`, which
 * launches on the board's own host, and the dialog's own launch onto another
 * host through `getPaseoClient`. Kept in one place so the two cannot disagree
 * about which project a card belongs to or what its workspace is called.
 *
 * Like `shared/image-host.ts`, this file imports nothing at all, so it lands in
 * both bundles and stays loadable from the standalone server transpile.
 */

/**
 * A repository's identity as both a project key and a git remote spell it:
 * `<host>/<owner>/<name>`, lowercased. The host comes from the item's own URL
 * rather than a hardcoded `github.com`, so a GitHub Enterprise card matches the
 * enterprise project and not a same-named repository on github.com.
 */
export function repositoryIdFor(repository: string, url: string): string | null {
  if (!repository.includes("/")) return null;
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  if (host === "") return null;
  return `${host}/${repository}`.toLowerCase();
}

/** Workspace titles are capped at the same length the daemon caps agent titles. */
const MAX_TITLE_CHARS = 200;

/** The new workspace's title: the card's own, or its number when it has none. */
export function workspaceTitle(repository: string, number: number, title: string): string {
  const trimmed = title.trim();
  return (trimmed === "" ? `${repository} #${number}` : trimmed).slice(0, MAX_TITLE_CHARS);
}
