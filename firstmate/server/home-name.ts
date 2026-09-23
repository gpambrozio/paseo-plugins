/**
 * The first mate's home as Paseo's sidebar names it.
 *
 * Paseo names a project and its workspace after their directory, and the
 * home is `…/plugins/firstmate/home`, so the sidebar said "home" twice.
 * `nameHome` calls both "FirstMate": the workspace by its title, through the
 * SDK, and the project through the CLI, the only way to rename one. A name
 * the captain gave either is kept, and a project is renamed only when it is
 * the home itself — a home chosen inside another project leaves that
 * project's name alone.
 */
import { renameProject } from "./cli";
import { sameDirectory } from "./fleet";
import type { PaseoApi } from "./host-types";

export const HOME_NAME = "FirstMate";

export async function nameHome(
  paseo: PaseoApi,
  workspaceId: string,
  home: string,
  rename: (projectId: string, name: string) => Promise<void> = renameProject,
): Promise<void> {
  const workspace = paseo.workspaces.ref(workspaceId);
  const current = await workspace.refresh();
  if (current === null) return;
  if (current.title === null || current.title === undefined || current.title.trim() === "") {
    await workspace.setTitle(HOME_NAME);
  }
  const customName = current.projectCustomName?.trim() ?? "";
  if (customName === "" && (await sameDirectory(current.projectRootPath, home))) {
    await rename(current.projectId, HOME_NAME);
  }
}

/** Workspaces already named by this process, so the board's poll names one once, not every few seconds. */
const named = new Set<string>();

/**
 * `nameHome` for a first mate that was launched before the plugin named its
 * home, once per plugin process. Never throws: a name is not worth a failed
 * board, so a failure is logged and tried again after the next reload.
 */
export function nameHomeOnce(paseo: PaseoApi, workspaceId: string, home: string): void {
  if (named.has(workspaceId)) return;
  named.add(workspaceId);
  nameHome(paseo, workspaceId, home).catch((error: unknown) => {
    console.error(`[firstmate] could not name the home's workspace ${workspaceId}:`, error);
  });
}
