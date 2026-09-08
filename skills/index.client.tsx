import type { PluginClientContext } from "@getpaseo/plugin/client";

import { SkillsPanel } from "./client/panel";
import { contributePills } from "./client/pill";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "skills",
    title: "Skills",
    icon: "Sparkles",
    context: "agent",
    Component: SkillsPanel,
  });
  client.addCommandCenterItem({
    id: "open-skills",
    title: "Skills",
    icon: "Sparkles",
    keywords: ["skill", "skills", "agent skills"],
    context: "agent",
    onSelect: ({ openPanel }) => {
      openPanel("skills");
    },
  });
  // The pill reaches the panel from the composer; the Command Center item is
  // the keyboard path to the same panel.
  return contributePills(client);
}
