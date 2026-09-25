/**
 * The watch runner: runs the scripts in the home's `watches/` folder on their schedules while the
 * daemon is up, and sends the first mate whatever they print.
 *
 * Paseo's own schedules always prompt an agent, and most runs of a watch should cost nothing, so the
 * plugin keeps its own clock: a timer on each minute's boundary that runs every enabled, valid watch
 * whose schedule (`watch-schedule.ts`) matches that minute. A run prints nothing — the usual case —
 * and nothing happens. A run that prints something is queued, and the queue goes to the first mate in
 * one message once it is idle (`<firstmate-watch>` blocks under a line saying they are information,
 * not orders); while it is mid-turn, or while there is no first mate at all, the queue waits, at most
 * `MAX_QUEUED` long, the oldest dropped first and the drop counted in the next message.
 *
 * Guardrails: a run has `WATCH_TIMEOUT_MS`; its output is clipped to `MAX_OUTPUT_CHARS`, with a
 * marker; a watch still running when it is due again is not started twice; and a watch that fails —
 * a non-zero exit, a timeout, a script that will not start — is reported once, with the end of its
 * stderr, and not again until a run succeeds.
 *
 * A script runs in the home with the daemon's environment and these:
 *
 *     FIRSTMATE_HOME         the first mate's home
 *     FIRSTMATE_BACKLOG      <home>/data/backlog.md
 *     FIRSTMATE_WATCH_NAME   the script's file name
 *     FIRSTMATE_WATCH_STATE  a directory of its own to remember what it last saw, kept across runs:
 *                            $PASEO_HOME/plugin-data/firstmate/watch-state/<name>/
 *
 * What the board shows of each watch and the queue itself are kept in
 * `$PASEO_HOME/plugin-data/firstmate/watches.json`, so a plugin reload neither loses an output a
 * watch has already moved past nor forgets that a failure was reported.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { WatchResult, WatchSummary } from "../shared/fleet";
import { serialized } from "./serialize";
import { TEMPLATES, message } from "./templates";
import { BUILT_IN_WATCHES, builtInStates, listWatches, seedWatches, type WatchFile } from "./watch-files";
import { runWatchScript, type RunResult } from "./watch-run";
import { isDue } from "./watch-schedule";

export const WATCH_TIMEOUT_MS = 2 * 60 * 1000;
/** The most of one run's output sent to the first mate. */
export const MAX_OUTPUT_CHARS = 4000;
/** The most of a failed run's stderr sent, from its end. */
export const MAX_ERROR_CHARS = 1500;
/** Outputs waiting for the first mate; past this the oldest go. */
export const MAX_QUEUED = 20;
const MINUTE_MS = 60 * 1000;
/**
 * After the first mate's turn ends, when to try the queue: its snapshot can still say running for a
 * moment, and a turn it starts straight away — a crewmate's finish note — has to be waited out, not
 * interrupted. The minute's tick catches anything later.
 */
export const AFTER_TURN_DELAYS_MS: readonly number[] = [1000, 5000, 15000];

interface WatchRecord {
  lastRunAt: string | null;
  lastResult: WatchResult;
  lastOutput: string | null;
  lastOutputAt: string | null;
  lastError: string | null;
  /** Failing since a failure that has been reported; cleared by a run that succeeds. */
  failing: boolean;
}

/** One thing waiting to be told to the first mate. */
export interface QueuedNote {
  name: string;
  ran: string;
  kind: "output" | "failed";
  /** The output, or for a failure the end of stderr. */
  text: string;
  /** For a failure, what went wrong. */
  reason?: string;
}

interface RunnerState {
  watches: Record<string, WatchRecord>;
  queue: QueuedNote[];
  /** Outputs dropped from a full queue since the last delivery. */
  dropped: number;
}

/** Whether the note reached the first mate, or has to wait for it — busy, or not there. */
export type DeliveryOutcome = "sent" | "wait";

export interface WatchRunnerOptions {
  /** The first mate's home, or null while no launch has prepared one. */
  home: () => Promise<string | null>;
  /** Names the captain has switched off. */
  disabled: () => Promise<readonly string[]>;
  /** Sends the note, or says to wait: while the first mate is mid-turn, or while there is none. */
  deliver: (text: string) => Promise<DeliveryOutcome>;
  /** The runner's own file, `watches.json`. */
  stateFile: string;
  /** Where each script's `FIRSTMATE_WATCH_STATE` directory goes. */
  scriptStateRoot: string;
  now?: () => Date;
  run?: typeof runWatchScript;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

const BLANK: WatchRecord = {
  lastRunAt: null,
  lastResult: "never",
  lastOutput: null,
  lastOutputAt: null,
  lastError: null,
  failing: false,
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** An instant as the note writes it: UTC to the second. */
function stamp(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Output cut to `max` characters, with a marker saying how much was left out. */
export function clip(text: string, max: number, cutAlready = false): string {
  if (text.length <= max && !cutAlready) return text;
  const kept = text.slice(0, max).trimEnd();
  const more = text.length - kept.length;
  return `${kept}\n[output truncated${more > 0 && !cutAlready ? `; ${more} more characters` : ""}]`;
}

/** The end of `text`, at most `max` characters. */
function tail(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `…${trimmed.slice(trimmed.length - max)}`;
}

/** A script cannot close its own block, or open one, with what it prints. */
function quoted(text: string): string {
  return text.replace(/<(\/?firstmate-watch)/gi, "&lt;$1");
}

/** The whole message for a batch: `templates/messages/watch-*.md`. */
export async function watchNote(notes: readonly QueuedNote[], dropped: number): Promise<string> {
  const blocks = await Promise.all(
    notes.map((note) =>
      note.kind === "output"
        ? message(TEMPLATES.watchOutput, { name: note.name, ran: note.ran, output: quoted(note.text) })
        : message(TEMPLATES.watchFailed, {
            name: note.name,
            ran: note.ran,
            // An attribute's value, so it cannot hold the quote that ends it.
            reason: (note.reason ?? "it failed").replace(/"/g, "'"),
            stderr: note.text === "" ? "(nothing on stderr)" : quoted(note.text),
          }),
    ),
  );
  if (dropped > 0) blocks.unshift(await message(TEMPLATES.watchDropped, { count: String(dropped) }));
  return message(TEMPLATES.watchNote, { watches: blocks.join("\n\n") });
}

/** What went wrong with a run, in a few words, or null when it succeeded. */
function failureReason(result: RunResult, timeoutMs: number): string | null {
  if (result.spawnError !== null) return `it could not start: ${result.spawnError}`;
  if (result.timedOut) return `it ran longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped`;
  if (result.code === null) return "it was killed by a signal";
  if (result.code !== 0) return `it exited with code ${result.code}`;
  return null;
}

export class WatchRunner {
  private state: RunnerState | null = null;
  private loading: Promise<RunnerState> | null = null;
  private readonly running = new Set<string>();
  private readonly aborter = new AbortController();
  private flushing: Promise<void> = Promise.resolve();
  private readonly afterTurn = new Set<NodeJS.Timeout>();
  private timer: NodeJS.Timeout | undefined;
  private readonly now: () => Date;
  private readonly run: typeof runWatchScript;
  private readonly timeoutMs: number;

  constructor(private readonly options: WatchRunnerOptions) {
    this.now = options.now ?? (() => new Date());
    this.run = options.run ?? runWatchScript;
    this.timeoutMs = options.timeoutMs ?? WATCH_TIMEOUT_MS;
  }

  /** Ticks on every minute's boundary until the returned function — or `stop` — is called. */
  start(): () => void {
    const next = () => {
      const target = (Math.floor(Date.now() / MINUTE_MS) + 1) * MINUTE_MS;
      this.timer = setTimeout(() => {
        if (this.aborter.signal.aborted) return;
        // A timer can fire a hair early; a late one (the Mac asleep) checks the minute it woke in.
        const at = new Date(Math.max(Date.now(), target));
        void this.tick(at).catch((error: unknown) => console.error("[firstmate] a watch tick failed:", error));
        next();
      }, target - Date.now() + 50);
    };
    next();
    return () => this.stop();
  }

  /** No more ticks; running scripts are stopped, and nothing is started after this, even by a tick under way. */
  stop(): void {
    clearTimeout(this.timer);
    this.afterTurn.forEach((timer) => clearTimeout(timer));
    this.afterTurn.clear();
    this.aborter.abort();
  }

  /** Runs every watch due in the minute `at` falls in, then tries to deliver what is queued. */
  async tick(at: Date = this.now()): Promise<void> {
    const home = await this.options.home();
    if (home === null) return;
    await seedWatches(home).catch((error: unknown) => {
      console.error("[firstmate] could not write the built-in watches:", error);
    });
    const [watches, disabled] = await Promise.all([listWatches(home), this.options.disabled()]);
    const off = new Set(disabled);
    const due = watches.filter(
      (watch) => watch.schedule !== null && !off.has(watch.name) && !this.running.has(watch.name) && isDue(watch.schedule, at),
    );
    // The plugin may have stopped while this tick read the folder and the config.
    if (this.aborter.signal.aborted) return;
    await Promise.all(due.map((watch) => this.runOne(home, watch, at)));
    await this.flush();
  }

  /** Runs one watch now and records what came of it. Refused while that watch is already running. */
  async runOne(home: string, watch: WatchFile, at: Date = this.now()): Promise<void> {
    if (this.running.has(watch.name) || this.aborter.signal.aborted) return;
    this.running.add(watch.name);
    try {
      const stateDirectory = join(this.options.scriptStateRoot, watch.name);
      await mkdir(stateDirectory, { recursive: true });
      const result = await this.run(watch.path, {
        cwd: home,
        env: {
          ...(this.options.env ?? process.env),
          FIRSTMATE_HOME: home,
          FIRSTMATE_BACKLOG: join(home, "data", "backlog.md"),
          FIRSTMATE_WATCH_NAME: watch.name,
          FIRSTMATE_WATCH_STATE: stateDirectory,
        },
        timeoutMs: this.timeoutMs,
        // Bytes, a little over the characters sent, so the marker can say something was cut.
        maxOutputBytes: MAX_OUTPUT_CHARS * 4,
        maxErrorBytes: MAX_ERROR_CHARS * 4,
        signal: this.aborter.signal,
      });
      if (this.aborter.signal.aborted) return;
      await this.record(watch.name, stamp(at), result);
    } finally {
      this.running.delete(watch.name);
    }
  }

  private async record(name: string, ran: string, result: RunResult): Promise<void> {
    const state = await this.load();
    const previous = state.watches[name] ?? BLANK;
    const reason = failureReason(result, this.timeoutMs);
    if (reason !== null) {
      const stderr = tail(result.stderr, MAX_ERROR_CHARS);
      if (!previous.failing) this.enqueue(state, { name, ran, kind: "failed", reason, text: stderr });
      state.watches[name] = {
        ...previous,
        lastRunAt: ran,
        lastResult: "failed",
        lastError: stderr === "" ? reason : `${reason}\n${stderr}`,
        failing: true,
      };
    } else {
      const output = result.stdout.trim();
      if (output === "") {
        state.watches[name] = { ...previous, lastRunAt: ran, lastResult: "silent", lastError: null, failing: false };
      } else {
        const text = clip(output, MAX_OUTPUT_CHARS, result.truncated);
        this.enqueue(state, { name, ran, kind: "output", text });
        state.watches[name] = {
          lastRunAt: ran,
          lastResult: "queued",
          lastOutput: text,
          lastOutputAt: ran,
          lastError: null,
          failing: false,
        };
      }
    }
    await this.persist();
  }

  private enqueue(state: RunnerState, note: QueuedNote): void {
    state.queue.push(note);
    while (state.queue.length > MAX_QUEUED) {
      state.queue.shift();
      state.dropped += 1;
    }
  }

  /**
   * Sends everything queued as one message, if the first mate can take it. One flush at a time, so two
   * triggers landing together — a run finishing as the first mate's turn ends — cannot send it twice.
   */
  flush(): Promise<void> {
    const run = this.flushing.then(() => this.flushOnce());
    this.flushing = run.catch(() => undefined);
    return run;
  }

  /**
   * The first mate has just ended a turn: try the queue a few times over the next seconds rather than
   * once now. Every try asks whether it is mid-turn — a newer turn may already have started, and a
   * message sent into it could replace it where the provider cannot steer.
   */
  flushAfterTurn(delays: readonly number[] = AFTER_TURN_DELAYS_MS): void {
    delays.forEach((delay) => {
      const timer = setTimeout(() => {
        this.afterTurn.delete(timer);
        if (this.aborter.signal.aborted) return;
        void this.flush().catch((error: unknown) => {
          console.error("[firstmate] could not send the watches' output after the first mate's turn:", error);
        });
      }, delay);
      this.afterTurn.add(timer);
    });
  }

  private async flushOnce(): Promise<void> {
    if (this.aborter.signal.aborted) return;
    const state = await this.load();
    if (state.queue.length === 0 && state.dropped === 0) return;
    const batch = [...state.queue];
    const dropped = state.dropped;
    let outcome: DeliveryOutcome;
    try {
      outcome = await this.options.deliver(await watchNote(batch, dropped));
    } catch (error) {
      console.error("[firstmate] could not send the watches' output to the first mate:", error);
      return;
    }
    if (outcome !== "sent") return;
    state.queue = state.queue.filter((note) => !batch.includes(note));
    state.dropped -= dropped;
    for (const note of batch) {
      const record = state.watches[note.name];
      if (note.kind === "output" && record?.lastResult === "queued" && record.lastOutputAt === note.ran) {
        state.watches[note.name] = { ...record, lastResult: "delivered" };
      }
    }
    await this.persist();
  }

  /** Every watch in the home as the board draws it. */
  async summaries(): Promise<WatchSummary[]> {
    const home = await this.options.home();
    if (home === null) return [];
    const [watches, disabled, builtIns, state] = await Promise.all([
      listWatches(home),
      this.options.disabled(),
      builtInStates(home),
      this.load(),
    ]);
    const off = new Set(disabled);
    return watches.map((watch) => {
      const record = state.watches[watch.name] ?? BLANK;
      return {
        name: watch.name,
        schedule: watch.scheduleText,
        enabled: !off.has(watch.name),
        invalid: watch.invalid,
        running: this.running.has(watch.name),
        lastRunAt: record.lastRunAt,
        lastResult: watch.invalid === null ? shownResult(record, state.queue, watch.name) : "invalid",
        lastOutput: record.lastOutput,
        lastOutputAt: record.lastOutputAt,
        lastError: record.lastError,
        builtIn: BUILT_IN_WATCHES.some((builtIn) => builtIn.name === watch.name),
        outdated: builtIns.get(watch.name)?.outdated ?? false,
      };
    });
  }

  private load(): Promise<RunnerState> {
    if (this.state !== null) return Promise.resolve(this.state);
    this.loading ??= readState(this.options.stateFile).then((state) => {
      this.state = state;
      return state;
    });
    return this.loading;
  }

  private persist(): Promise<void> {
    const state = this.state;
    if (state === null) return Promise.resolve();
    const path = this.options.stateFile;
    return serialized(path, async () => {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temporary, path);
    }).catch((error: unknown) => {
      console.error(`[firstmate] could not save ${path}:`, error);
    });
  }
}

/**
 * What the card says of a watch's last run, read against the queue rather than trusted from the record.
 * A run that printed nothing after one whose output is still waiting shows that output as waiting, not
 * "nothing new"; and output recorded as waiting that has left the queue without being sent — pushed out
 * of a full queue — shows as dropped, since nothing of it is left to send.
 */
function shownResult(record: WatchRecord, queue: readonly QueuedNote[], name: string): WatchResult {
  const waiting = queue.some((note) => note.name === name && note.kind === "output");
  if (record.lastResult === "silent" && waiting) return "queued";
  if (record.lastResult === "queued" && !waiting) return "dropped";
  return record.lastResult;
}

const RESULTS: ReadonlySet<string> = new Set<WatchResult>([
  "never",
  "silent",
  "queued",
  "delivered",
  "dropped",
  "failed",
  "invalid",
]);

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** The saved state, leniently: anything it cannot read starts afresh rather than stopping the watches. */
export async function readState(path: string): Promise<RunnerState> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[firstmate] ${path} could not be read, starting afresh: ${describe(error)}`);
    }
    return { watches: {}, queue: [], dropped: 0 };
  }
  const object = (raw ?? {}) as { watches?: unknown; queue?: unknown; dropped?: unknown };
  const watches: Record<string, WatchRecord> = {};
  if (typeof object.watches === "object" && object.watches !== null) {
    for (const [name, value] of Object.entries(object.watches as Record<string, Record<string, unknown>>)) {
      const result = asString(value.lastResult);
      watches[name] = {
        lastRunAt: asString(value.lastRunAt),
        lastResult: result !== null && RESULTS.has(result) ? (result as WatchResult) : "never",
        lastOutput: asString(value.lastOutput),
        lastOutputAt: asString(value.lastOutputAt),
        lastError: asString(value.lastError),
        failing: value.failing === true,
      };
    }
  }
  const queue: QueuedNote[] = Array.isArray(object.queue)
    ? (object.queue as Array<Record<string, unknown>>).flatMap((entry) => {
        const name = asString(entry.name);
        const ran = asString(entry.ran);
        const text = asString(entry.text);
        const kind = entry.kind === "failed" ? "failed" : entry.kind === "output" ? "output" : null;
        if (name === null || ran === null || text === null || kind === null) return [];
        const reason = asString(entry.reason);
        return [{ name, ran, kind, text, ...(reason === null ? {} : { reason }) }];
      })
    : [];
  const dropped = typeof object.dropped === "number" && object.dropped > 0 ? Math.floor(object.dropped) : 0;
  return { watches, queue, dropped };
}
