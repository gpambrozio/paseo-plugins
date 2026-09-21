/**
 * Putting a summary helper away for good.
 *
 * Every helper is a real Paseo agent, so every summary leaves a session in the
 * user's history. `autoArchive` only soft-deletes it, and the plugin API has no
 * hard delete — `PaseoAgentHandle` offers `archive()` and `detach()` and
 * nothing else. The `paseo` CLI does, and plugin code runs unsandboxed next to
 * the daemon, so that is the way in: `paseo delete <id>`, one child process per
 * agent.
 *
 * Two callers. `server/summarize.ts` deletes each helper by id the moment it is
 * done with it, which is precise and never races a summary still being written.
 * `index.server.ts` runs `sweepHelpers` once a little after load, for the ones
 * no id survived for: the backlog from before any of this existed, and the
 * orphans a plugin reload or a stopped daemon leaves mid-summary. The sweep
 * finds them by the label every helper carries.
 */
import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { paseoHome } from "./config";

/** Stamped on every helper at creation, and the only thing a sweep goes by. */
export const HELPER_LABEL_KEY = "herald.role";
export const HELPER_LABEL_VALUE = "summarizer";
export const HELPER_LABELS: Record<string, string> = { [HELPER_LABEL_KEY]: HELPER_LABEL_VALUE };

/** Where an install puts the binary, for a daemon started with a bare PATH. */
const EXTRA_CLI_DIRS = ["/usr/local/bin", "/opt/homebrew/bin"];

const LIST_TIMEOUT_MS = 20_000;
const DELETE_TIMEOUT_MS = 30_000;

/**
 * `paseo ls` answers one page at a time — twenty agents, at the time of
 * writing — so one pass is not the whole backlog. The sweep asks again until a
 * page holds nothing it may delete, and gives up after this many passes rather
 * than trusting the daemon to ever run out.
 */
export const MAX_SWEEP_PASSES = 50;

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

let cliLookup: Promise<string | null> | null = null;

async function findCli(): Promise<string | null> {
  const onPath = (process.env.PATH ?? "").split(delimiter).filter((dir) => dir !== "");
  for (const dir of [...onPath, join(homedir(), ".local", "bin"), ...EXTRA_CLI_DIRS]) {
    const candidate = join(dir, "paseo");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory; try the next one.
    }
  }
  return null;
}

/** The CLI's absolute path, looked up once per plugin process. */
export function paseoCli(): Promise<string | null> {
  cliLookup ??= findCli();
  return cliLookup;
}

function spawnCli(cli: string, args: string[], timeoutMs: number): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`paseo ${args[0] ?? ""} did not finish within ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * `--home` rather than the inherited `PASEO_HOME`, so the CLI always reaches
 * the daemon this plugin is running inside; `--json` so a failure arrives as
 * something worth putting in a log line.
 */
async function runCli(args: string[], timeoutMs: number): Promise<CliResult> {
  const cli = await paseoCli();
  if (cli === null) {
    throw new Error("The `paseo` command is not on the daemon's PATH, so summary helpers cannot be deleted.");
  }
  return spawnCli(cli, [...args, "--home", paseoHome(), "--json"], timeoutMs);
}

/** The CLI's complaint: the message out of its JSON error, or its first line. */
export function cliError(result: CliResult): string {
  for (const stream of [result.stderr, result.stdout]) {
    const text = stream.trim();
    if (text === "") continue;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON; the text itself is the complaint.
    }
    if (typeof parsed === "object" && parsed !== null) {
      const error = (parsed as { error?: { message?: unknown } }).error;
      if (typeof error?.message === "string" && error.message.trim() !== "") return error.message.trim();
    }
    return text.split("\n")[0] ?? text;
  }
  return `exit ${result.code}`;
}

/** The ids in one page of `paseo ls --json`, ignoring any entry without one. */
export function helperIdsIn(stdout: string): string[] {
  const trimmed = stdout.trim();
  if (trimmed === "") return [];
  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) throw new Error("`paseo ls` did not answer with a list of agents.");
  return parsed.flatMap((entry: unknown) => {
    const id = typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : undefined;
    return typeof id === "string" && id !== "" ? [id] : [];
  });
}

/** One page of the helpers this plugin has ever created, archived ones included. */
export async function listHelperIds(): Promise<string[]> {
  const result = await runCli(
    ["ls", "--all", "--global", "--label", `${HELPER_LABEL_KEY}=${HELPER_LABEL_VALUE}`],
    LIST_TIMEOUT_MS,
  );
  if (result.code !== 0) throw new Error(`\`paseo ls\` failed: ${cliError(result)}`);
  return helperIdsIn(result.stdout);
}

/** Interrupts the agent if it is running, then removes it from the daemon's history. */
export async function deleteAgent(agentId: string): Promise<void> {
  const result = await runCli(["delete", agentId], DELETE_TIMEOUT_MS);
  if (result.code !== 0) throw new Error(`\`paseo delete\` failed: ${cliError(result)}`);
}

export interface SweepDeps {
  /** Helpers a summary is still being written by. Never deleted. */
  keep?: ReadonlySet<string>;
  list?: () => Promise<string[]>;
  remove?: (agentId: string) => Promise<void>;
}

export interface SweepResult {
  deleted: number;
  failed: number;
}

/**
 * Deletes every helper the daemon still has, page by page.
 *
 * Two things end it besides running out: a page holding nothing but kept ids,
 * and a pass that deleted nothing at all — without the second, a page of ids
 * that all refuse to delete would be re-read until `MAX_SWEEP_PASSES`.
 */
export async function sweepHelpers(deps: SweepDeps = {}): Promise<SweepResult> {
  const keep = deps.keep ?? new Set<string>();
  const list = deps.list ?? listHelperIds;
  const remove = deps.remove ?? deleteAgent;
  let deleted = 0;
  let failed = 0;
  for (let pass = 0; pass < MAX_SWEEP_PASSES; pass += 1) {
    const ids = (await list()).filter((id) => !keep.has(id));
    if (ids.length === 0) break;
    const before = deleted;
    for (const id of ids) {
      try {
        await remove(id);
        deleted += 1;
      } catch (error) {
        failed += 1;
        console.error(`[herald] could not delete summary helper ${id}:`, error);
      }
    }
    if (deleted === before) break;
  }
  return { deleted, failed };
}
