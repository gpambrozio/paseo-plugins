/**
 * The first mate's backlog, `data/backlog.md` in its home.
 *
 * The first mate writes it with its own file tools and the board reads it, so
 * the format is a contract between an agent and a parser. It is kept to what
 * an agent reliably reproduces — three headings and one line per item — and the
 * parser is lenient about everything else: unknown `(key: value)` groups are
 * kept as notes, a missing field is `null`, and a line it cannot read is
 * skipped rather than failing the board.
 *
 *     ## In flight
 *     - [ ] fix-flaky-login - Fix the flaky login test (project: web) (kind: ship) (mode: direct-PR) (agent: 3f2a…)
 *     ## Queued
 *     - [ ] dark-mode - Add dark mode (project: web) (blocked-by: fix-flaky-login)
 *     - [ ] pick-db - Choose the database (kind: captain) (hold: Postgres or SQLite?)
 *     ## Done
 *     - [x] fix-typo - Fix the typo https://github.com/you/web/pull/41 (merged 2026-09-21)
 *
 * The item shape is `BacklogItem` in `shared/fleet.ts`, which the board draws.
 */
import type { BacklogItem, BacklogSection } from "../shared/fleet";

const SECTION_HEADINGS: ReadonlyArray<[RegExp, BacklogSection]> = [
  [/^in[\s-]*flight\b/i, "in-flight"],
  [/^(queued|queue|next|charted)\b/i, "queued"],
  [/^(done|landed|finished)\b/i, "done"],
];

const ITEM_LINE = /^\s*[-*]\s+\[([ xX~-])\]\s+(.+)$/;
const GROUP = /\(([a-zA-Z][\w-]*)\s*:\s*([^()]*)\)/g;
const OUTCOME = /\((merged|done|landed|closed|failed|abandoned)\s+([^()]*)\)/i;
/** `(since 2026-09-20)`, which the charter spells without a colon. */
const SINCE = /\(since\s+([^():]*)\)/i;
const URL = /https?:\/\/[^\s()<>]+/;
const REPORT_PATH = /\bdata\/[\w.-]+\/report\.md\b/;
/** `id - title`, with an en or em dash accepted as the separator too. */
const ID_AND_TITLE = /^([\w.-]{1,64})\s+[-–—]\s+(.*)$/;

function sectionOf(heading: string): BacklogSection | null {
  const text = heading.trim();
  for (const [pattern, section] of SECTION_HEADINGS) {
    if (pattern.test(text)) return section;
  }
  return null;
}

function field(groups: Map<string, string>, ...names: string[]): string | null {
  for (const name of names) {
    const value = groups.get(name)?.trim();
    if (value !== undefined && value !== "") return value;
  }
  return null;
}

function parseItem(section: BacklogSection, body: string): BacklogItem | null {
  const groups = new Map<string, string>();
  for (const match of body.matchAll(GROUP)) {
    groups.set((match[1] ?? "").toLowerCase(), match[2] ?? "");
  }
  // `blocked-by: x` is written bare as often as in parentheses.
  const bareBlocker = /\bblocked-by:\s*([\w.-]+)/i.exec(body.replace(GROUP, ""));

  const withoutGroups = body.replace(GROUP, "").replace(OUTCOME, "").replace(SINCE, "").trim();
  const head = ID_AND_TITLE.exec(withoutGroups);
  const id = head?.[1] ?? withoutGroups.split(/\s+/)[0] ?? "";
  if (id === "") return null;
  const rest = head?.[2] ?? withoutGroups.slice(id.length);

  const url = URL.exec(body)?.[0] ?? null;
  const reportPath = REPORT_PATH.exec(body)?.[0] ?? null;
  const title = rest
    .replace(URL, "")
    .replace(REPORT_PATH, "")
    .replace(/\bblocked-by:\s*[\w.-]+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const outcome = OUTCOME.exec(body);

  return {
    section,
    id,
    title: title === "" ? id : title,
    project: field(groups, "project", "repo"),
    kind: field(groups, "kind")?.toLowerCase() ?? null,
    mode: field(groups, "mode"),
    agentId: field(groups, "agent", "crewmate"),
    hold: field(groups, "hold"),
    blockedBy: field(groups, "blocked-by") ?? bareBlocker?.[1] ?? null,
    since: field(groups, "since") ?? SINCE.exec(body)?.[1]?.trim() ?? null,
    url,
    reportPath: reportPath ?? field(groups, "report"),
    outcome: outcome === null ? null : `${outcome[1]?.toLowerCase()} ${outcome[2]?.trim()}`.trim(),
  };
}

/** Every item under the three known headings, in file order. Anything else is ignored. */
export function parseBacklog(markdown: string): BacklogItem[] {
  const items: BacklogItem[] = [];
  let section: BacklogSection | null = null;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^#{2,3}\s+(.*)$/.exec(line);
    if (heading !== null) {
      section = sectionOf(heading[1] ?? "");
      continue;
    }
    if (section === null) continue;
    const item = ITEM_LINE.exec(line);
    if (item === null) continue;
    const parsed = parseItem(section, item[2] ?? "");
    if (parsed !== null) items.push(parsed);
  }
  return items;
}

/** What a new home's backlog starts as: the three headings and nothing under them. */
export const EMPTY_BACKLOG = `# Backlog

Work items only, one line each. The first mate keeps this file; the FirstMate board reads it.

## In flight

## Queued

## Done
`;
