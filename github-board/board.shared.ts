import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * The four columns the board renders, in display order. Draft and open pull
 * requests come from a single search and are split by `isDraft`, so the column
 * id is presentation only — see board.server.ts.
 */
export const COLUMN_IDS = ["issues", "draft-prs", "open-prs", "discussions"] as const;

export type ColumnId = (typeof COLUMN_IDS)[number];

/**
 * An issue a pull request closes, as GitHub's `closingIssuesReferences` reports
 * it. The id is the same node id `gh search issues` returns, so the board can
 * match a linked issue to its card by identity rather than by number.
 */
export const LinkedIssueSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  repository: z.string(),
});

/**
 * A pull request's checks, folded to the three counts a card shows: passed,
 * failed, and still running. Skipped and cancelled checks are counted nowhere —
 * they are neither a result nor a wait — which is the same fold Paseo's own
 * workspace hover card does, so the board and the sidebar agree about a pull
 * request they both show.
 */
export const CheckSummarySchema = z.object({
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  pending: z.number().int().min(0),
});

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
  /**
   * Who opened it, or null when GitHub reports no author because the account is
   * gone. The board queries its own repositories as well as its own work, so a
   * card is not necessarily the viewer's; the card names the author when it is
   * someone else's.
   */
  author: z.string().nullable(),
  /** Column-specific trailing detail, e.g. a discussion's category. */
  detail: z.string().nullable(),
  /**
   * Pull requests only, empty everywhere else. The board renders these as pills
   * on the pull request card and drops the matching cards from the Issues
   * column, so one piece of work occupies one card.
   */
  linkedIssues: z.array(LinkedIssueSchema),
  /**
   * Open pull requests only. Null wherever the board shows no pills at all: an
   * item that is not a pull request, a draft — whose CI is not yet anyone's
   * business — or a head commit nothing has ever reported a check on.
   */
  checks: CheckSummarySchema.nullable(),
});

/**
 * A label as its repository defines it. `color` is six hex digits with no `#`,
 * exactly as GitHub stores it — it is data belonging to the label, not one of
 * the plugin theme's tokens, which is why the menu is allowed to paint with it.
 */
export const RepositoryLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  description: z.string().nullable(),
});

/**
 * The first message a card is sent with, one template per column — the four
 * columns are the four kinds of work the board shows, so the column id doubles
 * as the template key. It is what the launch dialog opens on; the user is free
 * to rewrite it before sending.
 *
 * Templates carry `{url}`, `{title}`, `{number}` and `{repository}`; anything
 * else in braces is left alone rather than blanked, so an unknown placeholder
 * shows up in the prompt instead of vanishing.
 */
export const PromptSetSchema = z.object({
  issues: z.string(),
  "draft-prs": z.string(),
  "open-prs": z.string(),
  discussions: z.string(),
});

export const PromptSettingsSchema = z.object({
  /** Always complete on the way out: the server fills a blank with its default. */
  byType: PromptSetSchema,
  /**
   * Keyed by Paseo project id, and partial on purpose — a type absent here, or
   * present but blank, inherits `byType`. Storing the inherited value instead
   * would freeze a copy that stops tracking the default it came from.
   *
   * Projects rather than repositories: a card can only be sent to a project in
   * the first place, and a fork's origin and upstream are two repositories but
   * one project, which should not need configuring twice.
   */
  byProject: z.record(z.string(), PromptSetSchema.partial()),
});

/** A Paseo project, as the settings view lists it to be configured. */
export const ProjectRefSchema = z.object({
  id: z.string(),
  name: z.string(),
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
  /**
   * Rides along for the same reason the filter does: the launch dialog opens
   * with the card's prompt already rendered, so the template has to be on the
   * client before the button is pressed rather than a round trip behind it.
   */
  prompts: PromptSettingsSchema,
  /** Every live Paseo project, so the settings view can list them all. */
  projects: z.array(ProjectRefSchema),
  /**
   * `owner/name` to project id, for the repositories on this board only. The
   * surface needs it to pick a template during the press gesture, and it is
   * keyed the way a card spells its repository so no host parsing is needed on
   * the client.
   */
  repositoryProjects: z.record(z.string(), z.string()),
  fetchedAt: z.string(),
});

export type ProjectRef = z.output<typeof ProjectRefSchema>;
export type PromptSet = z.output<typeof PromptSetSchema>;
export type PromptSettings = z.output<typeof PromptSettingsSchema>;
export type LinkedIssue = z.output<typeof LinkedIssueSchema>;
export type RepositoryLabel = z.output<typeof RepositoryLabelSchema>;
export type CheckSummary = z.output<typeof CheckSummarySchema>;
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

/**
 * How the workspace is cut: on the project's own checkout, or on a fresh Paseo
 * worktree branched off it. The daemon spells these as the two `source` kinds
 * of `workspace.create`, and only a git project can be worktreed.
 */
export const IsolationSchema = z.enum(["local", "worktree"]);

export type Isolation = z.output<typeof IsolationSchema>;

/**
 * What the launch dialog was set to the last time a card was sent, so the next
 * card opens on the same agent rather than back at the daemon's defaults.
 *
 * Every field is nullable because a saved choice is a *preference*, not a
 * promise: a model that has since disappeared, or a provider that is no longer
 * installed, must fall back to what the host actually offers rather than fail
 * the send.
 */
export const LaunchDefaultsSchema = z.object({
  /** Provider id as the providers snapshot spells it, e.g. `claude`. */
  provider: z.string().nullable(),
  /** Model id within that provider. Never blank: the SDK needs `provider/model`. */
  model: z.string().nullable(),
  /** The provider's permission mode, when it has any. */
  modeId: z.string().nullable(),
  /** The model's thinking level, when it has any. */
  thinkingOptionId: z.string().nullable(),
  isolation: IsolationSchema,
});

export type LaunchDefaults = z.output<typeof LaunchDefaultsSchema>;

/**
 * Everything the launch dialog needs that only the daemon can answer: which
 * project this card belongs to, whether that project can be worktreed, and what
 * the last send was configured with.
 *
 * The provider, model, thinking and permission options are *not* here — the
 * dialog reads those from the host directly with `usePaseo().providers`, the
 * same snapshot Paseo's own composer renders, so this plugin never has to
 * mirror a provider catalogue that changes underneath it.
 */
export const sendOptions = defineRpc({
  name: "board.send-options",
  input: z.object({
    /** `owner/name`, matched against the project's GitHub remotes. */
    repository: z.string(),
    /** The card's URL, which is where the forge host comes from. */
    url: z.string(),
  }),
  output: z.object({
    project: z.object({
      id: z.string(),
      name: z.string(),
      /**
       * The checkout the workspace is cut from, and the cwd the provider
       * snapshot is resolved against — models can differ per directory.
       */
      rootPath: z.string(),
      /** False for a non-git project, where "New worktree" cannot be offered. */
      supportsWorktree: z.boolean(),
    }),
    defaults: LaunchDefaultsSchema,
  }),
});

/**
 * Hands one card to a fresh workspace and starts the conversation: the
 * repository is matched to a Paseo project on the daemon, a workspace is
 * created on that project (locally or as a worktree), an agent is created in it
 * with the chosen provider, model, thinking level and permission mode, and the
 * prompt is sent as its first message.
 *
 * The chosen configuration is saved as the next card's defaults, in the same
 * round trip — a second RPC to persist it would be a second failure mode for no
 * gain.
 */
export const sendToChat = defineRpc({
  name: "board.send-to-chat",
  input: z.object({
    /** `owner/name`, matched against the project's GitHub remote. */
    repository: z.string(),
    number: z.number().int(),
    title: z.string(),
    /** The card's URL, and the source of the forge host. */
    url: z.string(),
    /** The first message, as the dialog left it — already rendered from the template. */
    prompt: z.string().min(1),
    isolation: IsolationSchema,
    provider: z.string().min(1),
    /** Required: the SDK creates agents by `provider/model` and rejects a bare provider. */
    model: z.string().min(1),
    modeId: z.string().nullable(),
    thinkingOptionId: z.string().nullable(),
  }),
  output: z.object({
    workspaceId: z.string(),
    /** What the new workspace ended up called, for the confirmation message. */
    workspaceName: z.string(),
    projectName: z.string(),
    /** The agent the prompt was sent to, so the app can open straight into it. */
    agentId: z.string(),
  }),
});

/**
 * Saves every template at once. A blank `byType` entry is stored as the
 * built-in default and a blank override is dropped, so "clear the field" is how
 * a template is reset rather than a separate action.
 */
export const savePrompts = defineRpc({
  name: "board.save-prompts",
  input: PromptSettingsSchema,
  output: PromptSettingsSchema,
});

/**
 * Every label the repository defines, for the menu a card opens on right-click.
 * Which of them the card already carries is `BoardItem.labels`, so this is the
 * catalogue and the item is the selection.
 */
export const listLabels = defineRpc({
  name: "board.labels",
  input: z.object({ repository: z.string().min(1) }),
  output: z.object({ labels: z.array(RepositoryLabelSchema) }),
});

/**
 * Adds or removes one label, and answers with the item's labels as GitHub
 * reports them *after* the change rather than with what the caller assumed.
 * Someone else editing the same issue therefore corrects the card instead of
 * being silently overwritten by it.
 *
 * One label per call, because the menu applies each toggle as it is pressed:
 * a menu that batched until it closed would leave the user unsure whether
 * anything had happened, and a dropped press impossible to notice.
 */
export const toggleLabel = defineRpc({
  name: "board.toggle-label",
  input: z.object({
    /** The issue or pull request node id — GitHub calls the type `Labelable`. */
    itemId: z.string().min(1),
    labelId: z.string().min(1),
    /** True adds the label, false removes it. */
    add: z.boolean(),
  }),
  output: z.object({ labels: z.array(z.string()) }),
});

/**
 * What a card knows about itself already — title, repository, labels, author —
 * is left off this shape on purpose: the panel paints those from the card the
 * moment it opens, and this round trip only adds what the search never fetched.
 */
export const ItemDetailsSchema = z.object({
  /**
   * `open` for everything the board lists today; the rest cover an item that
   * changed on GitHub after the board was fetched, which the panel is the first
   * place to notice. A draft pull request reads `draft` rather than `open`.
   */
  state: z.enum(["open", "draft", "closed", "merged"]),
  /** Markdown, exactly as GitHub stores it. Empty when the author wrote nothing. */
  body: z.string(),
  createdAt: z.string(),
  /** Logins. Always empty for a discussion, which GitHub does not assign. */
  assignees: z.array(z.string()),
  /** Pull requests only: the branch under review and the one it targets. */
  branches: z.object({ head: z.string(), base: z.string() }).nullable(),
});

export type ItemDetails = z.output<typeof ItemDetailsSchema>;

/**
 * The body and status of one card, for the detail panel. Looked up by node id
 * rather than by repository and number because `node(id:)` needs no type
 * argument — the same id opens an issue, a pull request or a discussion — and
 * because the id is what every card already carries.
 */
export const loadItem = defineRpc({
  name: "board.item",
  input: z.object({
    id: z.string().min(1),
    /** Set by the panel's Refresh button to bypass the server's short-lived cache. */
    force: z.boolean().default(false),
  }),
  output: ItemDetailsSchema,
});

export const ItemCommentSchema = z.object({
  id: z.string(),
  /** Null for a deleted account, as with `BoardItem.author`. */
  author: z.string().nullable(),
  createdAt: z.string(),
  /** Markdown, as GitHub stores it. */
  body: z.string(),
  /**
   * 0 for a comment on the item, 1 for a reply to one — discussions thread
   * their comments one level deep, and the panel indents replies to say so.
   * Issue and pull request comments are always 0.
   */
  depth: z.number().int().min(0),
});

export type ItemComment = z.output<typeof ItemCommentSchema>;

/**
 * The conversation on one card, loaded on request from the bottom of the
 * detail panel rather than with the body: comments are the long tail of an
 * item, and most panels are opened to read the description.
 *
 * For a pull request this is the conversation tab only — review comments on
 * the diff are a different object and are not fetched.
 */
export const loadComments = defineRpc({
  name: "board.comments",
  input: z.object({
    id: z.string().min(1),
    /** Set by the panel's Refresh button to bypass the server's short-lived cache. */
    force: z.boolean().default(false),
  }),
  output: z.object({
    comments: z.array(ItemCommentSchema),
    /** True when GitHub has more than the page fetched; the rest are on GitHub. */
    truncated: z.boolean(),
  }),
});
