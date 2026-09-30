/**
 * Shared, so it lands in both bundles: the client uses it to decide whether an
 * image needs the daemon, and the server to refuse anything else. Like every
 * `shared/` module it must stay free of Node and React imports.
 *
 * Every decision here is made on what `new URL` parses, never on the raw
 * string, because `new URL` is what `fetch` requests. A hand-rolled match on
 * the text reads `https://evil.example\.githubusercontent.com` as a GitHub
 * host; the URL parser treats that `\` as `/` and requests `evil.example`.
 */

/**
 * The URL a string really names, or null for anything that is not a plain
 * https URL on the default port. A backslash, whitespace or control character
 * anywhere is refused before parsing — the parser drops or rewrites them, so
 * the string a comment shows and the URL fetched would disagree — and so is
 * userinfo, which has no business in an image link.
 */
function strictHttpsUrl(raw: string): URL | null {
  if (/[\\\s\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.port !== "" || url.username !== "" || url.password !== "") return null;
  return url;
}

function isGitHubImageHostname(hostname: string): boolean {
  return hostname === "github.com" || hostname.endsWith(".githubusercontent.com");
}

/**
 * Hosts whose images the server fetches on the client's behalf. An attachment
 * on a private repository answers 404 without the `gh` token, and the token
 * lives on the daemon — the app never sees it. Anything else the app loads
 * itself: sending the daemon after an arbitrary URL from a comment anyone
 * could have written is a fetch nobody asked for.
 */
export function isGitHubImageHost(url: string): boolean {
  return gitHubImageUrl(url) !== null;
}

/** `url` parsed, when it is one `isGitHubImageHost` accepts; the server fetches this, not the string. */
export function gitHubImageUrl(url: string): URL | null {
  const parsed = strictHttpsUrl(url);
  return parsed !== null && isGitHubImageHostname(parsed.hostname) ? parsed : null;
}

/**
 * The one host the `gh` token is sent to. A private repository's attachment
 * lives at `github.com/user-attachments/assets/…` and needs it; everything on
 * `*.githubusercontent.com` is either public or carries its own signature in
 * the query, and any one of those hosts is a place the token has no reason to
 * go.
 */
export function isGitHubTokenHost(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === "github.com" &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  );
}

/**
 * A redirect hop the server follows: any https URL on the default port, with
 * nothing in it that parses differently from how it reads. GitHub sends an
 * attachment on to signed storage on another company's host, so the hop cannot
 * be held to GitHub; it is fetched without the token unless it is
 * `isGitHubTokenHost`.
 */
export function redirectHopUrl(location: string, base: URL): URL | null {
  if (/[\\\s\u0000-\u001f\u007f]/.test(location)) return null;
  let resolved: string;
  try {
    resolved = new URL(location, base).href;
  } catch {
    return null;
  }
  return strictHttpsUrl(resolved);
}
