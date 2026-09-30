import { gitHubImageUrl, isGitHubTokenHost, redirectHopUrl } from "../shared/image-host";

/** Checked while the body streams in, not after it has all arrived. */
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** The whole fetch: `gh auth token`, every hop and the body. */
const IMAGE_TIMEOUT_MS = 20_000;

/** GitHub's attachment redirect is one hop; five is room for a moved repository. */
const MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * An image out of a comment, fetched here because the app cannot: a
 * `github.com/user-attachments/assets/…` URL on a private repository answers
 * 404 to anyone without the token, and with it answers a 302 to a signed S3
 * URL good for five minutes.
 *
 * This is the daemon fetching a URL that a comment's author chose, holding the
 * `gh` token, so it trusts nothing the client decided. The URL is parsed and
 * checked here again, and what is fetched is the parsed URL rather than the
 * string. Redirects are followed by hand so every hop is checked the same way,
 * and the token goes only on a hop to `github.com` itself — not left to
 * `fetch`'s own redirect handling, whose rule is "same origin", not "GitHub".
 */
export async function fetchGitHubImage(
  url: string,
  token: (signal: AbortSignal) => Promise<string>,
): Promise<string> {
  const first = gitHubImageUrl(url);
  if (first === null) {
    throw new Error("Only images hosted on GitHub are fetched through the daemon.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await follow(first, token, controller.signal);
    return await readImage(response);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("GitHub took too long to answer for this image.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function follow(
  start: URL,
  token: (signal: AbortSignal) => Promise<string>,
  signal: AbortSignal,
): Promise<Response> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const headers: Record<string, string> = isGitHubTokenHost(url)
      ? { Authorization: `token ${await token(signal)}` }
      : {};
    const response = await fetch(url.href, { headers, redirect: "manual", signal });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    await response.body?.cancel();
    const location = response.headers.get("location");
    const next = location === null ? null : redirectHopUrl(location, url);
    if (next === null) {
      throw new Error("GitHub redirected this image somewhere the board does not follow.");
    }
    url = next;
  }
  throw new Error("GitHub redirected this image too many times.");
}

async function readImage(response: Response): Promise<string> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`GitHub answered ${response.status} for this image.`);
  }
  const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!type.startsWith("image/")) {
    await response.body?.cancel();
    throw new Error(`Not an image: GitHub answered with ${type || "no content type"}.`);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > IMAGE_MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("This image is too large to show here.");
  }
  // Read in chunks and stop at the cap, rather than buffering whatever the
  // host sends and measuring afterwards: content-length is only a claim.
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (response.body !== null) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > IMAGE_MAX_BYTES) {
        await reader.cancel();
        throw new Error("This image is too large to show here.");
      }
      chunks.push(value);
    }
  }
  return `data:${type};base64,${Buffer.concat(chunks).toString("base64")}`;
}
