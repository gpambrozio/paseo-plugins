/**
 * The first mate's home as Paseo's sidebar names it.
 *
 * Paseo names a project and its workspace after their directory, and the
 * home is `…/plugins/firstmate/home`, so the sidebar said "home" twice.
 * `nameHome` calls both "FirstMate": the workspace by its title, through the
 * SDK, and the project through the CLI, the only way to rename one. A name
 * the captain gave either is kept, and a project is renamed only when it is
 * the home itself — a home chosen inside another project leaves that
 * project's name alone. (The icon is a file in the home; see `home-icon.ts`.)
 */
import { renameProject } from "./cli";
import { sameDirectory } from "./fleet";
import type { PaseoApi } from "./host-types";

export const HOME_NAME = "FirstMate";

function blank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

export async function nameHome(
  paseo: PaseoApi,
  workspaceId: string,
  home: string,
  rename: (projectId: string, name: string) => Promise<void> = renameProject,
): Promise<void> {
  const workspace = paseo.workspaces.ref(workspaceId);
  const current = await workspace.refresh();
  if (current === null) return;
  if (blank(current.title)) await workspace.setTitle(HOME_NAME);
  if (blank(current.projectCustomName) && (await sameDirectory(current.projectRootPath, home))) {
    await rename(current.projectId, HOME_NAME);
  }
}

/** Workspaces already named by this process, so the board's poll names one once, not every few seconds. */
const named = new Set<string>();

/**
 * `nameHome` once per workspace per plugin process — at launch and restart,
 * and from the board for a first mate launched before the plugin named its
 * home. Never throws: a name is not worth a failed launch or board, so a
 * failure is logged and tried again after the next reload.
 */
export function nameHomeOnce(paseo: PaseoApi, workspaceId: string, home: string): void {
  if (named.has(workspaceId)) return;
  named.add(workspaceId);
  nameHome(paseo, workspaceId, home).catch((error: unknown) => {
    console.error(`[firstmate] could not name the home's workspace ${workspaceId}:`, error);
  });
}
