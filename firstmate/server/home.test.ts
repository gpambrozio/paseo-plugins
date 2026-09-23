import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CREW_LABELS, FirstmateConfigSchema } from "../shared/fleet";
import { renderCharter } from "./charter";
import { isHomeReady, parseProjects, prepareHome, readBacklog } from "./home";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "firstmate-home-"));
  tempDirs.push(dir);
  return dir;
}

describe("prepareHome", () => {
  it("writes the charter and every record, and a relaunch rewrites only the charter", async () => {
    const home = await tempHome();
    expect(await isHomeReady(home)).toBe(false);

    await prepareHome(home, FirstmateConfigSchema.parse({}));
    expect(await isHomeReady(home)).toBe(true);
    expect(await readBacklog(home)).toEqual([]);

    await writeFile(join(home, "data", "captain.md"), "- Always use pnpm.\n", "utf8");
    await writeFile(join(home, "AGENTS.md"), "stale", "utf8");
    await prepareHome(home, FirstmateConfigSchema.parse({ crewProvider: "codex/gpt-5.5" }));

    expect(await readFile(join(home, "data", "captain.md"), "utf8")).toBe("- Always use pnpm.\n");
    const charter = await readFile(join(home, "AGENTS.md"), "utf8");
    expect(charter).toContain("`codex/gpt-5.5`");
    expect(charter).toContain(home);
  });
});

describe("renderCharter", () => {
  it("fills every placeholder and names the labels the board reads", () => {
    for (const crewProvider of ["", "claude/sonnet"]) {
      const charter = renderCharter({ home: "/h", crewProvider, crewModeId: crewProvider === "" ? "" : "acceptEdits" });
      expect(charter).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
      for (const key of [CREW_LABELS.role, CREW_LABELS.task, CREW_LABELS.kind, CREW_LABELS.project]) {
        expect(charter).toContain(key);
      }
      expect(charter).toContain(`"${CREW_LABELS.role}": "${CREW_LABELS.crewRole}"`);
    }
  });
});

describe("parseProjects", () => {
  it("reads the registry lines and skips the prose around them", () => {
    const projects = parseProjects(`# Projects

One line per project: \`- <name> [<mode> +yolo] - <path or clone URL> - <description>\`.

- web [direct-PR +yolo] - /Users/me/code/web - The storefront
- api [local-only] - /Users/me/code/api
- docs - https://github.com/me/docs - Written by hand
`);
    expect(projects).toEqual([
      { name: "web", mode: "direct-PR", yolo: true, location: "/Users/me/code/web", description: "The storefront" },
      { name: "api", mode: "local-only", yolo: false, location: "/Users/me/code/api", description: null },
      { name: "docs", mode: null, yolo: false, location: "https://github.com/me/docs", description: "Written by hand" },
    ]);
  });
});
