import {
  type PluginButtonIconProps,
  type PluginButtonRegistration,
  type PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect } from "react";

import { countEntries, useSkillsQuery } from "./skills-query";

/** What the pill reads before the count is known, and the accessible name throughout. */
const TITLE = "Skills";

/**
 * Paseo draws the pill from a plain description — an icon, a label and a press
 * behaviour — so the count cannot come from a render. It comes from here: the
 * icon is the one part of the description that *is* a component, so it runs the
 * query and pushes the answer back into the label.
 *
 * That indirection buys the property the count needs. `contributePills`
 * registers a pill for every agent on the host, but the host only mounts one
 * when that agent's composer is on screen, so the scan stays bounded to the
 * agents the user is looking at rather than to every agent that exists.
 *
 * The label is deliberately `Skills` until the query answers — a pill that
 * reads `Skills 0` for a second on every mount is worse than one that reads
 * `Skills` and then gains a number.
 */
function createPillIcon(agentId: string, pill: { current?: PluginButtonRegistration }) {
  return function SkillsPillIcon({ size, color }: PluginButtonIconProps) {
    const query = useSkillsQuery(agentId);
    const label = query.data ? `${TITLE} ${countEntries(query.data)}` : TITLE;

    // Updating an already-removed registration is a documented no-op, so an
    // agent that goes away mid-query needs no teardown here.
    useEffect(() => {
      pill.current?.update({ label });
    }, [pill, label]);

    return <Icon name="Sparkles" size={size} color={color} />;
  };
}

/**
 * One pill per agent, opening that agent's Skills panel.
 *
 * The client entry runs once per installation per connected app, so this owns
 * the whole set: it seeds from the agents that already exist, follows the update
 * stream for the rest, and removes every registration on teardown.
 */
export function contributePills(client: PluginClientContext) {
  const pills = new Map<string, PluginButtonRegistration>();

  function addPill(agentId: string, workspaceId: string) {
    // Agent updates fire on every turn of every agent. Nothing in the pill
    // depends on the snapshot, so re-registering would only unmount the icon
    // and refire its query — and Paseo rejects a duplicate id outright.
    if (pills.has(agentId)) return;

    // The icon needs the registration that is about to be created from it, so
    // it reaches the registration through this box rather than through a prop.
    const pill: { current?: PluginButtonRegistration } = {};
    pill.current = client.addComposerPill({
      id: "skills",
      workspaceId,
      agentId,
      button: {
        title: TITLE,
        label: TITLE,
        icon: createPillIcon(agentId, pill),
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel("skills", { workspaceId, agentId });
          },
        },
      },
    });
    pills.set(agentId, pill.current);
  }

  function removePill(agentId: string) {
    pills.get(agentId)?.remove();
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
    pills.forEach((pill) => pill.remove());
    pills.clear();
  };
}
