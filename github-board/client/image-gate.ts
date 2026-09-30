import { isGitHubImageHost } from "../shared/image-host";

/**
 * Where an image in a body or a comment would be requested from, which decides
 * whether the panel may request it at all.
 *
 * - `github`: fetched through the daemon as soon as it renders, as always.
 * - `external`: any other host. Loading it tells that host the viewer's
 *   address and when they opened the item — a comment can be a tracking pixel
 *   — so nothing is requested until the user asks, and `host` is what the
 *   placeholder names.
 * - `unknown`: a URL whose host cannot be read with confidence. It is never
 *   requested, because there is no host to show the user before they agree.
 */
export type ImageOrigin =
  | { kind: "github" }
  | { kind: "external"; host: string }
  | { kind: "unknown" };

export function imageOrigin(url: string): ImageOrigin {
  if (isGitHubImageHost(url)) return { kind: "github" };
  // The parser drops or rewrites a backslash, whitespace and control characters,
  // so the host it names and the one the image loader requests could disagree.
  if (/[\\\s\u0000-\u001f\u007f]/.test(url)) return { kind: "unknown" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "unknown" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { kind: "unknown" };
  const host = parsed.hostname.toLowerCase();
  return host === "" ? { kind: "unknown" } : { kind: "external", host };
}

export interface LoadedImage {
  uri: string;
  width: number;
  height: number;
}

/** The two requests an image can cost, injected so the gate is testable. */
export interface ImageLoaders {
  /** Asks the daemon for a GitHub-hosted image; answers a data URL. */
  viaDaemon: (url: string) => Promise<string>;
  /** Hands a URI to the platform's image loader, which requests it to size it. */
  measure: (uri: string) => Promise<LoadedImage>;
}

/**
 * Starts loading an image, or returns null when it must not be requested yet:
 * an external one the user has not asked for, or one whose host is unknown.
 * An external image, once asked for, is loaded directly — never through the
 * daemon, which would send it after an arbitrary URL.
 */
export function startImageLoad(
  url: string,
  origin: ImageOrigin,
  requested: boolean,
  loaders: ImageLoaders,
): Promise<LoadedImage> | null {
  if (origin.kind === "github") return loaders.viaDaemon(url).then(loaders.measure);
  if (origin.kind === "external" && requested) return loaders.measure(url);
  return null;
}
