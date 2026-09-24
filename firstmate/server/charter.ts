/**
 * The first mate's charter: the `AGENTS.md` written into its home.
 *
 * The charter is the port of FirstMate's operating contract — the part of that
 * distro that is behaviour rather than plumbing. Everything it did with tmux
 * panes, treehouse worktrees, a bash watcher and status files is done with
 * Paseo's own tools, which every Paseo agent already has: `create_workspace`
 * makes the worktree, `create_agent` starts the crewmate in it, Paseo's finish
 * notification is the wake-up, and the crewmate's last line is its status.
 *
 * Its words are `templates/data/charter.md`, and the home keeps a copy the
 * captain can edit, `data/charter.md` (`charter-file.ts`). This renders
 * `AGENTS.md` from that copy — into `templates/AGENTS.md`, which heads it with
 * a note — whenever the plugin starts and whenever the first mate is launched,
 * so a change reaches the home on the next reload and the first mate at its
 * next session, or at once when it is asked to re-read the file.
 *
 * `{{name}}` placeholders are filled here; the labels come from
 * `shared/fleet.ts` so the board and the charter can never disagree on them,
 * and the crew's model and mode are sentences from `templates/parts/`, one
 * for a setting left open and one for a setting chosen.
 */
import { CREW_LABELS } from "../shared/fleet";
import { TEMPLATES, fill, readTemplate, withoutNotes, type TemplatePath } from "./templates";

export interface CharterValues {
  /** Absolute path of the first mate's home. */
  home: string;
  /** `provider/model` for crewmates, or empty to leave it to the first mate. */
  crewProvider: string;
  /** Permission mode id for crewmates, or empty for the provider's default. */
  crewModeId: string;
}

/** The plugin's own charter, as the home's copy starts: notes left out, placeholders unfilled. */
export async function pluginCharter(): Promise<string> {
  return withoutNotes(await readTemplate(TEMPLATES.charter));
}

/** A part from `templates/parts/`, notes left out and its own placeholders filled. */
async function part(path: TemplatePath, values: Record<string, string>): Promise<string> {
  return fill(withoutNotes(await readTemplate(path)), values);
}

/** `AGENTS.md`: `charter` — the captain's copy, or by default the plugin's — filled in and under its heading note. */
export async function renderCharter(values: CharterValues, charter?: string): Promise<string> {
  const crewProvider = values.crewProvider.trim();
  const crewModeId = values.crewModeId.trim();
  const [template, agents, crewProviderRule, crewModeRule] = await Promise.all([
    charter ?? pluginCharter(),
    readTemplate(TEMPLATES.agents),
    crewProvider === ""
      ? part(TEMPLATES.crewProviderOpen, {})
      : part(TEMPLATES.crewProviderChosen, { crewProvider }),
    crewModeId === "" ? part(TEMPLATES.crewModeOpen, {}) : part(TEMPLATES.crewModeChosen, { crewModeId }),
  ]);
  const body = fill(template, {
    home: values.home,
    roleLabel: CREW_LABELS.role,
    crewRole: CREW_LABELS.crewRole,
    taskLabel: CREW_LABELS.task,
    kindLabel: CREW_LABELS.kind,
    projectLabel: CREW_LABELS.project,
    crewProviderRule,
    crewModeRule,
  });
  return `${fill(agents, { charter: body.trim() }).trimEnd()}\n`;
}
