import { describe, expect, it } from "vitest";

import { EMPTY_BACKLOG, parseBacklog } from "./backlog";

const SAMPLE = `# Backlog

Some prose the first mate wrote, which is not an item.

## In flight
- [ ] fix-flaky-login - Fix the flaky login test (project: web) (kind: ship) (mode: direct-PR) (agent: 3f2a9c) (since 2026-09-20)

## Queued
- [ ] dark-mode - Add dark mode (project: web) blocked-by: fix-flaky-login
- [ ] pick-db - Choose the database (kind: captain) (hold: Postgres or SQLite?)

## Done
- [x] fix-typo - Fix the typo https://github.com/you/web/pull/41 (merged 2026-09-21)
- [x] scout-auth - Why logins time out data/scout-auth/report.md (done 2026-09-19)
`;

describe("parseBacklog", () => {
  it("reads every item under the three headings, in file order", () => {
    expect(parseBacklog(SAMPLE).map((item) => `${item.section}:${item.id}`)).toEqual([
      "in-flight:fix-flaky-login",
      "queued:dark-mode",
      "queued:pick-db",
      "done:fix-typo",
      "done:scout-auth",
    ]);
  });

  it("keeps the fields the board draws and leaves the title clean", () => {
    const [flight, dark, pick, typo, scout] = parseBacklog(SAMPLE);
    expect(flight).toMatchObject({
      title: "Fix the flaky login test",
      project: "web",
      kind: "ship",
      mode: "direct-PR",
      agentId: "3f2a9c",
      since: "2026-09-20",
    });
    expect(dark).toMatchObject({ title: "Add dark mode", blockedBy: "fix-flaky-login" });
    expect(pick).toMatchObject({ kind: "captain", hold: "Postgres or SQLite?" });
    expect(typo).toMatchObject({
      title: "Fix the typo",
      url: "https://github.com/you/web/pull/41",
      outcome: "merged 2026-09-21",
    });
    expect(scout).toMatchObject({ reportPath: "data/scout-auth/report.md", outcome: "done 2026-09-19" });
  });

  it("accepts the headings and dashes an agent drifts into", () => {
    const items = parseBacklog(`### In-flight\n* [ ] a — Alpha\n## Next\n- [ ] b – Beta\n## Landed\n- [X] c - Gamma`);
    expect(items.map((item) => [item.section, item.id, item.title])).toEqual([
      ["in-flight", "a", "Alpha"],
      ["queued", "b", "Beta"],
      ["done", "c", "Gamma"],
    ]);
  });

  it("ignores items outside a known section, and an empty backlog has none", () => {
    expect(parseBacklog("- [ ] stray - Not under a heading\n## Ideas\n- [ ] x - Nope")).toEqual([]);
    expect(parseBacklog(EMPTY_BACKLOG)).toEqual([]);
  });
});
