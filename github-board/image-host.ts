/**
 * No suffix, so it lands in both bundles: the client uses it to decide whether
 * an image needs the daemon, and the server to refuse anything else. It must
 * stay free of Node imports — and it is kept out of `board.shared.ts` so that
 * file remains type-only to the server, which is what lets the server half be
 * transpiled and run on its own (see CLAUDE.md).
 */
/**
 * Hosts whose images the server fetches on the client's behalf. An attachment
 * on a private repository answers 404 without the `gh` token, and the token
 * lives on the daemon — the app never sees it. Anything else the app loads
 * itself: sending the daemon after an arbitrary URL from a comment anyone
 * could have written is a fetch nobody asked for.
 */
export function isGitHubImageHost(url: string): boolean {
  const match = /^https:\/\/([^/?#]+)/i.exec(url);
  if (match === null) return false;
  const host = (match[1] ?? "").toLowerCase();
  return host === "github.com" || host.endsWith(".githubusercontent.com");
}

