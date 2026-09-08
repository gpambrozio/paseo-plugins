import type { PluginServerContext } from "@getpaseo/plugin/server";

import { createListSkillsHandler, createReadSkillHandler } from "./server/skills";
import { listSkills, readSkill } from "./shared/skills";

export default function contribute(server: PluginServerContext) {
  server.handle(listSkills, createListSkillsHandler());
  server.handle(readSkill, createReadSkillHandler());
  return () => {};
}
