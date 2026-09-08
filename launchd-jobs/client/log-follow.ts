/**
 * Live `tail -f` on a job's log, over the terminal SDK 0.8 added.
 *
 * `readJobLog` answers a byte-tail of the file at the moment it is asked, which
 * is all a "Refresh log" button needs and no use at all while a job is actually
 * running. This gives the same pane a follow mode: the daemon runs `tail -f` in
 * a pty the plugin owns, and the panel repaints from that terminal's scrollback
 * rather than re-reading the whole file on a timer.
 *
 * **The terminal has to belong to a workspace.** `terminals.create` takes a
 * required `workspaceId` — terminals are workspace-scoped in Paseo's model, and
 * this surface is global, so there is no workspace it naturally belongs to. It
 * borrows one: the first live workspace the daemon lists, named so it is
 * obvious in that workspace's terminal list what put it there, reused rather
 * than duplicated, and killed as soon as following stops or the panel goes
 * away. With no workspace at all there is nothing to host it and follow mode
 * reports itself unavailable instead of failing on press.
 *
 * Async **function expressions**, never async arrows — see `client/jobs.tsx`.
 */
import { usePaseo } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Job } from "../shared/jobs";

/**
 * How often the panel re-reads the pty's screen. This is not the log's latency
 * — `tail -f` writes into the terminal the moment the job does — only how often
 * we look, and a capture is a screen read on the daemon rather than a file
 * read, so it stays cheap.
 */
const CAPTURE_MS = 1_000;

/**
 * The pty's geometry. Wide enough that ordinary log lines are not hard-wrapped
 * into the capture, tall enough that one capture carries a useful window.
 */
const TERMINAL_SIZE = { rows: 60, cols: 200 };

/** What the pane renders. More than this is scrollback nobody scrolls back to. */
const MAX_LINES = 500;

export interface LogFollow {
  /** True from the moment `start` is pressed, including while it is connecting. */
  readonly following: boolean;
  /** Null until the first capture answers, so the pane can keep the static log. */
  readonly lines: readonly string[] | null;
  readonly error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * A pty screen is padded to its full height, so the tail of a capture is blank
 * rows rather than output. Trailing blanks are dropped; interior ones are the
 * job's own and stay.
 */
function trimTrailingBlanks(lines: readonly string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1]?.trim() === "") end -= 1;
  return lines.slice(Math.max(0, end - MAX_LINES), end);
}

export function useLogFollow(job: Job): LogFollow {
  const paseo = usePaseo();
  const [following, setFollowing] = useState(false);
  const [lines, setLines] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The live terminal, off React state on purpose: the cleanup that kills it
   * runs after the component has stopped re-rendering, so it has to read the
   * handle from somewhere that is not a stale closure.
   */
  const terminal = useRef<{ kill: () => Promise<void> } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Guards against a `stop` — or an unmount — that lands while `create` is
   * still in flight, which would otherwise leave a `tail -f` running with
   * nothing holding its handle.
   */
  const generation = useRef(0);

  const teardown = useCallback(function teardown() {
    generation.current += 1;
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
    const live = terminal.current;
    terminal.current = null;
    if (live !== null) {
      void live.kill().catch((cause: unknown) => {
        console.warn("[launchd-jobs] could not kill the follow terminal", cause);
      });
    }
  }, []);

  const stop = useCallback(
    function stop() {
      teardown();
      setFollowing(false);
      setLines(null);
      setError(null);
    },
    [teardown],
  );

  const start = useCallback(
    function start() {
      teardown();
      setFollowing(true);
      setLines(null);
      setError(null);

      const mine = generation.current;
      void (async function follow() {
        try {
          const workspaces = await paseo.workspaces.list();
          const host = workspaces.entries.find((entry) => !entry.archivingAt);
          if (host === undefined) {
            throw new Error(
              "Following needs a workspace to run the tail in, and there are none open.",
            );
          }

          const handle = await paseo.terminals.create({
            workspaceId: host.id,
            // The log is an absolute path and the tail reads nothing relative,
            // so the workspace's own directory is as good a cwd as any.
            name: `launchd: ${job.label}`,
            command: "tail",
            args: ["-n", String(MAX_LINES), "-f", job.logPath],
            size: TERMINAL_SIZE,
          });

          // `stop`, or an unmount, beat the create. Nothing is holding this
          // terminal any more, so it has to go now rather than at the next
          // teardown, which will never come.
          if (mine !== generation.current) {
            await handle.kill();
            return;
          }
          terminal.current = handle;

          async function capture() {
            try {
              const screen = await handle.capture({ stripAnsi: true });
              if (mine !== generation.current) return;
              setLines(trimTrailingBlanks(screen.lines));
            } catch (cause) {
              if (mine !== generation.current) return;
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }

          await capture();
          if (mine !== generation.current) return;
          timer.current = setInterval(() => void capture(), CAPTURE_MS);
        } catch (cause) {
          if (mine !== generation.current) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          setFollowing(false);
        }
      })();
    },
    [job.label, job.logPath, paseo, teardown],
  );

  // A job swapped underneath a running follow is a follow on the wrong file,
  // and an unmounted panel is a `tail -f` nobody can see or stop.
  useEffect(() => {
    return function cleanup() {
      teardown();
    };
  }, [job.id, teardown]);

  useEffect(() => {
    setFollowing(false);
    setLines(null);
    setError(null);
  }, [job.id]);

  return { following, lines, error, start, stop };
}
