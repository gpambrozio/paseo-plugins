import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * The four columns the board renders, in display order. Draft and open pull
 * requests come from a single `gh search prs` call and are split by `isDraft`,
 * so the column id is presentation only — see board.server.ts.
 */
export const COLUMN_IDS = ["issues", "draft-prs", "open-prs", "discussions"] as const;

export type ColumnId = (typeof COLUMN_IDS)[number];

export const BoardItemSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  /** `owner/name`, the only repository form the board displays. */
  repository: z.string(),
  updatedAt: z.string(),
  commentsCount: z.number().int(),
  labels: z.array(z.string()),
  /** Column-specific trailing detail, e.g. a discussion's category. */
  detail: z.string().nullable(),
});

export const BoardColumnSchema = z.object({
  id: z.enum(COLUMN_IDS),
  title: z.string(),
  items: z.array(BoardItemSchema),
  /**
   * Set when this column alone failed. Columns fail independently so a missing
   * `read:discussion` scope does not blank the issues and pull request columns.
   */
  error: z.string().nullable(),
});

export const BoardSchema = z.object({
  /** The concrete login every query ran against, never the `@me` alias. */
  login: z.string(),
  columns: z.array(BoardColumnSchema),
  /**
   * The saved repository filter, as the repositories to hide. Rides along with
   * the board so the surface can restore the filter on its first render instead
   * of flashing an unfiltered board while a second round trip lands.
   */
  hiddenRepositories: z.array(z.string()),
  fetchedAt: z.string(),
});

export type BoardItem = z.output<typeof BoardItemSchema>;
export type BoardColumn = z.output<typeof BoardColumnSchema>;
export type Board = z.output<typeof BoardSchema>;

export const loadBoard = defineRpc({
  name: "board.load",
  input: z.object({
    /** Omitted on first load: the server falls back to the saved login. */
    login: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(30),
    /** Set by the Refresh button to bypass the server's short-lived board cache. */
    force: z.boolean().default(false),
  }),
  output: BoardSchema,
});

export const saveLogin = defineRpc({
  name: "board.save-login",
  input: z.object({ login: z.string() }),
  output: z.object({ login: z.string() }),
});

/**
 * The repository filter outlives the surface, which unmounts whenever the user
 * switches workspaces, so the selection lives next to the login rather than in
 * component state.
 */
export const saveRepositoryFilter = defineRpc({
  name: "board.save-filter",
  input: z.object({ hiddenRepositories: z.array(z.string()) }),
  output: z.object({ hiddenRepositories: z.array(z.string()) }),
});
