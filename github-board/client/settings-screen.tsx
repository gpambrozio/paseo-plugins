/**
 * The same prompt-and-login editor the board's gear button opens, reachable
 * from **Settings → Plugins → GitHub board** as well.
 *
 * Two entry points, one editor: both frames render `PromptSettingsView` and
 * both bind to the `promptSettings` document, so they cannot show different
 * values or overwrite each other with a stale draft — a save against a revision
 * the other frame has already moved past fails and reports, rather than
 * winning. That is the reason this is a second door rather than a replacement:
 * `PluginSurfaceProps` carries no `openSettings`, so a surface cannot route to
 * its own settings screen, and moving the editor out would leave the board's
 * gear button with nowhere to go.
 */
import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import type { PromptSettings } from "../shared/board";
import { saveLogin } from "../shared/board";
import { normalizePrompts, promptSettings } from "../shared/settings";
import { EMPTY_PROMPTS, PromptSettingsView, useStyles } from "./board";

export function BoardSettingsScreen(props: PluginSurfaceProps) {
  const styles = useStyles(props);
  const prompts = useSettings(promptSettings);
  const persistLogin = useRpc(saveLogin);
  const toast = useToast();

  /**
   * The login is the daemon's, not the app's — it is what `gh` runs as — so it
   * still goes through its RPC rather than a settings document. This screen
   * only pins it; the board picks the new one up on its next load.
   */
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);

  const applyLogin = useCallback(
    // Async function expression, not an async arrow — Hermes evaluates an async
    // arrow in an eval'd bundle to `undefined`.
    async function applyLogin(next: string) {
      const trimmed = next.trim();
      if (trimmed === "") return;
      setBusy(true);
      try {
        const saved = await persistLogin({ login: trimmed });
        setLogin(saved.login);
        toast.show(`Board login set to ${saved.login}`, { variant: "success" });
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [persistLogin, toast],
  );

  const applyPrompts = useCallback(
    async function applyPrompts(next: PromptSettings) {
      if (prompts.status !== "ready") return;
      const saved = await prompts.save(normalizePrompts(next), prompts.revision);
      if (saved) toast.show("Prompts saved", { variant: "success" });
      else toast.error(prompts.saveError ?? "The templates were not saved.");
    },
    [prompts, toast],
  );

  const screenStyle = useMemo(() => ({ flex: 1 }), []);

  return (
    <View style={screenStyle}>
      <PromptSettingsView
        styles={styles}
        prompts={prompts.status === "ready" ? prompts.values : EMPTY_PROMPTS}
        login={login}
        busy={busy}
        mutedColor={props.theme.colors.foregroundMuted}
        onSave={applyPrompts}
        onApplyLogin={applyLogin}
      />
    </View>
  );
}
