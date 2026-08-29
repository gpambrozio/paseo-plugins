import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { z } from "zod";
import type { PluginHandlerContext } from "@getpaseo/plugin";
import type {
  BoardColumn,
  BoardItem,
  CheckSummary,
  RepositoryLabel,
  LaunchDefaults,
  LinkedIssue,
  PromptSet,
  PromptSettings,
  listLabels,
  loadBoard,
  savePrompts,
  saveLogin,
  saveRepositoryFilter,
  sendOptions,
  sendToChat,
  toggleLabel,
} from "./board.shared";

const execFileAsync = promisify(execFile);

/** gh search caps out well under this; the ceiling only guards a runaway page. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function paseoHome(): string {
  return process.env.PASEO_HOME ?? join(homedir(), ".paseo");
}

function settingsPath(): string {
  return join(paseoHome(), "plugins", "github-board", "settings.json");
}

/**
 * What the send dialog opens with, before the user changes it. Each one names
 * the kind of work its column holds, because "read this URL" alone tells an
 * agent nothing about whether it is being asked to fix, finish, or review.
 */
const DEFAULT_PROMPTS: PromptSet = {
  issues: "Read issue {url}, investigate and give me ways to address it.",
  "draft-prs": "Read draft pull request {url} and help me finish it.",
  "open-prs": "Review pull request {url} and tell me what needs attention.",
  discussions: "Read discussion {url} and summarise what is being decided.",
};

const PROMPT_KEYS = Object.keys(DEFAULT_PROMPTS) as (keyof PromptSet)[];

/**
 * What the launch dialog opens on before the user touches it. Written by the
 * send itself, so the second card starts where the first one finished.
 *
 * Nothing here is authoritative: the dialog validates every field against the
 * host's live provider snapshot and drops what no longer exists, which is why
 * the whole record is nullable rather than seeded with a guess.
 */
const EMPTY_LAUNCH: LaunchDefaults = {
  provider: null,
  model: null,
  modeId: null,
  thinkingOptionId: null,
  isolation: "local",
};

interface Settings {
  /** Null until the user pins one; the caller falls back to the gh viewer. */
  login: string | null;
  /** Repositories the board hides, saved as the filter's complement. */
  hiddenRepositories: string[];
  prompts: PromptSettings;
  launch: LaunchDefaults;
}

const EMPTY_SETTINGS: Settings = {
  login: null,
  hiddenRepositories: [],
  prompts: { byType: { ...DEFAULT_PROMPTS }, byProject: {} },
  launch: { ...EMPTY_LAUNCH },
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Blank means "inherit", at both levels: a missing or empty `byType` entry
 * becomes the built-in default, and a missing or empty override is dropped so
 * the card falls back to `byType`. That is what makes clearing a field the way
 * to reset it.
 */
function readPrompts(value: unknown): PromptSettings {
  const raw = (typeof value === "object" && value !== null ? value : {}) as {
    byType?: unknown;
    byProject?: unknown;
  };
  const savedByType = (typeof raw.byType === "object" && raw.byType !== null ? raw.byType : {}) as
    Record<string, unknown>;
  const byType = { ...DEFAULT_PROMPTS };
  for (const key of PROMPT_KEYS) {
    byType[key] = asString(savedByType[key]) ?? DEFAULT_PROMPTS[key];
  }

  const savedByProject = (
    typeof raw.byProject === "object" && raw.byProject !== null ? raw.byProject : {}
  ) as Record<string, unknown>;
  const byProject: PromptSettings["byProject"] = {};
  for (const [repository, overrides] of Object.entries(savedByProject)) {
    if (typeof overrides !== "object" || overrides === null) continue;
    const kept: Partial<PromptSet> = {};
    for (const key of PROMPT_KEYS) {
      const template = asString((overrides as Record<string, unknown>)[key]);
      if (template !== null) kept[key] = template;
    }
    if (Object.keys(kept).length > 0) byProject[repository] = kept;
  }
  return { byType, byProject };
}

/**
 * Reads back a saved launch selection, defaulting every field it cannot make
 * sense of. A settings file written by an older version of this plugin has no
 * `launch` key at all, which is the same case as a blank one.
 */
function readLaunch(value: unknown): LaunchDefaults {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    provider: asString(raw.provider),
    model: asString(raw.model),
    modeId: asString(raw.modeId),
    thinkingOptionId: asString(raw.thinkingOptionId),
    isolation: raw.isolation === "worktree" ? "worktree" : "local",
  };
}

async function readSettings(): Promise<Settings> {
  try {
    const parsed: unknown = JSON.parse(await readFile(settingsPath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return EMPTY_SETTINGS;
    const { login, hiddenRepositories } = parsed as {
      login?: unknown;
      hiddenRepositories?: unknown;
    };
    return {
      login: typeof login === "string" && login.trim() !== "" ? login.trim() : null,
      hiddenRepositories: Array.isArray(hiddenRepositories)
        ? hiddenRepositories.filter((entry): entry is string => typeof entry === "string")
        : [],
      prompts: readPrompts((parsed as { prompts?: unknown }).prompts),
      launch: readLaunch((parsed as { launch?: unknown }).launch),
    };
  } catch {
    // No settings yet, or a file we can no longer parse. Either way the caller
    // falls back to the authenticated viewer, which always resolves.
    return EMPTY_SETTINGS;
  }
}

/**
 * Read-modify-write, because the login, the repository filter, the prompts and
 * the launch defaults are saved by separate handlers and a whole-file write
 * from any of them would drop the others.
 */
async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await readSettings()), ...patch };
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function describeGhFailure(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      return "GitHub CLI (gh) is not installed or not on the daemon's PATH.";
    }
  }
  const stderr =
    typeof error === "object" && error !== null && "stderr" in error
      ? String((error as { stderr?: unknown }).stderr ?? "").trim()
      : "";
  if (stderr.includes("gh auth login") || stderr.toLowerCase().includes("authentication")) {
    return "GitHub CLI is not authenticated. Run `gh auth login` on the daemon machine.";
  }
  if (stderr !== "") return stderr;
  return error instanceof Error ? error.message : String(error);
}

async function gh(args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", [...args], { maxBuffer: MAX_OUTPUT_BYTES });
    return stdout;
  } catch (error) {
    throw new Error(describeGhFailure(error));
  }
}

/**
 * `@me` resolves differently per search type and is opaque in the UI, so every
 * query runs against a concrete login instead.
 */
async function resolveViewerLogin(): Promise<string> {
  const raw = await gh(["api", "graphql", "-f", "query={ viewer { login } }"]);
  const parsed: unknown = JSON.parse(raw);
  const login = (parsed as { data?: { viewer?: { login?: unknown } } }).data?.viewer?.login;
  if (typeof login !== "string" || login === "") {
    throw new Error("GitHub did not return a login for the authenticated account.");
  }
  return login;
}

interface GhSearchNode {
  id?: unknown;
  number?: unknown;
  title?: unknown;
  url?: unknown;
  updatedAt?: unknown;
  author?: { login?: unknown };
  comments?: { totalCount?: unknown };
  labels?: { nodes?: unknown };
  repository?: { nameWithOwner?: unknown; isArchived?: unknown };
}

function toItem(node: GhSearchNode, detail: string | null): BoardItem {
  const labelNodes = node.labels?.nodes;
  const labels = Array.isArray(labelNodes)
    ? labelNodes
        .map((label) => (label as { name?: unknown }).name)
        .filter((name): name is string => typeof name === "string")
    : [];
  const comments = node.comments?.totalCount;
  return {
    id: typeof node.id === "string" ? node.id : String(node.url),
    number: typeof node.number === "number" ? node.number : 0,
    title: typeof node.title === "string" ? node.title : "",
    url: typeof node.url === "string" ? node.url : "",
    repository:
      typeof node.repository?.nameWithOwner === "string" ? node.repository.nameWithOwner : "",
    updatedAt: typeof node.updatedAt === "string" ? node.updatedAt : "",
    commentsCount: typeof comments === "number" ? comments : 0,
    labels,
    // Null rather than empty for a deleted account, which GitHub returns as no
    // author at all; the card shows nothing instead of an authorless byline.
    author: typeof node.author?.login === "string" ? node.author.login : null,
    detail,
    // Only pull requests link issues; every other caller keeps the empty list.
    linkedIssues: [],
    // Filled for open pull requests only, by fetchChecks; see attachChecks.
    checks: null,
  };
}

/**
 * An archived repository is read-only, so its open issues and pull requests can
 * never be closed and sit on the board forever. The qualifier filters them out
 * server-side; discussions have no such qualifier and are filtered on the
 * response.
 */
const UNARCHIVED_ONLY = "archived:false";

/**
 * Every column is two searches: what this login authored, anywhere, and
 * everything in the repositories this login owns, whoever opened it. The second
 * is what puts other people's work on the board — an issue someone files on
 * your own repository is yours to answer even though you did not write it.
 *
 * They cannot be one query. GitHub search ANDs its qualifiers, so
 * `author:x user:x` is "authored by x, in x's repositories" — narrower than
 * either half, not their union. Two aliased searches are still one request,
 * which is what keeps a refresh at three subprocesses rather than six.
 */
function dualSearchQuery(type: "ISSUE" | "DISCUSSION", selection: string): string {
  return `query($mine: String!, $owned: String!, $limit: Int!) {
  mine: search(query: $mine, type: ${type}, first: $limit) { nodes { ${selection} } }
  owned: search(query: $owned, type: ${type}, first: $limit) { nodes { ${selection} } }
}`;
}

function nodesOf(result: unknown): unknown[] {
  const nodes = (result as { nodes?: unknown } | undefined)?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}

/**
 * Runs both halves in one request and returns their nodes back to back. They
 * overlap wherever the login authored something on a repository it owns, which
 * is what `mergeItems` deduplicates.
 */
async function dualSearch(
  query: string,
  mine: string,
  owned: string,
  limit: number,
): Promise<unknown[]> {
  const raw = await gh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `mine=${mine}`,
    "-f",
    `owned=${owned}`,
    "-F",
    `limit=${limit}`,
  ]);
  const parsed: unknown = JSON.parse(raw);
  const data = (parsed as { data?: Record<string, unknown> }).data;
  return [...nodesOf(data?.mine), ...nodesOf(data?.owned)];
}

/**
 * The two searches overlap on everything the login authored in its own
 * repositories, so the union is deduplicated by node id. Each half is sorted
 * only within itself, hence the re-sort; and each half was allowed `limit`
 * rows, so the merged column is cut back to the one budget it was asked for.
 */
function mergeItems(items: readonly BoardItem[], limit: number): BoardItem[] {
  const byId = new Map<string, BoardItem>();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

const ISSUE_SELECTION = `... on Issue {
  id
  number
  title
  url
  updatedAt
  author { login }
  comments { totalCount }
  labels(first: 20) { nodes { name } }
  repository { nameWithOwner isArchived }
}`;

/**
 * `type: ISSUE` covers issues and pull requests both, so the search itself has
 * to say `is:issue` — the inline fragment alone would leave every pull request
 * in the response as an empty node.
 */
const ISSUE_QUERY = dualSearchQuery("ISSUE", ISSUE_SELECTION);

async function fetchIssues(login: string, limit: number): Promise<BoardItem[]> {
  const scope = `is:issue state:open ${UNARCHIVED_ONLY} sort:updated-desc`;
  const nodes = await dualSearch(
    ISSUE_QUERY,
    `${scope} author:${login}`,
    `${scope} user:${login}`,
    limit,
  );
  const items = nodes
    .filter((node): node is GhSearchNode => typeof node === "object" && node !== null)
    .filter((node) => typeof node.id === "string")
    .map((node) => toItem(node, null));
  return mergeItems(items, limit);
}

/**
 * Pull requests carry `closingIssuesReferences` — the link from a pull request
 * to the issues it closes, and the only source that sees both closing keywords
 * in the body and issues attached by hand from the Development panel. The board
 * needs it to fold an issue into the pull request that closes it.
 */
const PULL_REQUEST_SELECTION = `... on PullRequest {
  id
  number
  title
  url
  updatedAt
  isDraft
  author { login }
  comments { totalCount }
  labels(first: 20) { nodes { name } }
  repository { nameWithOwner isArchived }
  closingIssuesReferences(first: 20) {
    nodes { id number repository { nameWithOwner } }
  }
}`;

const PULL_REQUEST_QUERY = dualSearchQuery("ISSUE", PULL_REQUEST_SELECTION);

interface GhPullRequestNode extends GhSearchNode {
  isDraft?: unknown;
  closingIssuesReferences?: { nodes?: unknown };
}

function toLinkedIssues(node: GhPullRequestNode): LinkedIssue[] {
  const nodes = node.closingIssuesReferences?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((issue): issue is Record<string, unknown> => typeof issue === "object" && issue !== null)
    .map((issue) => ({
      id: typeof issue.id === "string" ? issue.id : "",
      number: typeof issue.number === "number" ? issue.number : 0,
      repository:
        typeof (issue.repository as { nameWithOwner?: unknown } | undefined)?.nameWithOwner ===
        "string"
          ? ((issue.repository as { nameWithOwner: string }).nameWithOwner)
          : "",
    }))
    .filter((issue) => issue.id !== "");
}

/**
 * The checks on each pull request's head commit, by node id.
 *
 * A **separate request** from the search, deliberately. A token without the
 * Checks permission — a fine-grained PAT, typically — answers
 * `statusCheckRollup` with "Resource not accessible", and `gh api graphql`
 * treats any GraphQL error as a failed command. Asking for it inside the search
 * would turn that into a blank Draft PRs *and* Open PRs column; asking for it
 * separately costs pills nobody could have seen anyway.
 *
 * `nodes(ids:)` takes at most 100 ids, which the caller cannot exceed: it asks
 * only for the open pull requests, and the merged list was already cut to
 * `limit`, whose own ceiling is 100.
 */
const CHECKS_QUERY = `query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on PullRequest {
      id
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun {
                    name
                    status
                    conclusion
                    startedAt
                    completedAt
                    checkSuite { workflowRun { databaseId } }
                  }
                  ... on StatusContext {
                    context
                    state
                    createdAt
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

/**
 * Where one check lands in the summary. `ignored` is the fourth outcome that is
 * neither a result nor a wait — a skipped or cancelled run says nothing about
 * whether the pull request is healthy, so it is counted nowhere, exactly as
 * Paseo's own checks summary drops it.
 */
type CheckOutcome = "passed" | "failed" | "pending" | "ignored";

/**
 * Mirrors Paseo's `mapCheckRunStatus` so the board and the sidebar cannot
 * disagree about the same pull request, with one deliberate difference:
 * `STARTUP_FAILURE` and `STALE` are terminal, so reporting them as `pending`
 * would show a run still going that will never report again.
 */
function checkRunOutcome(status: unknown, conclusion: unknown): CheckOutcome {
  if (status !== "COMPLETED") return "pending";
  switch (conclusion) {
    case "SUCCESS":
      return "passed";
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "failed";
    case "CANCELLED":
    case "SKIPPED":
    case "NEUTRAL":
    case "STALE":
      return "ignored";
    default:
      return "pending";
  }
}

/** The commit-status half of the rollup, which has states rather than conclusions. */
function statusContextOutcome(state: unknown): CheckOutcome {
  switch (state) {
    case "SUCCESS":
      return "passed";
    case "FAILURE":
    case "ERROR":
      return "failed";
    default:
      return "pending";
  }
}

function parseTime(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

interface CountedCheck {
  name: string;
  outcome: CheckOutcome;
  /** Higher wins when the same name appears twice; see `foldChecks`. */
  recency: number;
}

function toCountedCheck(node: Record<string, unknown>): CountedCheck | null {
  if (node.__typename === "CheckRun") {
    const workflowRunId = (
      node.checkSuite as { workflowRun?: { databaseId?: unknown } } | undefined
    )?.workflowRun?.databaseId;
    return {
      name: typeof node.name === "string" ? node.name : "",
      outcome: checkRunOutcome(node.status, node.conclusion),
      // A re-run gets a higher run id than the run it replaced, so the id
      // orders attempts even before either of them has a timestamp.
      recency:
        typeof workflowRunId === "number"
          ? workflowRunId
          : parseTime(node.completedAt ?? node.startedAt),
    };
  }
  if (node.__typename === "StatusContext") {
    return {
      name: typeof node.context === "string" ? node.context : "",
      outcome: statusContextOutcome(node.state),
      recency: parseTime(node.createdAt),
    };
  }
  // A rollup entry of some type this query did not ask for.
  return null;
}

/**
 * Folds one commit's rollup into the three counts a card shows.
 *
 * Deduplicated by check name, keeping the most recent: a re-run leaves the
 * attempt it replaced in the rollup, and counting both would report a check
 * that failed and then passed as one of each.
 *
 * Null rather than three zeroes when nothing reported at all, so "no CI here"
 * and "every check was skipped" both render as no pills instead of as an empty
 * summary.
 */
function foldChecks(nodes: readonly unknown[]): CheckSummary | null {
  const latest = new Map<string, CountedCheck>();
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    const check = toCountedCheck(node as Record<string, unknown>);
    if (check === null) continue;
    const existing = latest.get(check.name);
    if (existing === undefined || check.recency >= existing.recency) latest.set(check.name, check);
  }
  if (latest.size === 0) return null;

  const summary = { passed: 0, failed: 0, pending: 0 };
  for (const check of latest.values()) {
    if (check.outcome === "passed") summary.passed += 1;
    else if (check.outcome === "failed") summary.failed += 1;
    else if (check.outcome === "pending") summary.pending += 1;
  }
  return summary.passed + summary.failed + summary.pending === 0 ? null : summary;
}

function rollupContexts(node: unknown): unknown[] {
  const commits = (node as { commits?: { nodes?: unknown } } | undefined)?.commits?.nodes;
  if (!Array.isArray(commits)) return [];
  // `commits(last: 1)` is the head commit, which is the only one whose checks
  // describe the pull request as it stands.
  const commit = (commits[0] as { commit?: unknown } | undefined)?.commit;
  const contexts = (
    commit as { statusCheckRollup?: { contexts?: { nodes?: unknown } } } | undefined
  )?.statusCheckRollup?.contexts?.nodes;
  return Array.isArray(contexts) ? contexts : [];
}

async function fetchChecks(ids: readonly string[]): Promise<Map<string, CheckSummary>> {
  const raw = await gh([
    "api",
    "graphql",
    "-f",
    `query=${CHECKS_QUERY}`,
    // gh spells a list variable as a repeated `name[]=` field.
    ...ids.flatMap((id) => ["-f", `ids[]=${id}`]),
  ]);
  const parsed: unknown = JSON.parse(raw);
  const nodes = (parsed as { data?: { nodes?: unknown } }).data?.nodes;
  const summaries = new Map<string, CheckSummary>();
  if (!Array.isArray(nodes)) return summaries;
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    const id = (node as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    const summary = foldChecks(rollupContexts(node));
    if (summary !== null) summaries.set(id, summary);
  }
  return summaries;
}

/**
 * Checks are a second round trip, so a failure here must cost the pills and
 * nothing else — the pull requests themselves already loaded. The reason is
 * written to the plugin log rather than dropped, because a permanently
 * pill-less board with no explanation is the one outcome worse than no pills.
 */
async function attachChecks(items: readonly BoardItem[]): Promise<BoardItem[]> {
  const ids = items.map((item) => item.id).filter((id) => id !== "");
  if (ids.length === 0) return [...items];
  let summaries: Map<string, CheckSummary>;
  try {
    summaries = await fetchChecks(ids);
  } catch (error) {
    console.warn(
      `[github-board] pull request checks unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [...items];
  }
  return items.map((item) => ({ ...item, checks: summaries.get(item.id) ?? null }));
}

/**
 * One search backs two columns. Splitting client-side would ship draft pull
 * requests the open column discards, so the split happens here — after the
 * merge, so the `limit` is spent on the pull requests that exist rather than on
 * one column's share of them.
 */
async function fetchPullRequests(
  login: string,
  limit: number,
): Promise<{ draft: BoardItem[]; open: BoardItem[] }> {
  const scope = `is:pr state:open ${UNARCHIVED_ONLY} sort:updated-desc`;
  const nodes = await dualSearch(
    PULL_REQUEST_QUERY,
    `${scope} author:${login}`,
    `${scope} user:${login}`,
    limit,
  );

  const drafts = new Set<string>();
  const items: BoardItem[] = [];
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    const row = node as GhPullRequestNode;
    // The search returns issues and pull requests under one type; a node that
    // matched neither inline fragment comes back as an empty object.
    if (typeof row.id !== "string") continue;
    if (row.isDraft === true) drafts.add(row.id);
    items.push({ ...toItem(row, null), linkedIssues: toLinkedIssues(row) });
  }

  const merged = mergeItems(items, limit);
  // Checks are fetched for the open column alone: a draft says its work is not
  // finished, so its CI is nobody's business yet, and asking for fewer ids
  // keeps the extra request as small as the thing it feeds.
  return {
    draft: merged.filter((item) => drafts.has(item.id)),
    open: await attachChecks(merged.filter((item) => !drafts.has(item.id))),
  };
}

const DISCUSSION_SELECTION = `... on Discussion {
  id
  number
  title
  url
  updatedAt
  author { login }
  category { name }
  comments { totalCount }
  repository { nameWithOwner isArchived }
}`;

const DISCUSSION_QUERY = dualSearchQuery("DISCUSSION", DISCUSSION_SELECTION);

interface GhDiscussionNode extends GhSearchNode {
  category?: { name?: unknown };
}

/**
 * GitHub's discussion search accepts `author:` and `user:` but ignores
 * `involves:` and `commenter:`, so this column is what the login wrote plus
 * whatever is being discussed on its own repositories — never a thread it only
 * replied to elsewhere.
 */
async function fetchDiscussions(login: string, limit: number): Promise<BoardItem[]> {
  const nodes = await dualSearch(
    DISCUSSION_QUERY,
    `author:${login} sort:updated-desc`,
    `user:${login} sort:updated-desc`,
    limit,
  );
  const items = nodes
    .filter((node): node is GhDiscussionNode => typeof node === "object" && node !== null)
    .filter((node) => typeof node.id === "string")
    .filter((node) => node.repository?.isArchived !== true)
    .map((node) => toItem(node, typeof node.category?.name === "string" ? node.category.name : null));
  return mergeItems(items, limit);
}

/**
 * A board costs three `gh` subprocesses and a round trip to GitHub, so one is
 * reused for a short window — the surface remounts on every workspace switch
 * and should not pay that each time. The Refresh button sends `force`.
 *
 * `hiddenRepositories` is deliberately not part of the cached value: settings
 * are read on every load, because a client that saved a new filter and then
 * remounted would otherwise be handed the filter this board was built with.
 */
interface CachedBoard {
  /** Login and limit both change the query, so both are part of the key. */
  key: string;
  columns: BoardColumn[];
  fetchedAt: string;
  storedAt: number;
}

const BOARD_TTL_MS = 5 * 60_000;

let cachedBoard: CachedBoard | null = null;

/**
 * The project each repository on the board belongs to, keyed the way a card
 * spells its repository so the surface needs no host parsing to look one up.
 *
 * A board carrying the same `owner/name` from two different forges would
 * collapse to one entry; the send button is unaffected, because it resolves
 * from the card's own URL rather than from this map.
 */
async function describeProjects(
  paseo: PaseoApi,
  columns: readonly BoardColumn[],
): Promise<{ projects: { id: string; name: string }[]; repositoryProjects: Record<string, string> }> {
  const index = await loadProjectIndex(paseo);

  const repositoryProjects: Record<string, string> = {};
  for (const column of columns) {
    for (const item of column.items) {
      if (item.repository === "" || repositoryProjects[item.repository] !== undefined) continue;
      const repositoryId = repositoryIdFor(item.repository, item.url);
      if (repositoryId === null) continue;
      const project = index.byRepositoryId.get(repositoryId);
      if (project !== undefined) repositoryProjects[item.repository] = project.projectId;
    }
  }

  return {
    projects: index.projects.map((project) => ({
      id: project.projectId,
      name: project.displayName,
    })),
    repositoryProjects,
  };
}

async function settle(
  id: BoardColumn["id"],
  title: string,
  load: () => Promise<BoardItem[]>,
): Promise<BoardColumn> {
  try {
    return { id, title, items: await load(), error: null };
  } catch (error) {
    return { id, title, items: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadBoardHandler(
  { login, limit, force }: z.output<typeof loadBoard.input>,
  { paseo }: PluginHandlerContext,
): Promise<z.input<typeof loadBoard.output>> {
  const requested = login?.trim();
  const settings = await readSettings();
  const resolved =
    requested !== undefined && requested !== "" && requested !== "@me"
      ? requested
      : (settings.login ?? (await resolveViewerLogin()));

  const key = `${resolved}\u0000${limit}`;
  if (
    !force &&
    cachedBoard !== null &&
    cachedBoard.key === key &&
    Date.now() - cachedBoard.storedAt < BOARD_TTL_MS
  ) {
    return {
      login: resolved,
      hiddenRepositories: settings.hiddenRepositories,
      prompts: settings.prompts,
      ...(await describeProjects(paseo, cachedBoard.columns)),
      columns: cachedBoard.columns,
      fetchedAt: cachedBoard.fetchedAt,
    };
  }

  // Both pull request columns share one request, so they settle together.
  const pullRequests = fetchPullRequests(resolved, limit).then(
    (split) => ({ split, error: null as string | null }),
    (error: unknown) => ({
      split: { draft: [] as BoardItem[], open: [] as BoardItem[] },
      error: error instanceof Error ? error.message : String(error),
    }),
  );

  const [issues, prs, discussions] = await Promise.all([
    settle("issues", "Issues", () => fetchIssues(resolved, limit)),
    pullRequests,
    settle("discussions", "Discussions", () => fetchDiscussions(resolved, limit)),
  ]);

  const columns: BoardColumn[] = [
    issues,
    { id: "draft-prs", title: "Draft PRs", items: prs.split.draft, error: prs.error },
    { id: "open-prs", title: "Open PRs", items: prs.split.open, error: prs.error },
    discussions,
  ];
  const fetchedAt = new Date().toISOString();

  // A column that failed is not worth remembering: caching it would keep the
  // error on screen for the whole window even though a retry might succeed.
  if (columns.every((column) => column.error === null)) {
    cachedBoard = { key, columns, fetchedAt, storedAt: Date.now() };
  }

  return {
    login: resolved,
    hiddenRepositories: settings.hiddenRepositories,
    prompts: settings.prompts,
    ...(await describeProjects(paseo, columns)),
    columns,
    fetchedAt,
  };
}

export async function savePromptsHandler(
  prompts: z.output<typeof savePrompts.input>,
): Promise<z.input<typeof savePrompts.output>> {
  // Round-tripped through the same reader the settings file goes through, so
  // saving a cleared field and reloading it produce the same value.
  const saved = await updateSettings({ prompts: readPrompts(prompts) });
  return saved.prompts;
}

export async function saveLoginHandler({
  login,
}: z.output<typeof saveLogin.input>): Promise<z.input<typeof saveLogin.output>> {
  const trimmed = login.trim();
  const resolved = trimmed === "" || trimmed === "@me" ? await resolveViewerLogin() : trimmed;
  await updateSettings({ login: resolved });
  return { login: resolved };
}

export async function saveRepositoryFilterHandler({
  hiddenRepositories,
}: z.output<typeof saveRepositoryFilter.input>): Promise<
  z.input<typeof saveRepositoryFilter.output>
> {
  const saved = await updateSettings({ hiddenRepositories: [...hiddenRepositories].sort() });
  return { hiddenRepositories: saved.hiddenRepositories };
}

/**
 * The labels a repository defines, cached the way the board is: a label set
 * changes far more slowly than the work it is put on, and the menu is opened
 * card by card on repositories the user keeps returning to.
 */
interface CachedLabels {
  labels: RepositoryLabel[];
  storedAt: number;
}

const LABELS_TTL_MS = 5 * 60_000;

const cachedLabels = new Map<string, CachedLabels>();

/**
 * First 100 by name, which is every label on all but a deliberately elaborate
 * repository. Paging past that would mean a cursor loop for a menu nobody can
 * read anyway; a label past the hundredth is edited on GitHub.
 */
const LABELS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    labels(first: 100, orderBy: { field: NAME, direction: ASC }) {
      nodes { id name color description }
    }
  }
}`;

/** `owner/name` as every card spells it, and the only form these handlers take. */
function splitRepository(repository: string): { owner: string; name: string } {
  const [owner, name, ...rest] = repository.split("/");
  if (owner === undefined || owner === "" || name === undefined || name === "" || rest.length > 0) {
    throw new Error(`"${repository}" is not an owner/name repository.`);
  }
  return { owner, name };
}

async function fetchRepositoryLabels(repository: string): Promise<RepositoryLabel[]> {
  const { owner, name } = splitRepository(repository);
  const raw = await gh([
    "api",
    "graphql",
    "-f",
    `query=${LABELS_QUERY}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
  ]);
  const parsed: unknown = JSON.parse(raw);
  const nodes = (parsed as { data?: { repository?: { labels?: { nodes?: unknown } } } }).data
    ?.repository?.labels?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((node): node is Record<string, unknown> => typeof node === "object" && node !== null)
    .map((node) => ({
      id: typeof node.id === "string" ? node.id : "",
      name: typeof node.name === "string" ? node.name : "",
      color: typeof node.color === "string" ? node.color : "",
      description:
        typeof node.description === "string" && node.description !== "" ? node.description : null,
    }))
    .filter((label) => label.id !== "" && label.name !== "");
}

export async function listLabelsHandler({
  repository,
}: z.output<typeof listLabels.input>): Promise<z.input<typeof listLabels.output>> {
  const hit = cachedLabels.get(repository);
  if (hit !== undefined && Date.now() - hit.storedAt < LABELS_TTL_MS) return { labels: hit.labels };

  const labels = await fetchRepositoryLabels(repository);
  cachedLabels.set(repository, { labels, storedAt: Date.now() });
  return { labels };
}

/**
 * Both mutations answer with the labelable they changed, so the item's new
 * labels come back in the same round trip that set them — no read-after-write,
 * and no window where the card and GitHub disagree.
 *
 * `Labelable` is an interface, so the labels have to be selected through an
 * inline fragment per concrete type; issues and pull requests are the two the
 * board offers this on.
 */
const LABELABLE_SELECTION = `labelable {
      ... on Issue { labels(first: 20) { nodes { name } } }
      ... on PullRequest { labels(first: 20) { nodes { name } } }
    }`;

const ADD_LABEL_MUTATION = `mutation($item: ID!, $label: ID!) {
  addLabelsToLabelable(input: { labelableId: $item, labelIds: [$label] }) {
    ${LABELABLE_SELECTION}
  }
}`;

const REMOVE_LABEL_MUTATION = `mutation($item: ID!, $label: ID!) {
  removeLabelsFromLabelable(input: { labelableId: $item, labelIds: [$label] }) {
    ${LABELABLE_SELECTION}
  }
}`;

function labelNamesOf(result: unknown): string[] {
  const nodes = (
    result as { labelable?: { labels?: { nodes?: unknown } } } | undefined
  )?.labelable?.labels?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((node) => (node as { name?: unknown }).name)
    .filter((name): name is string => typeof name === "string");
}

/**
 * Keeps the cached board honest. Without this a label edited now would be
 * undone on screen by the next cache hit — the board is remembered for five
 * minutes, and a surface remounts on every workspace switch.
 */
function patchCachedLabels(itemId: string, labels: readonly string[]): void {
  if (cachedBoard === null) return;
  cachedBoard = {
    ...cachedBoard,
    columns: cachedBoard.columns.map((column) => ({
      ...column,
      items: column.items.map((item) => (item.id === itemId ? { ...item, labels: [...labels] } : item)),
    })),
  };
}

export async function toggleLabelHandler({
  itemId,
  labelId,
  add,
}: z.output<typeof toggleLabel.input>): Promise<z.input<typeof toggleLabel.output>> {
  const raw = await gh([
    "api",
    "graphql",
    "-f",
    `query=${add ? ADD_LABEL_MUTATION : REMOVE_LABEL_MUTATION}`,
    "-f",
    `item=${itemId}`,
    "-f",
    `label=${labelId}`,
  ]);
  const parsed: unknown = JSON.parse(raw);
  const data = (parsed as { data?: Record<string, unknown> }).data;
  const labels = labelNamesOf(add ? data?.addLabelsToLabelable : data?.removeLabelsFromLabelable);
  patchCachedLabels(itemId, labels);
  return { labels };
}

/**
 * The host API a handler is given. Every project lookup below needs it, so it
 * is threaded down from the handler rather than reached for globally.
 */
type PaseoApi = PluginHandlerContext["paseo"];

/**
 * Paseo's own project registry, as the daemon reports it. Only the fields this
 * plugin matches on are named; the descriptor carries more.
 *
 * A project with a git remote is keyed `remote:<host>/<owner>/<name>`, always
 * lowercased, which is exactly the identity a board card carries — so a card is
 * matched to a project by that key rather than by guessing at directory names.
 * A project without a remote is keyed `host:<serverId>:<path>` and can never
 * match, which is correct: the board only ever shows remote repositories. The
 * key is optional on the wire, and a project missing one simply matches
 * nothing by key — its git remotes still get their turn.
 */
interface ProjectRecord {
  projectId: string;
  rootPath: string;
  displayName: string;
  projectKey: string;
  /**
   * `git`, `non_git`, or `directory`, as the daemon records it. Paseo offers a
   * worktree for exactly the git ones (`workspace-structure.ts`), so this is
   * what decides whether the launch dialog can offer one.
   */
  kind: string;
}

/**
 * Every project Paseo knows about, asked of the daemon rather than read off
 * disk. `projects.list` is the daemon's own view: it covers projects that have
 * no workspace open, it drops archived ones for us, and its display name is the
 * one the user renamed the project to — none of which reading `projects.json`
 * gave us. Requested without a `sync` cursor, so the answer is always the whole
 * list rather than a diff against a cursor this plugin does not keep.
 */
async function readProjects(paseo: PaseoApi): Promise<ProjectRecord[]> {
  const { projects } = await paseo.projects.list();
  return projects.map((project) => ({
    projectId: project.projectId,
    rootPath: project.projectRootPath,
    displayName: project.projectDisplayName,
    projectKey: project.projectKey ?? "",
    kind: project.projectKind,
  }));
}

/**
 * A repository's identity as both a project key and a git remote spell it:
 * `<host>/<owner>/<name>`, lowercased. The host comes from the item's own URL
 * rather than a hardcoded `github.com`, so a GitHub Enterprise card matches the
 * enterprise project and not a same-named repository on github.com.
 */
function repositoryIdFor(repository: string, url: string): string | null {
  if (!repository.includes("/")) return null;
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  if (host === "") return null;
  return `${host}/${repository}`.toLowerCase();
}

/**
 * Normalises any git remote URL to the same `<host>/<owner>/<name>` form,
 * covering the scp-like `git@host:owner/name.git` that `new URL` cannot parse
 * alongside the `https://` and `ssh://` spellings.
 */
function normalizeRemoteUrl(remote: string): string | null {
  const trimmed = remote.trim();
  if (trimmed === "") return null;

  let host: string;
  let path: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      host = parsed.host;
      path = parsed.pathname;
    } catch {
      return null;
    }
  } else {
    const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(trimmed);
    if (scp === null || scp[1] === undefined || scp[2] === undefined) return null;
    host = scp[1];
    path = scp[2];
  }

  const name = path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  if (host === "" || name === "") return null;
  return `${host}/${name}`.toLowerCase();
}

/**
 * Every repository the checkout at `root` points at, not just `origin`. A fork
 * conventionally keeps the repository it was forked from as `upstream`, and a
 * card always names the repository the issue or pull request lives in — the
 * parent — so `origin` alone cannot match work done from a fork.
 *
 * A directory that is not a git checkout, or has gone missing, contributes
 * nothing rather than failing the search for every other project.
 */
async function gitRemotes(root: string): Promise<string[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("git", ["-C", root, "remote", "-v"], {
      maxBuffer: MAX_OUTPUT_BYTES,
    }));
  } catch {
    return [];
  }
  const seen = new Set<string>();
  for (const line of stdout.split("\n")) {
    const url = line.trim().split(/\s+/)[1];
    if (url === undefined) continue;
    const normalized = normalizeRemoteUrl(url);
    if (normalized !== null) seen.add(normalized);
  }
  return [...seen];
}

/**
 * Every live project, and every repository id that reaches one. Built once and
 * shared by the board (which labels each card's project) and by the send button
 * (which needs the project's directory), so the `git` subprocess per project is
 * paid once rather than per lookup.
 */
interface ProjectIndex {
  projects: ProjectRecord[];
  /** `<host>/<owner>/<name>` to the project it belongs to. */
  byRepositoryId: Map<string, ProjectRecord>;
}

const PROJECT_INDEX_TTL_MS = 5 * 60_000;

let cachedProjectIndex: { index: ProjectIndex; storedAt: number } | null = null;

async function buildProjectIndex(paseo: PaseoApi): Promise<ProjectIndex> {
  const projects = await readProjects(paseo);
  const byRepositoryId = new Map<string, ProjectRecord>();

  // `projectKey` first, across all projects, because it is the repository Paseo
  // itself considers a project's home. Only then the other remotes, and only
  // where nothing has claimed the id — so a repository that is one project's
  // origin and another's upstream resolves to the one it belongs to.
  for (const project of projects) {
    const key = project.projectKey.toLowerCase();
    if (!key.startsWith("remote:")) continue;
    const repositoryId = key.slice("remote:".length);
    if (!byRepositoryId.has(repositoryId)) byRepositoryId.set(repositoryId, project);
  }

  const scanned = await Promise.all(
    projects.map(async (project) => ({ project, remotes: await gitRemotes(project.rootPath) })),
  );
  for (const { project, remotes } of scanned) {
    for (const repositoryId of remotes) {
      if (!byRepositoryId.has(repositoryId)) byRepositoryId.set(repositoryId, project);
    }
  }

  return { projects, byRepositoryId };
}

async function loadProjectIndex(paseo: PaseoApi, force = false): Promise<ProjectIndex> {
  if (
    !force &&
    cachedProjectIndex !== null &&
    Date.now() - cachedProjectIndex.storedAt < PROJECT_INDEX_TTL_MS
  ) {
    return cachedProjectIndex.index;
  }
  const index = await buildProjectIndex(paseo);
  cachedProjectIndex = { index, storedAt: Date.now() };
  return index;
}

/**
 * A miss is retried against a freshly built index, so a project added moments
 * ago is found instead of being denied for the rest of the cache window.
 */
async function findProject(
  paseo: PaseoApi,
  repositoryId: string,
): Promise<ProjectRecord | undefined> {
  const cached = await loadProjectIndex(paseo);
  const hit = cached.byRepositoryId.get(repositoryId);
  if (hit !== undefined) return hit;
  const fresh = await loadProjectIndex(paseo, true);
  return fresh.byRepositoryId.get(repositoryId);
}

/** Workspace titles are capped at the same length the daemon caps agent titles. */
const MAX_TITLE_CHARS = 200;

/**
 * The project one card can be sent to, or a refusal that says what to do about
 * it. Both handlers below start here, so "no project" reads the same whether
 * the dialog is opening or the send is running.
 */
async function requireProject(
  paseo: PaseoApi,
  repository: string,
  url: string,
): Promise<ProjectRecord> {
  const repositoryId = repositoryIdFor(repository, url);
  if (repositoryId === null) {
    throw new Error(`${repository} has no repository URL to match a project against.`);
  }

  const project = await findProject(paseo, repositoryId);
  if (project === undefined) {
    throw new Error(
      `No Paseo project has a git remote pointing at ${repository}. Add it as a project — or add it as a remote on the fork you already have — then send this card again.`,
    );
  }
  return project;
}

export async function sendOptionsHandler(
  { repository, url }: z.output<typeof sendOptions.input>,
  { paseo }: PluginHandlerContext,
): Promise<z.input<typeof sendOptions.output>> {
  const [project, settings] = await Promise.all([
    requireProject(paseo, repository, url),
    readSettings(),
  ]);
  const supportsWorktree = project.kind === "git";
  return {
    project: {
      id: project.projectId,
      name: project.displayName,
      rootPath: project.rootPath,
      supportsWorktree,
    },
    // A worktree preference saved against a git project must not survive into a
    // project that has no worktrees to offer, or the dialog opens on a choice
    // its own picker cannot show.
    defaults: supportsWorktree ? settings.launch : { ...settings.launch, isolation: "local" },
  };
}

export async function sendToChatHandler(
  {
    repository,
    number,
    title,
    url,
    prompt,
    isolation,
    provider,
    model,
    modeId,
    thinkingOptionId,
  }: z.output<typeof sendToChat.input>,
  { paseo }: PluginHandlerContext,
): Promise<z.input<typeof sendToChat.output>> {
  const project = await requireProject(paseo, repository, url);
  if (isolation === "worktree" && project.kind !== "git") {
    throw new Error(`${project.displayName} is not a git checkout, so it cannot be worktreed.`);
  }

  const trimmed = title.trim();
  /**
   * `firstAgentContext` is passed here and *only* here, because this handler
   * really does create the agent it promises. The daemon reads it two ways: as
   * naming context for the workspace and its branch, and as `expectsInitialAgent`,
   * which flips the new workspace to an optimistic `running`. A caller that
   * passes it and then creates nothing leaves a workspace spinning until it
   * settles on `done`.
   */
  const workspace = await paseo.workspaces.create({
    title: (trimmed === "" ? `${repository} #${number}` : trimmed).slice(0, MAX_TITLE_CHARS),
    firstAgentContext: { prompt, attachments: [] },
    source:
      isolation === "worktree"
        ? {
            // No `worktreeSlug`: the daemon mints a mnemonic one, and then
            // renames the branch after the prompt once the agent is running.
            kind: "worktree",
            cwd: project.rootPath,
            projectId: project.projectId,
          }
        : { kind: "directory", path: project.rootPath, projectId: project.projectId },
  });

  /**
   * The agent is created *in* the workspace, so the SDK places it on the
   * workspace's own directory — the worktree's path, not the project root, when
   * one was cut. `prompt` rides along as the first message rather than being
   * sent afterwards, so there is no window where the workspace exists with a
   * silent agent in it.
   */
  const agent = await workspace.agents
    .create({
      config: {
        // `provider/model`, which is the only spelling the SDK accepts.
        provider: `${provider}/${model}`,
        ...(modeId === null ? {} : { modeId }),
        ...(thinkingOptionId === null ? {} : { thinkingOptionId }),
      },
      prompt,
    })
    .catch((cause: unknown) => {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `Workspace “${workspace.name ?? project.displayName}” was created, but the agent could not be started: ${detail}`,
      );
    });

  // Saved only once the send has actually worked, so a configuration that the
  // host rejected is not what the next card opens on.
  await updateSettings({ launch: { provider, model, modeId, thinkingOptionId, isolation } });

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name ?? project.displayName,
    projectName: project.displayName,
    agentId: agent.id,
  };
}
