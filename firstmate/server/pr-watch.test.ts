/**
 * The built-in PR watch (`templates/watches/pr-watch`), run as the runner runs it — seeded into a
 * temporary home, executed by its `#!` line — against a stand-in `gh` that answers from a fixture file.
 */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
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
  process.stdout.write(JSON.stringify(pull));
} else { process.exit(2); }
`;

interface Pull {
  state?: string;
  title?: string;
  reviews?: Array<{ id: string; author: { login: string }; state: string; body: string }>;
  comments?: Array<{ id: string; author: { login: string }; body: string }>;
  statusCheckRollup?: Array<Record<string, string>>;
  error?: string;
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
  const bin = join(root, "bin");
  const state = join(root, "state");
  await Promise.all([mkdir(join(home, "data"), { recursive: true }), mkdir(bin), mkdir(state)]);
  await seedWatches(home);
  await writeFile(join(bin, "gh"), FAKE_GH, "utf8");
  await chmod(join(bin, "gh"), 0o755);
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
    ].join("\n"),
    "utf8",
  );
  const fixture = join(root, "gh.json");
  const log = join(root, "gh.log");
  await writeFile(log, "", "utf8");

  async function answer(prs: Record<string, Pull>, user: string | null = "me"): Promise<void> {
    await writeFile(fixture, JSON.stringify({ user, prs }), "utf8");
  }

  async function run(path = `${bin}${delimiter}${dirname(process.execPath)}${delimiter}/usr/bin${delimiter}/bin`) {
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
      },
      timeoutMs: 20_000,
      maxOutputBytes: 64_000,
      maxErrorBytes: 4000,
    });
  }

  return { answer, run, log, state, home, bin };
}

describe("pr-watch", () => {
  it("records a baseline silently, then prints only what changed", async () => {
    const { answer, run, log, state } = await setup();
    await answer({ [A]: pull({ statusCheckRollup: pending }), [B]: pull({ title: "Upstream it", statusCheckRollup: passing }) });

    let result = await run();
    expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    expect(calls.filter((call) => call.startsWith("pr view")).map((call) => call.split(" ")[2])).toEqual([A, B]);
    expect(Object.keys(JSON.parse(await readFile(join(state, "prs.json"), "utf8")).prs)).toEqual([A, B]);

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
    expect(result.stdout).toBe(
      [
        `${A} (A change)`,
        "- merged",
        "- checks turned green",
        "",
        `${B} (Upstream it)`,
        '- new review from maintainer, changes requested: "Please rename this."',
        `- new comment from someone: "${"x".repeat(200)}…"`,
        "- checks turned red: build, ci/lint",
        "",
      ].join("\n"),
    );

    result = await run();
    expect(result).toMatchObject({ code: 0, stdout: "" });
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
    expect(third.stdout).toContain(`${A}\n- gh cannot read it (GraphQL: Could not resolve to a PullRequest)`);
    expect((await run()).stdout).toBe("");

    await answer({ [A]: { error: "HTTP 401" }, [B]: { error: "HTTP 401" } }, null);
    const none = await run();
    expect(none.code).toBe(1);
    expect(none.stderr).toContain("gh could not read any of the backlog's pull requests");
    expect(none.stderr).toContain("HTTP 401");
  });

  it("fails with a sentence when gh is not there, and is silent with no pull requests", async () => {
    const { run, home } = await setup();
    const missing = await run(`${dirname(process.execPath)}${delimiter}/usr/bin${delimiter}/bin`);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("gh is not installed");

    await writeFile(join(home, "data", "backlog.md"), "# Backlog\n## In flight\n", "utf8");
    expect(await run()).toMatchObject({ code: 0, stdout: "", stderr: "" });
  });
});
