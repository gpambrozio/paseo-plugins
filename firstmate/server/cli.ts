/**
 * The `paseo` CLI, for what the plugin SDK does not offer.
 *
 * `PaseoAgentHandle` can send, archive and answer a permission, but it cannot
 * stop a turn — the handle has no cancel. The CLI can (`paseo stop <id>`, a
 * no-op for an idle agent), and plugin code runs unsandboxed next to the
 * daemon, so that is the way in. Likewise the SDK can title a workspace but
 * not rename a project. `herald` deletes its helpers the same way; the lookup
 * below is the same one.
 */
import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { paseoHome } from "./config";

/** Where an install puts the binary, for a daemon started with a bare PATH. */
const EXTRA_CLI_DIRS = ["/usr/local/bin", "/opt/homebrew/bin"];

const CLI_TIMEOUT_MS = 30_000;

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

let cliLookup: Promise<string | null> | null = null;

/**
 * The daemon hands its plugins `PASEO_CLI`, the CLI it shipped with (seen on
 * 0.9.1), which is the one that surely speaks its protocol; `PATH` and the
 * usual install directories are the fallback for a daemon that does not.
 */
async function findCli(): Promise<string | null> {
  const onPath = (process.env.PATH ?? "").split(delimiter).filter((dir) => dir !== "");
  const shipped = process.env.PASEO_CLI?.trim();
  const candidates = [
    ...(shipped === undefined || shipped === "" ? [] : [shipped]),
    ...[...onPath, join(homedir(), ".local", "bin"), ...EXTRA_CLI_DIRS].map((dir) => join(dir, "paseo")),
  ];
  for (const candidate of candidates) {
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
function paseoCli(): Promise<string | null> {
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

/**
 * Interrupts the agent's current turn; the agent and its worktree stay.
 * `--home` rather than the inherited `PASEO_HOME`, so the CLI always reaches
 * the daemon this plugin runs inside.
 */
export async function stopAgent(agentId: string): Promise<void> {
  const cli = await paseoCli();
  if (cli === null) {
    throw new Error("The `paseo` command is not on the daemon's PATH, so a turn cannot be interrupted from here.");
  }
  const result = await spawnCli(cli, ["stop", agentId, "--home", paseoHome(), "--json"], CLI_TIMEOUT_MS);
  if (result.code !== 0) throw new Error(`paseo stop failed: ${cliError(result)}`);
}

/** Sets the name Paseo shows for a project, as `paseo project rename` does. */
export async function renameProject(projectId: string, name: string): Promise<void> {
  const cli = await paseoCli();
  if (cli === null) throw new Error("The `paseo` command is not on the daemon's PATH, so a project cannot be renamed.");
  const result = await spawnCli(
    cli,
    ["project", "rename", projectId, name, "--home", paseoHome(), "--json"],
    CLI_TIMEOUT_MS,
  );
  if (result.code !== 0) throw new Error(`paseo project rename failed: ${cliError(result)}`);
}
