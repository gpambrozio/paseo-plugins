import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useCallback } from "react";

import { SkillBrowser } from "./browser";

export function SkillsPanel({ theme, layout, agentId, navigation }: PluginAgentPanelProps) {
  /**
   * Invoking sent a message to the user's live agent, so the agent's own tab is
   * where the result appears — leaving the user on the Skills tab hides the
   * thing they just asked for. `openAgent` runs the app's own `navigateToAgent`
   * against this host, which is the same call `github-board` makes after a send.
   *
   * `navigation` is typed optional because hosts before 0.7.0-beta.3 passed
   * nothing; this plugin requires Paseo >=0.9.0 and each app checks that against
   * its own version before evaluating this bundle, so every client that can run
   * this code passes it. The `undefined` branch is the old behaviour — back to
   * the list, still on this tab — rather than a broken one.
   */
  const handleInvoked = useCallback(
    function handleInvoked() {
      navigation?.openAgent({ agentId });
    },
    [agentId, navigation],
  );

  return (
    <SkillBrowser
      theme={theme}
      frame="screen"
      padding={layout.compact ? 12 : 20}
      agentId={agentId}
      onInvoked={handleInvoked}
    />
  );
}
