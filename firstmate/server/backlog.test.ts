import { describe, expect, it } from "vitest";

import { parseBacklog, takeActions } from "./backlog";
import { TEMPLATES, readTemplate } from "./templates";

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

  it("reads an In flight item's pull request and leaves the review head out of its title", () => {
    const [item] = parseBacklog(
      "## In flight\n- [ ] fix-login - Fix login https://github.com/you/web/pull/42 (project: web) (agent: 3f2a9c) (hold: merge) (review-head: 0a1b2c3d)",
    );
    expect(item).toMatchObject({
      title: "Fix login",
      url: "https://github.com/you/web/pull/42",
      agentId: "3f2a9c",
      hold: "merge",
    });
  });

  it("accepts the headings and dashes an agent drifts into", () => {
    const items = parseBacklog(`### In-flight\n* [ ] a — Alpha\n## Next\n- [ ] b – Beta\n## Landed\n- [X] c - Gamma`);
    expect(items.map((item) => [item.section, item.id, item.title])).toEqual([
      ["in-flight", "a", "Alpha"],
      ["queued", "b", "Beta"],
      ["done", "c", "Gamma"],
    ]);
  });

  it("ignores items outside a known section, and a new home's backlog has none", async () => {
    expect(parseBacklog("- [ ] stray - Not under a heading\n## Ideas\n- [ ] x - Nope")).toEqual([]);
    expect(parseBacklog(await readTemplate(TEMPLATES.backlog))).toEqual([]);
  });

  it("reads a held item's actions and keeps them out of its title, URL and fields", () => {
    const [item] = parseBacklog(
      "## In flight\n- [ ] fix-login - Fix login https://github.com/you/web/pull/42 (project: web) (hold: merge?) " +
        "(actions: Merge => Merge https://github.com/you/web/pull/42 (project: web) | Wait => Leave web#42 open until Monday) (review-head: 0a1b2c3d)",
    );
    expect(item).toMatchObject({
      title: "Fix login",
      url: "https://github.com/you/web/pull/42",
      project: "web",
      hold: "merge?",
      actions: [
        { label: "Merge", prompt: "Merge https://github.com/you/web/pull/42 (project: web)" },
        { label: "Wait", prompt: "Leave web#42 open until Monday" },
      ],
    });
  });

  it("reads actions on an item with no hold, and none where there is no field", () => {
    const [listed, none] = parseBacklog("## Queued\n- [ ] a - Alpha (actions: Go => Start a)\n- [ ] b - Beta");
    expect(listed?.actions).toEqual([{ label: "Go", prompt: "Start a" }]);
    expect(none?.actions).toEqual([]);
  });

  it("drops an unclosed actions field and still reads the rest of the line", () => {
    const [item] = parseBacklog("## Queued\n- [ ] pick-db - Choose the database (kind: captain) (hold: which?) (actions: Postgres => Use (Postgres");
    expect(item).toMatchObject({ id: "pick-db", title: "Choose the database", kind: "captain", hold: "which?", actions: [] });
  });
});

// The same cases as bb's FirstMate (`firstmate-crew/server/backlog.test.ts`), which reads the field by the same rules.
describe("takeActions", () => {
  const actionsOf = (field: string) => takeActions(`x - Title ${field} (project: web)`).actions;

  it("returns the line without the field", () => {
    expect(takeActions("x - Title (actions: A => a) (project: web)").rest).toBe("x - Title  (project: web)");
  });

  it("runs the field to its balanced closing parenthesis, URLs with parentheses included", () => {
    expect(actionsOf("(actions: Read => Read https://en.wikipedia.org/wiki/Fish_(disambiguation) and (briefly) sum it up)")).toEqual([
      { label: "Read", prompt: "Read https://en.wikipedia.org/wiki/Fish_(disambiguation) and (briefly) sum it up" },
    ]);
  });

  it("keeps full URLs whole, query strings and fragments included", () => {
    expect(actionsOf("(actions: Open => Look at https://example.com/a?b=c&d=e#f:g)")).toEqual([
      { label: "Open", prompt: "Look at https://example.com/a?b=c&d=e#f:g" },
    ]);
  });

  it("reads \\| as a pipe and \\( \\) as lone parentheses", () => {
    expect(actionsOf(String.raw`(actions: Pipe => Run a \| b | Smile => Reply :\) and 1\( | Slash => Keep a\\b and C:\Users)`)).toEqual([
      { label: "Pipe", prompt: "Run a | b" },
      { label: "Smile", prompt: "Reply :) and 1(" },
      { label: "Slash", prompt: String.raw`Keep a\b and C:\Users` },
    ]);
  });

  it("splits on every unescaped pipe, spaced or not", () => {
    expect(actionsOf("(actions: A => a|B => b)")).toEqual([
      { label: "A", prompt: "a" },
      { label: "B", prompt: "b" },
    ]);
  });

  it("splits each button at its first spaced =>, so a prompt may hold more", () => {
    expect(actionsOf("(actions: Map => Rename a => b and c=>d)")).toEqual([{ label: "Map", prompt: "Rename a => b and c=>d" }]);
    expect(actionsOf("(actions: a=>b => Use b)")).toEqual([{ label: "a=>b", prompt: "Use b" }]);
  });

  it("skips buttons with no spaced =>, an empty label or an empty prompt", () => {
    expect(actionsOf("(actions: Just words | Tight=>prompt | => no label | No prompt => | Good => yes |  )")).toEqual([
      { label: "Good", prompt: "yes" },
    ]);
  });

  it("is case-insensitive about the key, and the first field gives the buttons", () => {
    const taken = takeActions("x - T (Actions : A => a) (actions: B => b)");
    expect(taken.actions).toEqual([{ label: "A", prompt: "a" }]);
    expect(taken.rest.trim()).toBe("x - T");
  });

  it("leaves an (actions: inside another group as that group's text", () => {
    const line =
      "x - Title (hold: Explain (actions: Merge => Merge https://github.com/you/web/pull/42) before proceeding) " +
      "(actions: Wait => Wait for approval) (project: web)";
    const taken = takeActions(line);
    expect(taken.actions).toEqual([{ label: "Wait", prompt: "Wait for approval" }]);
    expect(taken.rest).toBe(
      "x - Title (hold: Explain (actions: Merge => Merge https://github.com/you/web/pull/42) before proceeding)  (project: web)",
    );
  });

  it("gives no buttons, and suppresses nothing, for an (actions: that only appears inside another group", () => {
    expect(takeActions("x - T (note: write (actions: syntax) like this) (project: web)")).toEqual({
      rest: "x - T (note: write (actions: syntax) like this) (project: web)",
      actions: [],
    });
    expect(takeActions("x - T (note: see (actions: syntax)) (actions: Go => Start x)").actions).toEqual([{ label: "Go", prompt: "Start x" }]);
  });

  it("reads the real field of a line whose hold mentions (actions:", () => {
    // A hold holding parentheses is beyond the other fields' reader either way; only the buttons are at stake here.
    const [item] = parseBacklog(
      "## Queued\n- [ ] pick-db - Choose the database (kind: captain) (hold: answer with (actions: Merge => Merge it) later) (actions: Postgres => Use Postgres)",
    );
    expect(item).toMatchObject({ id: "pick-db", kind: "captain", actions: [{ label: "Postgres", prompt: "Use Postgres" }] });
  });

  it("finds a field after a stray closing parenthesis outside any group", () => {
    expect(takeActions("x - Smile :) (actions: Go => Start x)")).toEqual({ rest: "x - Smile :) ", actions: [{ label: "Go", prompt: "Start x" }] });
  });

  it("never throws on odd input", () => {
    for (const field of ["(actions:", "(actions:)", "(actions: \\", "(actions: ((((", "(actions: ) ) )", "(actions: =>=>|||)"]) {
      expect(() => takeActions(field)).not.toThrow();
    }
    expect(actionsOf("(actions:)")).toEqual([]);
  });
});
