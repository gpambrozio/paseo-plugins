/**
 * The board, assembled on the daemon: the first mate, every crewmate Paseo
 * knows by its labels, the backlog the first mate keeps, and each crewmate's
 * last status line — joined into cards and filed into columns.
 *
 * Nothing here is cached across calls except the status lines, and those are
 * keyed by the agent's `updatedAt`: a crewmate that has not moved is not asked
 * for its timeline again, which is what keeps a poll every few seconds cheap
 * with a large crew.
 */
import { realpath } from "node:fs/promises";

import {
  CREW_LABELS,
  type AgentSummary,
  type BacklogItem,
  type ColumnId,
  type CrewReportSummary,
  type FirstmateConfig,
  type Fleet,
  type FleetCard,
  type WatchSummary,
} from "../shared/fleet";
import { resolveHome } from "./config";
import { parseCrewReport, reportUrl } from "./crew-report";
import { readCharterState } from "./charter-file";
import { isHomeReady, readBacklog, readProjects, readSuggestions } from "./home";
import type { TopicMessage } from "../shared/topics";
import type { AgentListOptions, PaseoAgent, PaseoApi, TimelineItem } from "./host-types";
import type { TopicLog } from "./topic-log";

const PAGE_SIZE = 200;
/** Enough of a timeline to reach back past a turn's last tool calls to its closing message. */
const REPORT_TAIL = 30;

export function summarizeAgent(agent: PaseoAgent): AgentSummary {
  return {
    id: agent.id,
    workspaceId: agent.workspaceId ?? null,
    title: agent.title,
    provider: agent.provider,
    model: agent.model,
    status: agent.status,
    cwd: agent.cwd,
    pendingPermissions: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention === true,
    lastError: agent.lastError ?? null,
    updatedAt: agent.updatedAt,
    labels: agent.labels,
  };
}

/** Every agent matching `filter`, across pages, archived ones excluded. */
export async function listAgents(
  paseo: PaseoApi,
  filter: NonNullable<AgentListOptions["filter"]> = {},
): Promise<PaseoAgent[]> {
  const agents: PaseoAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({
      filter,
      page: cursor === undefined ? { limit: PAGE_SIZE } : { limit: PAGE_SIZE, cursor },
    });
    agents.push(...page.entries.map((entry) => entry.agent));
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return agents.filter((agent) => agent.archivedAt === null || agent.archivedAt === undefined);
}

/**
 * The first mate: the agent the config names, while Paseo still has it.
 *
 * The config is the only source. The agent also carries a `firstmate.role`
 * label, but that is for people (`paseo ls --label firstmate.role=first-mate`)
 * and is not consulted here: the SDK cannot take a label off, so falling back
 * to it would bring a released first mate straight back.
 */
export async function resolveMate(
  paseo: PaseoApi,
  config: FirstmateConfig,
): Promise<{ agent: PaseoAgent | null; missing: boolean }> {
  const configured = config.mateAgentId.trim();
  if (configured === "") return { agent: null, missing: false };
  const agent = await fetchLiveAgent(paseo, configured);
  return agent === null ? { agent: null, missing: true } : { agent, missing: false };
}

/**
 * One agent, or null when Paseo no longer has it or has archived it. The
 * daemon answers an unknown id with an error ("Agent not found: …") rather
 * than an empty result, so that error is the null; anything else — the
 * daemon unreachable, a timeout — is thrown, because "your first mate is
 * gone" is the wrong thing to say about a hiccup.
 */
export async function fetchLiveAgent(paseo: PaseoApi, agentId: string): Promise<PaseoAgent | null> {
  let found: Awaited<ReturnType<ReturnType<PaseoApi["agents"]["ref"]>["refresh"]>>;
  try {
    found = await paseo.agents.ref(agentId).refresh();
  } catch (error) {
    if (error instanceof Error && /not found|unknown agent|no agent/i.test(error.message)) return null;
    throw error;
  }
  const agent = found?.agent ?? null;
  if (agent === null || (agent.archivedAt !== null && agent.archivedAt !== undefined)) return null;
  return agent;
}

/**
 * The text a turn closed with: the assistant messages at the very end of the
 * timeline, joined, since a streamed reply can arrive as several items. Any
 * other item — a tool call, the user's message — ends the search.
 */
export function closingText(items: readonly TimelineItem[]): string | null {
  return closingRun(items)?.text ?? null;
}

/** Where the closing text starts, and the text. */
function closingRun(items: readonly TimelineItem[]): { start: number; text: string } | null {
  const parts: string[] = [];
  let start = items.length;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item === undefined) break;
    if (item.type === "assistant_message") {
      parts.unshift(item.text);
      start = index;
      continue;
    }
    // Plugin rows and notices can land after a turn without being part of it.
    if (item.type === "plugin" || item.type === "notification") continue;
    break;
  }
  const text = parts.join("");
  return text.trim() === "" ? null : { start, text };
}

/** `closingText` as a message from agent `agentId`, identified and dated by the entry it starts at. */
export function closingMessage(
  agentId: string,
  entries: readonly { item: TimelineItem; seqStart: number; timestamp: string }[],
): TopicMessage | null {
  const run = closingRun(entries.map((entry) => entry.item));
  const first = run === null ? undefined : entries[run.start];
  if (run === null || first === undefined) return null;
  return { id: `${agentId}:${first.seqStart}`, from: "agent", text: run.text, at: first.timestamp };
}

interface CachedReport {
  updatedAt: string;
  report: CrewReportSummary | null;
  closing: TopicMessage | null;
}

/** Each crewmate's last status line, re-read only when the agent has moved. */
export class ReportCache {
  private readonly reports = new Map<string, CachedReport>();

  /** The agent's closing words as of the last read, for a card with no status line to show. */
  closingFor(agentId: string): TopicMessage | null {
    return this.reports.get(agentId)?.closing ?? null;
  }

  async reportFor(paseo: PaseoApi, agent: PaseoAgent): Promise<CrewReportSummary | null> {
    const cached = this.reports.get(agent.id);
    // A running turn has not closed yet, so its timeline holds no new status
    // line; the previous one stays on the card until it does.
    if (agent.status === "running" || agent.status === "initializing") return cached?.report ?? null;
    if (cached !== undefined && cached.updatedAt === agent.updatedAt) return cached.report;
    const page = await paseo.agents
      .ref(agent.id)
      .timeline.refetch({ direction: "tail", limit: REPORT_TAIL, projection: "projected" });
    const closing = closingMessage(agent.id, page.entries);
    const report = parseCrewReport(closing?.text ?? null);
    this.reports.set(agent.id, { updatedAt: agent.updatedAt, report, closing });
    return report;
  }

  /** Drops agents no longer in the crew, so the map cannot grow for the life of the daemon. */
  retain(ids: ReadonlySet<string>): void {
    for (const id of this.reports.keys()) {
      if (!ids.has(id)) this.reports.delete(id);
    }
  }
}

/**
 * Where a crewmate belongs. What Paseo knows wins while the agent is busy or
 * stuck — a pending permission, an error, a turn in flight — and the status
 * line decides once its turn has ended. A live crewmate is never Done, even
 * after `done:` or `resolved:`: the task has landed only once the backlog says
 * so, and until then the first mate still has work to do with it.
 */
export function crewColumn(agent: AgentSummary, report: CrewReportSummary | null): ColumnId {
  if (agent.pendingPermissions > 0) return "blocked";
  if (agent.status === "error") return "failed";
  if (agent.status === "running" || agent.status === "initializing") return "working";
  switch (report?.state) {
    case "failed":
      return "failed";
    case "blocked":
    case "needs-decision":
      return "blocked";
    case "paused":
      return "parked";
    default:
      // Finished and waiting on the first mate, stopped without saying why,
      // or said "working" and then stopped.
      return "idle";
  }
}

/** Where a backlog item with no crewmate on it belongs. */
export function backlogColumn(item: BacklogItem): ColumnId {
  if (item.section === "done") return "done";
  if (item.section === "in-flight") return "idle";
  if (item.kind === "captain" || item.hold !== null) return "blocked";
  return "queued";
}

const AGENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The agents unfinished backlog items name by a full UUID that no crewmate or the first mate already is, once each. An item
 * made by hand, or by a first mate that skipped the crew labels, has its own agent with no label for the
 * board to find it by. A prefix or a note about another daemon is no UUID and is left alone.
 */
export function ownAgentIds(backlog: readonly BacklogItem[], takenIds: ReadonlySet<string>): string[] {
  const ids = backlog.flatMap((item) =>
    item.section !== "done" && item.agentId !== null && AGENT_UUID.test(item.agentId) ? [item.agentId] : [],
  );
  return [...new Set(ids)].filter((id) => !takenIds.has(id));
}

export interface CrewMember {
  agent: AgentSummary;
  report: CrewReportSummary | null;
  /** What the agent last said; shown on its card only while the card has no status line. */
  closing?: TopicMessage | null;
}

/** The later of two messages by time; either may be absent. */
function newerMessage(a: TopicMessage | null, b: TopicMessage | null): TopicMessage | null {
  if (a === null || b === null) return a ?? b;
  return Date.parse(b.at) > Date.parse(a.at) ? b : a;
}

/**
 * Crewmates and backlog items joined into cards. A crewmate is matched to its
 * item by the task label, or by the agent id the item recorded; whatever is
 * left over on either side is a card of its own. `latest` is the newest message filed under each backlog
 * item, by its id.
 */
export function buildCards(
  backlog: readonly BacklogItem[],
  crew: readonly CrewMember[],
  latest: ReadonlyMap<string, TopicMessage> = new Map(),
): FleetCard[] {
  const cards: FleetCard[] = [];
  const claimed = new Set<number>();

  const byUpdate = [...crew].sort((a, b) => b.agent.updatedAt.localeCompare(a.agent.updatedAt));
  for (const member of byUpdate) {
    const taskId = member.agent.labels[CREW_LABELS.task] ?? null;
    const index = backlog.findIndex(
      (item, position) =>
        !claimed.has(position) &&
        item.section !== "done" &&
        ((taskId !== null && item.id === taskId) || item.agentId === member.agent.id),
    );
    const item = index === -1 ? null : (backlog[index] ?? null);
    if (index !== -1) claimed.add(index);
    cards.push({
      key: `agent:${member.agent.id}`,
      column: crewColumn(member.agent, member.report),
      taskId: taskId ?? item?.id ?? null,
      title: item?.title ?? member.agent.title ?? taskId ?? "Untitled crewmate",
      project: member.agent.labels[CREW_LABELS.project] ?? item?.project ?? null,
      kind: member.agent.labels[CREW_LABELS.kind] ?? item?.kind ?? null,
      backlog: item,
      agent: member.agent,
      report: member.report,
      url: (member.report === null ? null : reportUrl(member.report.text)) ?? item?.url ?? null,
      lastMessage: newerMessage(
        (item === null ? null : latest.get(item.id)) ?? null,
        member.report === null ? member.closing ?? null : null,
      ),
    });
  }

  backlog.forEach((item, index) => {
    if (claimed.has(index)) return;
    cards.push({
      key: `backlog:${item.section}:${item.id}:${index}`,
      column: backlogColumn(item),
      taskId: item.id,
      title: item.title,
      project: item.project,
      kind: item.kind,
      backlog: item,
      agent: null,
      report: null,
      url: item.url,
      lastMessage: latest.get(item.id) ?? null,
    });
  });
  return cards;
}

/** Whether two paths name one directory, through symlinks; a path that does not resolve is compared as written. */
export async function sameDirectory(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([realpath(a).catch(() => a), realpath(b).catch(() => b)]);
  return left === right;
}

/**
 * Whether agents get Paseo's own tools. Without them the first mate can talk
 * but cannot start a crewmate or hear from one, so the board says so up front.
 */
export async function readAgentTools(paseo: PaseoApi): Promise<boolean | null> {
  try {
    const { config } = await paseo.config.get();
    return config.mcp.injectIntoAgents === true;
  } catch (error) {
    console.error("[firstmate] could not read the daemon config:", error);
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Files the first mate's conversation, when there is a first mate, and returns the newest message of each topic. */
async function fileTopics(topics: TopicLog, paseo: PaseoApi, mate: PaseoAgent | null) {
  if (mate !== null) await topics.sync(paseo, mate);
  return topics.latest();
}

export async function loadFleet(
  paseo: PaseoApi,
  config: FirstmateConfig,
  reports: ReportCache,
  watchSummaries: () => Promise<WatchSummary[]> = async () => [],
  topics: TopicLog | null = null,
): Promise<Fleet> {
  const home = resolveHome(config);
  const warnings: string[] = [];

  const [homeReady, backlog, projects, suggestions, mate, crewAgents, agentTools, charter, watches] = await Promise.all([
    isHomeReady(home),
    readBacklog(home).catch((error: unknown) => {
      warnings.push(`The backlog could not be read: ${describe(error)}`);
      return [];
    }),
    readProjects(home).catch((error: unknown) => {
      warnings.push(`The project registry could not be read: ${describe(error)}`);
      return [];
    }),
    readSuggestions(home).catch((error: unknown) => {
      warnings.push(`The suggestions could not be read: ${describe(error)}`);
      return [];
    }),
    (async function mateWithTopics() {
      const resolved = await resolveMate(paseo, config);
      const latest =
        topics === null
          ? new Map<string, TopicMessage>()
          : await fileTopics(topics, paseo, resolved.agent).catch((error: unknown) => {
              warnings.push(`The topics could not be filed: ${describe(error)}`);
              return new Map<string, TopicMessage>();
            });
      return { ...resolved, latest };
    })(),
    listAgents(paseo, { labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole } }).catch((error: unknown) => {
      warnings.push(`Paseo could not list the crew: ${describe(error)}`);
      return [];
    }),
    readAgentTools(paseo),
    readCharterState(home).catch((error: unknown) => {
      warnings.push(`The charter could not be read: ${describe(error)}`);
      return null;
    }),
    watchSummaries().catch((error: unknown) => {
      warnings.push(`The watches could not be read: ${describe(error)}`);
      return [];
    }),
  ]);

  const ownAgents = (
    await Promise.all(
      ownAgentIds(backlog, new Set([...crewAgents.map((agent) => agent.id), ...(mate.agent === null ? [] : [mate.agent.id])])).map((id) =>
        fetchLiveAgent(paseo, id).catch((error: unknown) => {
          warnings.push(`Paseo could not look up agent ${id}: ${describe(error)}`);
          return null;
        }),
      ),
    )
  ).filter((agent): agent is PaseoAgent => agent !== null);
  const boardAgents = [...crewAgents, ...ownAgents];

  reports.retain(new Set(boardAgents.map((agent) => agent.id)));
  const crew = await Promise.all(
    boardAgents.map(async (agent) => ({
      agent: summarizeAgent(agent),
      report: await reports.reportFor(paseo, agent).catch((error: unknown) => {
        console.error(`[firstmate] could not read the status line of ${agent.id}:`, error);
        return null;
      }),
      closing: reports.closingFor(agent.id),
    })),
  );

  return {
    home,
    homeReady,
    mate: mate.agent === null ? null : summarizeAgent(mate.agent),
    mateMissing: mate.missing,
    mateInHome: mate.agent === null ? true : await sameDirectory(mate.agent.cwd, home),
    cards: buildCards(backlog, crew, mate.latest),
    projects,
    suggestions,
    watches,
    agentTools,
    // A home nobody has launched in has no charter of the captain's to be out of date.
    charterOutdated: homeReady && charter !== null && charter.outdated,
    warnings,
  };
}
