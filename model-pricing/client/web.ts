/**
 * The one browser global this plugin touches, in the one module 0.8 allows it
 * in. No `tsconfig` here has `"DOM"` in `lib`, so `window` is a type error
 * everywhere else; this module declares the narrow shape of what it reads and
 * the rest of `client/` just calls `openExternalUrl`.
 */
import { Linking } from "react-native";

/**
 * `Linking.openURL` is `window.open` on the desktop renderer, and the main
 * Electron window installs no window-open handler, so a row press would land
 * in a bare child window instead of the browser. The desktop preload exposes
 * the same opener Paseo's own links go through, which hands the URL to the OS
 * browser as a normal tab. Mobile and plain web have no bridge and keep
 * `Linking`, which already opens a tab there.
 *
 * Copied deliberately rather than shared: there is no workspace root here, and
 * each plugin is an independent npm project — see `github-board/client/web.ts`,
 * which owns the same opener plus that plugin's pointer tracking.
 */
interface DesktopOpenerBridge {
  readonly opener?: { readonly openUrl?: (url: string) => Promise<void> };
}

export function openExternalUrl(url: string): void {
  const openUrl = (globalThis as { paseoDesktop?: DesktopOpenerBridge }).paseoDesktop?.opener?.openUrl;
  if (typeof openUrl !== "function") {
    void Linking.openURL(url);
    return;
  }
  void openUrl(url).catch((error: unknown) => {
    console.warn("[model-pricing] desktop opener refused the URL, falling back", error);
    void Linking.openURL(url);
  });
}
