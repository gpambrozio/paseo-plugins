/**
 * The title of a workspace, for naming the work out loud. Agents are usually
 * untitled; the workspace is what the user calls it. Cached, because titles
 * change rarely and every event would otherwise page through the workspace
 * list.
 */
import type { PaseoApi } from "./paseo-api";

export const WORKSPACE_TITLE_TTL_MS = 5 * 60 * 1000;

export type WorkspaceTitleLookup = (workspaceId: string | null, paseo: PaseoApi) => Promise<string | null>;

export function createWorkspaceTitleLookup(now: () => number = Date.now): WorkspaceTitleLookup {
  const cache = new Map<string, { at: number; title: string | null }>();
  return async function workspaceTitle(workspaceId, paseo) {
    if (workspaceId === null) return null;
    const cached = cache.get(workspaceId);
    const at = now();
    if (cached !== undefined && at - cached.at < WORKSPACE_TITLE_TTL_MS) return cached.title;
    let title: string | null = null;
    try {
      const workspace = await paseo.workspaces.ref(workspaceId).refresh();
      title = workspace?.title?.trim() || workspace?.name?.trim() || null;
    } catch (error) {
      console.warn(
        `[herald] could not read the title of workspace ${workspaceId}:`,
        error instanceof Error ? error.message : error,
      );
    }
    cache.set(workspaceId, { at, title });
    return title;
  };
}
