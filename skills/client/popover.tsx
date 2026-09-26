import type { PluginButtonContentProps, PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { SkillBrowser } from "./browser";

/** Which Skills tab the popover's open button leads to: the pill's own agent's. */
export type SkillsTabTarget = { workspaceId: string; agentId: string };

// The host pads the popover itself, so this is only the spacing between rows.
const PADDING = 12;

/**
 * The composer pill's popover: the Skills tab's own browser, drawn inside the
 * surface Paseo anchors to the pill, under a header whose button opens the tab.
 *
 * Content props carry no `openPanel` — only the client context has it — so the
 * pill hands in the one call the header needs. Built once per client entry, not
 * per pill: the target arrives in the props.
 */
export function createSkillsPopover(openTab: (target: SkillsTabTarget) => void) {
  return function SkillsPopover(props: PluginButtonContentProps) {
    // The union also covers header buttons; a composer pill is always an agent's.
    if (props.context !== "agent") return null;
    return (
      <SkillsPopoverBody
        theme={props.theme}
        compact={props.layout.compact}
        target={{ workspaceId: props.workspaceId, agentId: props.agentId }}
        close={props.close}
        openTab={openTab}
      />
    );
  };
}

function SkillsPopoverBody({
  theme,
  compact,
  target,
  close,
  openTab,
}: {
  theme: PluginHostProps["theme"];
  compact: boolean;
  target: SkillsTabTarget;
  close: () => void;
  openTab: (target: SkillsTabTarget) => void;
}) {
  const { workspaceId, agentId } = target;
  const styles = useMemo(
    () => ({
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        marginBottom: PADDING,
      },
      title: { color: theme.colors.foreground, fontSize: 15 },
      open: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        marginLeft: "auto" as const,
      },
      openLabel: { color: theme.colors.accent, fontSize: 13 },
    }),
    [theme],
  );

  const handleOpenTab = useCallback(() => {
    openTab({ workspaceId, agentId });
    close();
  }, [openTab, close, workspaceId, agentId]);

  return (
    <View>
      <View style={styles.header}>
        {/* A compact layout presents this as a sheet the host already titles. */}
        {compact ? null : <Text style={styles.title}>Skills</Text>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the Skills tab"
          hitSlop={8}
          style={styles.open}
          onPress={handleOpenTab}
        >
          <Text style={styles.openLabel}>Open tab</Text>
          <Icon name="Maximize2" size={13} color={theme.colors.accent} />
        </Pressable>
      </View>
      {/* The composer under this popover is already the agent's, so a successful
          invoke only has to get out of the way of the turn it started. */}
      <SkillBrowser
        theme={theme}
        frame="popover"
        padding={PADDING}
        agentId={agentId}
        onInvoked={close}
      />
    </View>
  );
}
