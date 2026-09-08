/**
 * The two settings documents the *app* owns, as opposed to the ones the daemon
 * keeps in `$PASEO_HOME/plugins/github-board/settings.json`.
 *
 * The split is which side has to read the value. `login` and the launch
 * defaults stay in the daemon's file because handlers act on them — `gh` runs
 * every query as that login, and `board.send-options` answers with those
 * defaults. Everything here is only ever read to *draw* the board, so it moves
 * to the host settings store, where the client reads it directly instead of
 * asking the daemon to carry it back on every `board.load`.
 *
 * `scope: "host"` is the only scope there is, and it reaches exactly as far as
 * the settings file did: every authorized client of one daemon.
 */
import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

import { COLUMN_IDS, type PromptSet, type PromptSettings } from "./board";

/**
 * What the send dialog opens with, before the user changes it. Each one names
 * the kind of work its column holds, because "read this URL" alone tells an
 * agent nothing about whether it is being asked to fix, finish, or review.
 */
export const DEFAULT_PROMPTS: PromptSet = {
  issues: "Read issue {url}, investigate and give me ways to address it.",
  "draft-prs": "Read draft pull request {url} and help me finish it.",
  "open-prs": "Review pull request {url} and tell me what needs attention.",
  discussions: "Read discussion {url} and summarise what is being decided.",
};

const PROMPT_KEYS: readonly (keyof PromptSet)[] = COLUMN_IDS;

/**
 * How the board is drawn, for this daemon's clients. Both fields survive the
 * surface unmounting on every workspace switch, which is what they are stored
 * for; neither means anything to the daemon.
 */
export const displaySettings = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: z.object({
    /** The repository filter, stored as the repositories to hide. */
    hiddenRepositories: z.array(z.string()).default([]),
    /**
     * The detail panel's width as a share of the board's body, or null for the
     * default half. A share rather than pixels: the width was chosen against
     * one window and has to survive a different one — or a different machine.
     */
    detailWidthFraction: z.number().min(0).max(1).nullable().default(null),
  }),
});

/**
 * The first message a card is sent with. Defaults are supplied at every level
 * so that parsing `{}` — a client that has never saved — produces a complete
 * document, which is what the settings API requires.
 */
export const promptSettings = defineSettings({
  id: "prompts",
  scope: "host",
  version: 1,
  schema: z.object({
    byType: z
      .object({
        issues: z.string().default(DEFAULT_PROMPTS.issues),
        "draft-prs": z.string().default(DEFAULT_PROMPTS["draft-prs"]),
        "open-prs": z.string().default(DEFAULT_PROMPTS["open-prs"]),
        discussions: z.string().default(DEFAULT_PROMPTS.discussions),
      })
      .default(DEFAULT_PROMPTS),
    byProject: z
      .record(
        z.string(),
        z.object({
          issues: z.string().optional(),
          "draft-prs": z.string().optional(),
          "open-prs": z.string().optional(),
          discussions: z.string().optional(),
        }),
      )
      .default({}),
  }),
});

/**
 * Blank means "inherit", at both levels: a missing or empty `byType` entry
 * becomes the built-in default, and a missing or empty override is dropped so
 * the card falls back to `byType`. That is what makes clearing a field the way
 * to reset it, rather than a separate action — and it is why an override never
 * stores a copy of the inherited value, which would freeze a default the user
 * later edits.
 *
 * Applied at the save boundary rather than in the schema, so the settings
 * screen's draft can hold a blank field while it is being cleared.
 */
export function normalizePrompts(value: PromptSettings): PromptSettings {
  const byType = { ...DEFAULT_PROMPTS };
  for (const key of PROMPT_KEYS) {
    const template = value.byType[key];
    byType[key] = template.trim() === "" ? DEFAULT_PROMPTS[key] : template;
  }

  const byProject: PromptSettings["byProject"] = {};
  for (const [projectId, overrides] of Object.entries(value.byProject)) {
    const kept: Partial<PromptSet> = {};
    for (const key of PROMPT_KEYS) {
      const template = overrides[key];
      if (template !== undefined && template.trim() !== "") kept[key] = template;
    }
    if (Object.keys(kept).length > 0) byProject[projectId] = kept;
  }
  return { byType, byProject };
}
