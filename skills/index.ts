import type { PluginContext } from "@getpaseo/plugin";

import { SkillsPanel } from "./panel.client";
import { contributeClient } from "./pill.client";
import { createListSkillsHandler, createReadSkillHandler } from "./skills.server";
import { listSkills, readSkill } from "./skills.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listSkills, createListSkillsHandler());
  plugin.handle(readSkill, createReadSkillHandler());
  plugin.addWorkspacePanel({
    id: "skills",
    title: "Skills",
    icon: "Sparkles",
    context: "agent",
    Component: SkillsPanel,
  });
  // The pill reaches the panel from the composer; the Command Center item is
  // the keyboard path and the only one an app without `addClientSide` has.
  plugin.addClientSide(contributeClient);
  plugin.addCommandCenterItem({
    id: "open-skills",
    title: "Skills",
    icon: "Sparkles",
    keywords: ["skill", "skills", "agent skills"],
    context: "agent",
    onSelect: ({ openPanel }) => {
      openPanel("skills");
    },
  });
  return () => {};
}
