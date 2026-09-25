/**
 * Runs one watch script: as it is, by its `#!` line, with its own process group so a timeout takes its
 * children (`gh`, `curl`) with it. Once a run is stopped — timed out, or the plugin shutting down — the
 * group gets SIGTERM and, after the grace period, SIGKILL whatever has happened in between: the script
 * exiting on SIGTERM does not mean a child that ignores it, and has let go of the pipes, is gone too.
 *
 * What it prints is kept up to a cap and read to the end regardless, so a chatty script never blocks on
 * a full pipe; stderr is kept as its last lines, which is where an error usually is.
 */
import { spawn } from "node:child_process";

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** The most of stdout kept, in bytes. */
  maxOutputBytes: number;
  /** The most of stderr kept, from its end, in bytes. */
  maxErrorBytes: number;
  /** After a timeout's SIGTERM, how long before SIGKILL. */
  killGraceMs?: number;
  /** Stops the script as a timeout would, for a plugin that is shutting down. */
  signal?: AbortSignal;
}

export interface RunResult {
  /** The exit code, or null when a signal ended it or it never started. */
  code: number | null;
  timedOut: boolean;
  stdout: string;
  /** stdout went past `maxOutputBytes` and was cut there. */
  truncated: boolean;
  stderr: string;
  /** Why it did not start — not found, not executable — or null. */
  spawnError: string | null;
}

function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

export function runWatchScript(path: string, options: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    // An abort that has already happened is never replayed to a listener added now, so check it here.
    if (options.signal?.aborted === true) {
      resolve({ code: null, timedOut: false, stdout: "", truncated: false, stderr: "", spawnError: "the plugin stopped" });
      return;
    }
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let truncated = false;
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let spawnError: string | null = null;
    let settled = false;

    const child = spawn(path, [], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let killTimer: NodeJS.Timeout | undefined;
    function stop(): void {
      if (killTimer !== undefined) return;
      killGroup(child.pid, "SIGTERM");
      killTimer = setTimeout(() => killGroup(child.pid, "SIGKILL"), options.killGraceMs ?? 2000);
    }
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    const abort = () => stop();
    options.signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      const room = options.maxOutputBytes - stdoutBytes;
      if (room <= 0) {
        truncated = true;
        return;
      }
      if (chunk.length > room) truncated = true;
      const kept = chunk.subarray(0, room);
      stdout.push(kept);
      stdoutBytes += kept.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > options.maxErrorBytes) stderr = stderr.subarray(stderr.length - options.maxErrorBytes);
    });

    function finish(code: number | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A pending SIGKILL is left to fire: it is for the group, not for the script alone.
      options.signal?.removeEventListener("abort", abort);
      resolve({
        code,
        timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        truncated,
        stderr: stderr.toString("utf8"),
        spawnError,
      });
    }

    child.on("error", (error) => {
      spawnError = error.message;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
