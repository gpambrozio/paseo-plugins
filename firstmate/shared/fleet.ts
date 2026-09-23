/**
 * Every crossing between the board and the daemon, and the vocabulary both
 * sides — and the first mate's charter — share.
 *
 * The plugin never dispatches a crewmate itself. The first mate does, with
 * Paseo's own tools; the plugin sets up its home, starts it, carries the
 * captain's words to it, and draws what it and its crew are doing.
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * The labels a crewmate is created with. The charter tells the first mate to
 * set them, and the board finds the crew by them, so both read this one
 * object rather than spelling the keys twice.
 */
export const CREW_LABELS = {
  role: "firstmate.role",
  crewRole: "crew",
  mateRole: "first-mate",
  task: "firstmate.task",
  kind: "firstmate.kind",
  project: "firstmate.project",
} as const;

/** The words a crewmate ends every turn with: `<state>: <one short line>`. */
export const CrewStateSchema = z.enum([
  "working",
  "needs-decision",
  "blocked",
  "paused",
  "done",
  "failed",
  "resolved",
]);
export type CrewState = z.infer<typeof CrewStateSchema>;

export const COLUMN_IDS = ["queued", "working", "blocked", "parked", "done", "failed", "idle"] as const;
export const ColumnIdSchema = z.enum(COLUMN_IDS);
export type ColumnId = z.infer<typeof ColumnIdSchema>;

export const AgentStatusSchema = z.enum(["initializing", "idle", "running", "error", "closed"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/** What the board needs of one Paseo agent — the first mate or a crewmate. */
export const AgentSummarySchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  title: z.string().nullable(),
  provider: z.string(),
  model: z.string().nullable(),
  status: AgentStatusSchema,
  cwd: z.string(),
  pendingPermissions: z.number().int(),
  requiresAttention: z.boolean(),
  lastError: z.string().nullable(),
  updatedAt: z.string(),
  labels: z.record(z.string(), z.string()),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const CrewReportSchema = z.object({
  state: CrewStateSchema,
  text: z.string(),
});
export type CrewReportSummary = z.infer<typeof CrewReportSchema>;

export const BacklogSectionSchema = z.enum(["in-flight", "queued", "done"]);
export type BacklogSection = z.infer<typeof BacklogSectionSchema>;

export const BacklogItemSchema = z.object({
  section: BacklogSectionSchema,
  id: z.string(),
  title: z.string(),
  project: z.string().nullable(),
  kind: z.string().nullable(),
  mode: z.string().nullable(),
  agentId: z.string().nullable(),
  hold: z.string().nullable(),
  blockedBy: z.string().nullable(),
  since: z.string().nullable(),
  url: z.string().nullable(),
  reportPath: z.string().nullable(),
  outcome: z.string().nullable(),
});
export type BacklogItem = z.infer<typeof BacklogItemSchema>;

/**
 * One card on the board: a backlog item, a crewmate, or — the usual case once
 * work is under way — both, joined by task id.
 */
export const FleetCardSchema = z.object({
  key: z.string(),
  column: ColumnIdSchema,
  taskId: z.string().nullable(),
  title: z.string(),
  project: z.string().nullable(),
  kind: z.string().nullable(),
  backlog: BacklogItemSchema.nullable(),
  agent: AgentSummarySchema.nullable(),
  /** The status line the crewmate ended its last turn with. */
  report: CrewReportSchema.nullable(),
  /** A pull request, from the report or the backlog line. */
  url: z.string().nullable(),
});
export type FleetCard = z.infer<typeof FleetCardSchema>;

export const ProjectSchema = z.object({
  name: z.string(),
  mode: z.string().nullable(),
  yolo: z.boolean(),
  location: z.string().nullable(),
  description: z.string().nullable(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const FleetSchema = z.object({
  home: z.string(),
  /** False until the first launch has written the charter and records. */
  homeReady: z.boolean(),
  mate: AgentSummarySchema.nullable(),
  /** A first mate is configured but Paseo no longer has it (archived, deleted). */
  mateMissing: z.boolean(),
  /**
   * Whether the first mate runs in its home, where its charter is. False for
   * an adopted agent working elsewhere, which has never read the charter.
   * Compared as real paths, since `/tmp` is `/private/tmp` on a Mac.
   */
  mateInHome: z.boolean(),
  cards: z.array(FleetCardSchema),
  projects: z.array(ProjectSchema),
  /**
   * Whether the daemon gives agents Paseo's own tools (`mcp.injectIntoAgents`),
   * which is how the first mate starts and hears from its crew. Off by default
   * in Paseo; `null` when the daemon would not say.
   */
  agentTools: z.boolean().nullable(),
  /** Things worth a line on the board: an unreadable backlog, a failed agent listing. */
  warnings: z.array(z.string()),
});
export type Fleet = z.infer<typeof FleetSchema>;

// ---------------------------------------------------------------------------
// The daemon's own file: what handlers act on
// ---------------------------------------------------------------------------

export const FirstmateConfigSchema = z.object({
  /** The first mate's home; empty means `$PASEO_HOME/plugins/firstmate/home`. */
  home: z.string().default(""),
  /** The Paseo agent that is the first mate; empty until one is launched or adopted. */
  mateAgentId: z.string().default(""),
  /** `provider/model` the first mate is launched with. */
  mateProvider: z.string().default(""),
  mateModeId: z.string().default(""),
  /** `provider/model` the charter tells the first mate to give crewmates; empty leaves it to the first mate. */
  crewProvider: z.string().default(""),
  crewModeId: z.string().default(""),
});
export type FirstmateConfig = z.infer<typeof FirstmateConfigSchema>;

export const readConfig = defineRpc({
  name: "firstmate.config.read",
  input: z.object({}),
  output: z.object({ config: FirstmateConfigSchema, resolvedHome: z.string() }),
});

export const writeConfig = defineRpc({
  name: "firstmate.config.write",
  input: FirstmateConfigSchema.partial(),
  output: z.object({ config: FirstmateConfigSchema, resolvedHome: z.string() }),
});

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export const loadFleet = defineRpc({
  name: "firstmate.fleet.load",
  input: z.object({}),
  output: FleetSchema,
});

/**
 * Turns on `mcp.injectIntoAgents` in the daemon's config. Only agents started
 * or resumed afterwards get the tools, which is why the board asks before the
 * first mate is launched rather than after.
 */
export const enableAgentTools = defineRpc({
  name: "firstmate.tools.enable",
  input: z.object({}),
  output: z.object({ agentTools: z.boolean() }),
});

// ---------------------------------------------------------------------------
// The first mate
// ---------------------------------------------------------------------------

/**
 * Writes the charter and records into the home, then starts the first mate
 * there. Launching again while one is running is refused; adopt or archive it
 * first.
 */
export const launchMate = defineRpc({
  name: "firstmate.mate.launch",
  input: z.object({
    provider: z.string().min(1),
    modeId: z.string().default(""),
  }),
  output: z.object({ agentId: z.string(), workspaceId: z.string().nullable() }),
});

/** Makes an existing agent the first mate. Its cwd should be the home; the board says so when it is not. */
export const adoptMate = defineRpc({
  name: "firstmate.mate.adopt",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ config: FirstmateConfigSchema }),
});

/** Forgets the first mate without touching the agent. */
export const releaseMate = defineRpc({
  name: "firstmate.mate.release",
  input: z.object({}),
  output: z.object({ config: FirstmateConfigSchema }),
});

/** Agents that could be adopted: every live agent, those in the home first. */
export const listCandidates = defineRpc({
  name: "firstmate.mate.candidates",
  input: z.object({}),
  output: z.object({ home: z.string(), agents: z.array(AgentSummarySchema) }),
});

/**
 * Marks the first mate as seen, the way looking at it in Paseo does: its
 * "finished" or "error" flag is cleared, so its workspace reads as done in
 * the sidebar. A first mate waiting on a permission keeps its flag — that is
 * the captain's prompt to answer it.
 */
export const markMateSeen = defineRpc({
  name: "firstmate.mate.seen",
  input: z.object({}),
  output: z.object({ cleared: z.boolean() }),
});

/**
 * Starts the first mate afresh: the current one is archived — its
 * conversation stays in Paseo's history — and a new one is launched in the
 * home with the same model, mode and thinking, told that it is taking over.
 * Its records carry what the old one knew.
 */
export const restartMate = defineRpc({
  name: "firstmate.mate.restart",
  input: z.object({}),
  output: z.object({ agentId: z.string(), workspaceId: z.string().nullable() }),
});

/**
 * Asks the first mate's provider to compact its context, with the same
 * `/compact` Paseo's own composer sends. Refused while a turn is running: a
 * slash command is a turn of its own, not a message to join one.
 */
export const compactMate = defineRpc({
  name: "firstmate.mate.compact",
  input: z.object({}),
  output: z.object({ agentId: z.string() }),
});

/** Delivers the captain's words to the first mate. */
export const askMate = defineRpc({
  name: "firstmate.mate.ask",
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ agentId: z.string() }),
});

// ---------------------------------------------------------------------------
// One crewmate
// ---------------------------------------------------------------------------

const crewInput = z.object({ agentId: z.string().min(1) });

/** Words straight to a crewmate. Authoritative, like the captain typing into its tab. */
export const steerCrew = defineRpc({
  name: "firstmate.crew.steer",
  input: crewInput.extend({ text: z.string().min(1) }),
  output: z.object({}),
});

/** Stops the crewmate's current turn; the agent and its worktree stay. */
export const interruptCrew = defineRpc({
  name: "firstmate.crew.interrupt",
  input: crewInput,
  output: z.object({}),
});

/**
 * Ends the crewmate: Paseo archives the agent. Its workspace and worktree are
 * left exactly as they are — nothing is torn down or discarded.
 */
export const exitCrew = defineRpc({
  name: "firstmate.crew.exit",
  input: crewInput,
  output: z.object({}),
});

/**
 * A fresh crewmate in the same worktree. The first mate does it, because it
 * owns the brief and the backlog; this only carries the captain's note.
 */
export const relaunchCrew = defineRpc({
  name: "firstmate.crew.relaunch",
  input: crewInput.extend({ note: z.string().min(1) }),
  output: z.object({ agentId: z.string() }),
});
