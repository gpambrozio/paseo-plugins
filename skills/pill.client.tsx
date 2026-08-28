import { Icon, type PluginClientContext, type PluginComposerPillProps } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text } from "react-native";

import { countEntries, useSkillsQuery } from "./skills-query.client";

/**
 * Paseo owns the pressable and the pill chrome; this renders only the icon and
 * the label inside it. The count is deliberately absent until the query answers
 * — a pill that reads "Skills 0" for a second on every mount is worse than one
 * that reads "Skills" and then gains a number.
 */
function SkillsPill({ theme, agentId }: PluginComposerPillProps) {
  const query = useSkillsQuery(agentId);
  const label = query.data ? `Skills ${countEntries(query.data)}` : "Skills";
  const style = useMemo(
    () => ({ color: theme.colors.foregroundMuted, flexShrink: 1 }),
    [theme],
  );

  return (
    <>
      <Icon name="Sparkles" size={14} color={theme.colors.foregroundMuted} />
      <Text numberOfLines={1} style={style}>
        {label}
      </Text>
    </>
  );
}

/**
 * One pill per agent, opening that agent's Skills panel.
 *
 * `addClientSide` runs once per installation per connected app, so this owns the
 * whole set: it seeds from the agents that already exist, follows the update
 * stream for the rest, and hands every registration back on teardown.
 */
export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, () => void>();

  function addPill(agentId: string, workspaceId: string) {
    // Agent updates fire on every turn of every agent. Nothing in the pill
    // depends on the snapshot, so re-registering would only unmount the
    // component and refire its query.
    if (pills.has(agentId)) return;
    pills.set(
      agentId,
      client.addComposerPill({
        id: "skills",
        title: "Skills",
        workspaceId,
        agentId,
        Component: SkillsPill,
        onPress() {
          client.openPanel("skills", { workspaceId, agentId });
        },
      }),
    );
  }

  function removePill(agentId: string) {
    pills.get(agentId)?.();
    pills.delete(agentId);
  }

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") {
      removePill(update.agentId);
      return;
    }
    const { id, workspaceId } = update.agent;
    if (workspaceId) addPill(id, workspaceId);
  });

  // `subscribe` only reports change. Without this seed, an agent that was
  // already sitting idle when the app connected would have no pill until it
  // next did something.
  client.paseo.agents
    .list()
    .then((result) => {
      // A `for…of` body would capture the loop binding, not the entry.
      result.entries.forEach(({ agent }) => {
        if (agent.workspaceId) addPill(agent.id, agent.workspaceId);
      });
    })
    .catch((error: unknown) => {
      console.error("skills: could not seed composer pills", error);
    });

  return () => {
    unsubscribe();
    pills.forEach((remove) => remove());
    pills.clear();
  };
}
