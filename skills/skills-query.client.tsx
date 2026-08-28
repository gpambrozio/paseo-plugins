import { useAgent, useRpc } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";

import { listSkills } from "./skills.shared";

type SkillsResult = z.infer<(typeof listSkills)["output"]>;

/**
 * The panel and the composer pill ask the same question, so they share a query
 * key and answer each other's cache: opening the panel from a pill that has
 * already counted costs no second scan. `cwd` is in the key because a rebased or
 * moved workspace changes what discovery finds.
 */
export function useSkillsQuery(agentId: string) {
  const cwd = useAgent(agentId, (snapshot) => snapshot.cwd);
  const callListSkills = useRpc(listSkills);
  return useQuery({
    queryKey: ["skills", agentId, cwd],
    queryFn: () => callListSkills({ agentId }),
    enabled: cwd != null,
    retry: false,
  });
}

/** Everything the panel lists, which is what the pill's badge promises. */
export function countEntries(data: SkillsResult): number {
  return data.skills.length + data.reported.skills.length + data.reported.commands.length;
}
