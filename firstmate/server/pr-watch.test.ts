/**
 * The built-in PR watch (`templates/watches/pr-watch`), run as the runner runs it — seeded into a
 * temporary home, executed by its `#!` line — against a stand-in `gh` that answers from a fixture file.
 */
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runWatchScript } from "./watch-run";
import { seedWatches } from "./watch-files";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const A = "https://github.com/me/web/pull/42";
const B = "https://github.com/getpaseo/paseo/pull/7";
const DONE = "https://github.com/me/web/pull/1";
const DONE_EARLIER = "https://github.com/me/web/pull/2";

/** Answers `gh api user` and `gh pr view <url>` from $FAKE_GH, and logs every call to $FAKE_GH_LOG. */
const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, args.join(" ") + "\\n");
const fixture = JSON.parse(fs.readFileSync(process.env.FAKE_GH, "utf8"));
if (args[0] === "api" && args[1] === "user") {
  if (!fixture.user) { process.stderr.write("gh: not logged in\\n"); process.exit(1); }
  process.stdout.write(fixture.user + "\\n");
} else if (args[0] === "pr" && args[1] === "view") {
  const pull = fixture.prs[args[2]];
  if (!pull || pull.error) { process.stderr.write("GraphQL: " + (pull ? pull.error : "not found") + "\\n"); process.exit(1); }
  setTimeout(() => process.stdout.write(JSON.stringify(pull)), pull.delayMs || 0);
} else { process.exit(2); }
`;

interface Pull {
  state?: string;
  title?: string;
  reviews?: Array<{ id: string; author: { login: string }; state: string; body: string }>;
  comments?: Array<{ id: string; author: { login: string }; body: string }>;
  statusCheckRollup?: Array<Record<string, string>>;
  error?: string;
  /** How long the stand-in takes to answer. */
  delayMs?: number;
}

function pull(overrides: Pull = {}): Pull {
  return { state: "OPEN", title: "A change", reviews: [], comments: [], statusCheckRollup: [], ...overrides };
}

const passing = [{ __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" }];
const pending = [{ __typename: "CheckRun", name: "build", status: "IN_PROGRESS", conclusion: "" }];
const failing = [
  { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "FAILURE" },
  { __typename: "StatusContext", context: "ci/lint", state: "ERROR" },
];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "firstmate-prwatch-"));
  tempDirs.push(root);
  const home = join(root, "home");
  // PATH is only these, so no real gh on the machine can answer: `bin` has the stand-in and node,
  // `noGh` has node alone.
  const bin = join(root, "bin");
  const noGh = join(root, "no-gh");
  const state = join(root, "state");
  await Promise.all([mkdir(join(home, "data"), { recursive: true }), mkdir(bin), mkdir(noGh), mkdir(state)]);
  await seedWatches(home);
  await writeFile(join(bin, "gh"), FAKE_GH, "utf8");
  await chmod(join(bin, "gh"), 0o755);
  await symlink(process.execPath, join(bin, "node"));
  await symlink(process.execPath, join(noGh, "node"));
  await writeFile(
    join(home, "data", "backlog.md"),
    [
      "# Backlog",
      "## In flight",
      `- [ ] web-fix - Fix the web ${A} (project: web) (hold: merge)`,
      "## Queued",
      `- [ ] upstream - Upstream the thing ${B} (project: paseo) and again ${B}`,
      "## Done",
      `- [x] old - Old work ${DONE} (merged 2026-09-01)`,
      "### August",
      `- [x] older - Older work ${DONE_EARLIER} (merged 2026-08-01)`,
    ].join("\n"),
    "utf8",
  );
  const fixture = join(root, "gh.json");
  const log = join(root, "gh.log");
  await writeFile(log, "", "utf8");

  async function answer(prs: Record<string, Pull>, user: string | null = "me"): Promise<void> {
    await writeFile(fixture, JSON.stringify({ user, prs }), "utf8");
  }

  async function run(path = bin, extra: NodeJS.ProcessEnv = {}) {
    return runWatchScript(join(home, "watches", "pr-watch"), {
      cwd: home,
      env: {
        PATH: path,
        FIRSTMATE_HOME: home,
        FIRSTMATE_BACKLOG: join(home, "data", "backlog.md"),
        FIRSTMATE_WATCH_NAME: "pr-watch",
        FIRSTMATE_WATCH_STATE: state,
        FAKE_GH: fixture,
        FAKE_GH_LOG: log,
        ...extra,
      },
      timeoutMs: 20_000,
      maxOutputBytes: 64_000,
      maxErrorBytes: 4000,
    });
  }

  return { answer, run, log, state, home, noGh };
}

describe("pr-watch", () => {
  it("records a baseline silently, then prints only what changed", async () => {
    const { answer, run, log, state } = await setup();
    await answer({ [A]: pull({ statusCheckRollup: pending }), [B]: pull({ title: "Upstream it", statusCheckRollup: passing }) });

    let result = await run();
    expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    // Looked up together, so in no particular order; nothing under Done, however deep.
    expect(calls.filter((call) => call.startsWith("pr view")).map((call) => call.split(" ")[2]).sort()).toEqual([B, A].sort());
    expect(Object.keys(JSON.parse(await readFile(join(state, "prs.json"), "utf8")).prs).sort()).toEqual([B, A].sort());

    await answer({
      [A]: pull({ state: "MERGED", statusCheckRollup: passing }),
      [B]: pull({
        title: "Upstream it",
        statusCheckRollup: failing,
        reviews: [{ id: "r1", author: { login: "maintainer" }, state: "CHANGES_REQUESTED", body: "Please   rename\nthis." }],
        comments: [
          { id: "c1", author: { login: "me" }, body: "The crew's own comment" },
          { id: "c2", author: { login: "someone" }, body: "x".repeat(300) },
        ],
      }),
    });
    result = await run();
    expect(result.code).toBe(0);
    // One block for the whole run: a header, a line per change with the same prefix, then the links.
    expect(result.stdout).toBe(
      [
        "Pull requests on the backlog, since the last check (5 changes):",
        "- me/web#42 merged",
        "- me/web#42 checks turned green",
        '- getpaseo/paseo#7 new review from maintainer, changes requested: "Please rename this."',
        `- getpaseo/paseo#7 new comment from someone: "${"x".repeat(200)}…"`,
        "- getpaseo/paseo#7 checks turned red: build, ci/lint",
        "",
        `me/web#42: A change — ${A}`,
        `getpaseo/paseo#7: Upstream it — ${B}`,
        "",
      ].join("\n"),
    );

    result = await run();
    expect(result).toMatchObject({ code: 0, stdout: "" });
  });

  it("stays inside its time budget on a slow backlog, and reaches what it skipped on the next run", async () => {
    const { answer, run, state, home } = await setup();
    const urls = [1, 2, 3, 4, 5, 6].map((n) => `https://github.com/someone/lib/pull/${n}`);
    await writeFile(join(home, "data", "backlog.md"), `## In flight\n${urls.map((url) => `- [ ] x ${url}`).join("\n")}\n`, "utf8");
    await answer(Object.fromEntries(urls.map((url) => [url, pull({ delayMs: 800 })])));
    const budget = { FIRSTMATE_PR_WATCH_BUDGET_MS: "400" };
    const saved = async () => JSON.parse(await readFile(join(state, "prs.json"), "utf8")).prs as Record<string, { seen?: boolean }>;

    const first = await run(undefined, budget);
    expect(first).toMatchObject({ code: 0, stdout: "" });
    // Four at a time, and none started after the budget: the last two wait for the next run.
    expect(Object.keys(await saved()).sort()).toEqual(urls.slice(0, 4));

    await run(undefined, budget);
    const after = await saved();
    expect(Object.keys(after).sort()).toEqual(urls);
    expect(Object.values(after).every((entry) => entry.seen === true)).toBe(true);
  });

  it("mentions a pull request gh keeps failing on once, and fails the run when gh can read none", async () => {
    const { answer, run } = await setup();
    await answer({ [A]: pull(), [B]: pull() });
    await run();

    await answer({ [A]: { error: "Could not resolve to a PullRequest" }, [B]: pull() });
    expect((await run()).stdout).toBe("");
    expect((await run()).stdout).toBe("");
    const third = await run();
    expect(third.code).toBe(0);
    expect(third.stdout).toBe(
      [
        "Pull requests on the backlog, since the last check (1 change):",
        "- me/web#42 gh cannot read it (GraphQL: Could not resolve to a PullRequest); nothing more about it until it can",
        "",
        `me/web#42: A change — ${A}`,
        "",
      ].join("\n"),
    );
    expect((await run()).stdout).toBe("");

    await answer({ [A]: { error: "HTTP 401" }, [B]: { error: "HTTP 401" } }, null);
    const none = await run();
    expect(none.code).toBe(1);
    expect(none.stderr).toContain("gh could not read any of the backlog's pull requests");
    expect(none.stderr).toContain("HTTP 401");
  });

  it("fails with a sentence when gh is not there, and is silent with no pull requests", async () => {
    const { run, home, noGh } = await setup();
    const missing = await run(noGh);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("gh is not installed");

    await writeFile(join(home, "data", "backlog.md"), "# Backlog\n## In flight\n", "utf8");
    expect(await run()).toMatchObject({ code: 0, stdout: "", stderr: "" });
  });
});
