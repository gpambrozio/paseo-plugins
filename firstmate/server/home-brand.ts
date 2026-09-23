/**
 * The first mate's home as Paseo's sidebar shows it: its name and its icon.
 *
 * Paseo names a project and its workspace after their directory, and the
 * home is `…/plugins/firstmate/home`, so the sidebar said "home" twice under
 * a generic folder icon. `brandHome` calls both "FirstMate" — the workspace by
 * its title, through the SDK; the project through the CLI, the only way to
 * rename one — and gives the project the FirstMate ship as its icon, through
 * the daemon's own `project.icon.set` request, which neither the SDK nor the
 * CLI offers (`daemon-session.ts`).
 *
 * Whatever the captain chose is kept: a title, a project name or an icon of
 * their own is left alone. And the project is touched only when it is the
 * home itself — a home chosen inside another project leaves that project's
 * name and icon alone.
 */
import { renameProject } from "./cli";
import { sendSessionRequest } from "./daemon-session";
import { sameDirectory } from "./fleet";
import { HOME_ICON_PNG } from "./home-icon";
import type { PaseoApi } from "./host-types";

export const HOME_NAME = "FirstMate";

export interface BrandDeps {
  renameProject: (projectId: string, name: string) => Promise<void>;
  /** Uploads a base64 image as the project's icon. */
  setProjectIcon: (projectId: string, base64: string) => Promise<void>;
}

/** The daemon's answer to `project.icon.set.request`; refused with its own reason when the image is not one it takes. */
async function uploadProjectIcon(projectId: string, base64: string): Promise<void> {
  const payload = await sendSessionRequest(
    { type: "project.icon.set.request", projectId, source: { type: "upload", data: base64 } },
    "project.icon.set.response",
  );
  if (payload.accepted !== true) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Paseo refused the project icon.");
  }
}

const DEFAULT_DEPS: BrandDeps = { renameProject, setProjectIcon: uploadProjectIcon };

function blank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

export async function brandHome(
  paseo: PaseoApi,
  workspaceId: string,
  home: string,
  deps: BrandDeps = DEFAULT_DEPS,
): Promise<void> {
  const workspace = paseo.workspaces.ref(workspaceId);
  const current = await workspace.refresh();
  if (current === null) return;
  if (blank(current.title)) await workspace.setTitle(HOME_NAME);
  if (!(await sameDirectory(current.projectRootPath, home))) return;
  if (blank(current.projectCustomName)) await deps.renameProject(current.projectId, HOME_NAME);
  if (blank(current.projectCustomIconRevision)) await deps.setProjectIcon(current.projectId, HOME_ICON_PNG);
}

/** Workspaces already branded by this process, so the board's poll brands one once, not every few seconds. */
const branded = new Set<string>();

/**
 * `brandHome` once per workspace per plugin process — at launch and restart,
 * and from the board for a first mate launched before the plugin did this.
 * Never throws: a name or an icon is not worth a failed launch or board, so a
 * failure is logged and tried again after the next reload.
 */
export function brandHomeOnce(paseo: PaseoApi, workspaceId: string, home: string): void {
  if (branded.has(workspaceId)) return;
  branded.add(workspaceId);
  brandHome(paseo, workspaceId, home).catch((error: unknown) => {
    console.error(`[firstmate] could not name the home's workspace ${workspaceId} or give it its icon:`, error);
  });
}
