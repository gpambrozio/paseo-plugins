import type { PluginContext } from "@getpaseo/plugin";

import { SkillsPanel } from "./panel.client";
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
