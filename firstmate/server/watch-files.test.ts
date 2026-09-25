import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TEMPLATES, readTemplate } from "./templates";
import {
  assessBuiltIn,
  builtInStates,
  listWatches,
  scheduleLine,
  seedWatches,
  watchFingerprint,
} from "./watch-files";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "firstmate-watches-"));
  tempDirs.push(dir);
  await mkdir(join(dir, "watches"));
  return dir;
}

async function script(home: string, name: string, text: string, mode = 0o755): Promise<void> {
  const path = join(home, "watches", name);
  await writeFile(path, text, "utf8");
  await chmod(path, mode);
}

describe("scheduleLine", () => {
  it("finds the schedule in a #, // or -- comment near the top, and nowhere else", () => {
    expect(scheduleLine("#!/bin/sh\n# schedule: */5 * * * *\necho hi\n")).toBe("*/5 * * * *");
    expect(scheduleLine("#!/usr/bin/env node\n//   Schedule:  @hourly  \n")).toBe("@hourly");
    expect(scheduleLine("#!/usr/bin/env lua\n-- schedule: 0 9 * * 1-5\n")).toBe("0 9 * * 1-5");
    expect(scheduleLine("#!/bin/sh\necho '# schedule: * * * * *'\n")).toBeNull();
    expect(scheduleLine(`${"#\n".repeat(20)}# schedule: * * * * *\n`)).toBeNull();
  });
});

describe("listWatches", () => {
  it("lists every script by name, with why any of them cannot run", async () => {
    const home = await tempHome();
    await script(home, "good", "#!/bin/sh\n# schedule: */5 * * * *\n");
    await script(home, "no-schedule", "#!/bin/sh\necho hi\n");
    await script(home, "bad-schedule", "#!/bin/sh\n# schedule: every five minutes\n");
    await script(home, "not-executable", "#!/bin/sh\n# schedule: * * * * *\n", 0o644);
    await script(home, "no-shebang", "# schedule: * * * * *\necho hi\n");
    await script(home, "bad name", "#!/bin/sh\n# schedule: * * * * *\n");
    await script(home, "README.md", "# notes");
    await script(home, ".hidden", "#!/bin/sh\n# schedule: * * * * *\n");
    await mkdir(join(home, "watches", "lib"));

    const watches = await listWatches(home);
    expect(watches.map((watch) => watch.name)).toEqual([
      "bad name",
      "bad-schedule",
      "good",
      "no-schedule",
      "no-shebang",
      "not-executable",
    ]);
    const invalid = Object.fromEntries(watches.map((watch) => [watch.name, watch.invalid]));
    expect(invalid.good).toBeNull();
    expect(invalid["no-schedule"]).toMatch(/no "schedule:" comment/);
    expect(invalid["bad-schedule"]).toMatch(/its schedule cannot be read: .*fields/);
    expect(invalid["not-executable"]).toMatch(/not executable/);
    expect(invalid["no-shebang"]).toMatch(/no #! line/);
    expect(invalid["bad name"]).toMatch(/only letters, digits/);
    expect(watches.find((watch) => watch.name === "bad-schedule")?.scheduleText).toBe("every five minutes");
    expect(watches.find((watch) => watch.name === "good")?.schedule).not.toBeNull();
  });

  it("finds none in a home without the folder", async () => {
    const home = await mkdtemp(join(tmpdir(), "firstmate-watches-"));
    tempDirs.push(home);
    expect(await listWatches(home)).toEqual([]);
  });
});

describe("built-in watches", () => {
  const v1 = "#!/bin/sh\n# schedule: */5 * * * *\n# firstmate-watch {{fingerprint}} (leave it)\necho one\n";
  const v2 = "#!/bin/sh\n# schedule: */5 * * * *\n# firstmate-watch {{fingerprint}} (leave it)\necho two\n";
  const copy = (template: string) => template.replace("{{fingerprint}}", watchFingerprint(template));

  it("follow the plugin until edited, and say when an edited one has fallen behind", () => {
    expect(assessBuiltIn(null, v1)).toEqual({ rewrite: true, edited: false, outdated: false });
    expect(assessBuiltIn(copy(v1), v1)).toEqual({ rewrite: false, edited: false, outdated: false });
    expect(assessBuiltIn(copy(v1), v2)).toEqual({ rewrite: true, edited: false, outdated: false });

    const edited = copy(v1).replace("echo one", "echo mine");
    expect(assessBuiltIn(edited, v1)).toEqual({ rewrite: false, edited: true, outdated: false });
    expect(assessBuiltIn(edited, v2)).toEqual({ rewrite: false, edited: true, outdated: true });
    // A copy whose mark was removed is edited from nothing.
    expect(assessBuiltIn("#!/bin/sh\necho mine\n", v1)).toEqual({ rewrite: false, edited: true, outdated: true });
  });

  it("are seeded executable with the README, and an edited one is kept", async () => {
    const home = await tempHome();
    await seedWatches(home);
    const path = join(home, "watches", "pr-watch");
    const seeded = await readFile(path, "utf8");
    expect(seeded).toMatch(/firstmate-watch [0-9a-f]{16}/);
    expect(seeded).not.toContain("{{fingerprint}}");
    expect((await stat(path)).mode & 0o111).not.toBe(0);
    expect(await readFile(join(home, "watches", "README.md"), "utf8")).toBe(
      await readTemplate(TEMPLATES.watchesReadme),
    );
    const [watch] = await listWatches(home);
    expect(watch).toMatchObject({ name: "pr-watch", scheduleText: "*/5 * * * *", invalid: null });
    expect((await builtInStates(home)).get("pr-watch")).toEqual({ rewrite: false, edited: false, outdated: false });

    const edited = `${seeded}\n// the captain's own line\n`;
    await writeFile(path, edited, "utf8");
    await writeFile(join(home, "watches", "README.md"), "mine", "utf8");
    await seedWatches(home);
    expect(await readFile(path, "utf8")).toBe(edited);
    expect(await readFile(join(home, "watches", "README.md"), "utf8")).toBe("mine");
    expect((await builtInStates(home)).get("pr-watch")).toMatchObject({ edited: true, outdated: false });

    await rm(path);
    await seedWatches(home);
    expect(await readFile(path, "utf8")).toBe(seeded);
  });
});
