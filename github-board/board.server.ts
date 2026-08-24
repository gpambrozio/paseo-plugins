import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { z } from "zod";
import type {
  BoardColumn,
  BoardItem,
  loadBoard,
  saveLogin,
  saveRepositoryFilter,
} from "./board.shared";

const execFileAsync = promisify(execFile);

/** gh search caps out well under this; the ceiling only guards a runaway page. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function settingsPath(): string {
  const home = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
  return join(home, "plugins", "github-board", "settings.json");
}

interface Settings {
  /** Null until the user pins one; the caller falls back to the gh viewer. */
  login: string | null;
  /** Repositories the board hides, saved as the filter's complement. */
  hiddenRepositories: string[];
}

const EMPTY_SETTINGS: Settings = { login: null, hiddenRepositories: [] };

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
    };
  } catch {
    // No settings yet, or a file we can no longer parse. Either way the caller
    // falls back to the authenticated viewer, which always resolves.
    return EMPTY_SETTINGS;
  }
}

/**
 * Read-modify-write, because the login and the repository filter are saved by
 * separate handlers and a whole-file write from either would drop the other.
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

interface GhSearchRow {
  id?: unknown;
  number?: unknown;
  title?: unknown;
  url?: unknown;
  updatedAt?: unknown;
  commentsCount?: unknown;
  isDraft?: unknown;
  labels?: unknown;
  repository?: { nameWithOwner?: unknown; isArchived?: unknown };
}

function toItem(row: GhSearchRow, detail: string | null): BoardItem {
  const labels = Array.isArray(row.labels)
    ? row.labels
        .map((label) => (label as { name?: unknown }).name)
        .filter((name): name is string => typeof name === "string")
    : [];
  return {
    id: typeof row.id === "string" ? row.id : String(row.url),
    number: typeof row.number === "number" ? row.number : 0,
    title: typeof row.title === "string" ? row.title : "",
    url: typeof row.url === "string" ? row.url : "",
    repository: typeof row.repository?.nameWithOwner === "string" ? row.repository.nameWithOwner : "",
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
    commentsCount: typeof row.commentsCount === "number" ? row.commentsCount : 0,
    labels,
    detail,
  };
}

const SEARCH_FIELDS = "id,number,title,repository,url,updatedAt,commentsCount,labels";

/**
 * An archived repository is read-only, so its open issues and pull requests can
 * never be closed and sit on the board forever. `gh search` filters them out
 * server-side; discussions have no such flag and are filtered on the response.
 */
const UNARCHIVED_ONLY = "--archived=false";

async function fetchIssues(login: string, limit: number): Promise<BoardItem[]> {
  const raw = await gh([
    "search",
    "issues",
    "--author",
    login,
    "--state",
    "open",
    UNARCHIVED_ONLY,
    "--sort",
    "updated",
    "--order",
    "desc",
    "--limit",
    String(limit),
    "--json",
    SEARCH_FIELDS,
  ]);
  const rows: GhSearchRow[] = JSON.parse(raw);
  return rows.map((row) => toItem(row, null));
}

/**
 * One search backs two columns. Splitting client-side would ship draft pull
 * requests the open column discards, so the split happens here.
 */
async function fetchPullRequests(
  login: string,
  limit: number,
): Promise<{ draft: BoardItem[]; open: BoardItem[] }> {
  const raw = await gh([
    "search",
    "prs",
    "--author",
    login,
    "--state",
    "open",
    UNARCHIVED_ONLY,
    "--sort",
    "updated",
    "--order",
    "desc",
    "--limit",
    String(limit),
    "--json",
    `${SEARCH_FIELDS},isDraft`,
  ]);
  const rows: GhSearchRow[] = JSON.parse(raw);
  const draft: BoardItem[] = [];
  const open: BoardItem[] = [];
  for (const row of rows) {
    (row.isDraft === true ? draft : open).push(toItem(row, null));
  }
  return { draft, open };
}

const DISCUSSION_QUERY = `query($q: String!, $limit: Int!) {
  search(query: $q, type: DISCUSSION, first: $limit) {
    nodes {
      ... on Discussion {
        id
        number
        title
        url
        updatedAt
        category { name }
        comments { totalCount }
        repository { nameWithOwner isArchived }
      }
    }
  }
}`;

interface GhDiscussionNode extends GhSearchRow {
  category?: { name?: unknown };
  comments?: { totalCount?: unknown };
}

/**
 * GitHub's discussion search accepts `author:` but ignores `involves:` and
 * `commenter:`, so this column is authored discussions only.
 */
async function fetchDiscussions(login: string, limit: number): Promise<BoardItem[]> {
  const raw = await gh([
    "api",
    "graphql",
    "-f",
    `query=${DISCUSSION_QUERY}`,
    "-f",
    `q=author:${login} sort:updated-desc`,
    "-F",
    `limit=${limit}`,
  ]);
  const parsed: unknown = JSON.parse(raw);
  const nodes = (parsed as { data?: { search?: { nodes?: unknown } } }).data?.search?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((node): node is GhDiscussionNode => typeof node === "object" && node !== null)
    .filter((node) => node.repository?.isArchived !== true)
    .map((node) => {
      const item = toItem(node, typeof node.category?.name === "string" ? node.category.name : null);
      const total = node.comments?.totalCount;
      return { ...item, commentsCount: typeof total === "number" ? total : 0 };
    });
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

export async function loadBoardHandler({
  login,
  limit,
  force,
}: z.output<typeof loadBoard.input>): Promise<z.input<typeof loadBoard.output>> {
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
    columns,
    fetchedAt,
  };
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
