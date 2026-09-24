import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { pluginPathIn } from "./cli";
import { TEMPLATES, fill, templatesDirectory, withoutNotes } from "./templates";

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort();
}

describe("templates/", () => {
  it("holds exactly the templates the code reads", async () => {
    const listed = Object.values(TEMPLATES).sort();
    expect(await filesUnder(await templatesDirectory())).toEqual(listed);
  });

  it("ships in the npm package, which carries only what `files` names", async () => {
    const manifest = JSON.parse(await readFile(join(await templatesDirectory(), "..", "package.json"), "utf8")) as {
      files: string[];
    };
    expect(manifest.files).toContain("templates/");
  });
});

describe("withoutNotes and fill", () => {
  it("leave out the notes, then fill only the names given", () => {
    const template = "<!-- where this goes -->\n\nHome: {{home}}, crew: {{crew}}.\r\n<!-- another -->";
    expect(fill(withoutNotes(template), { home: "/h" })).toBe("Home: /h, crew: {{crew}}.");
  });
});

describe("pluginPathIn", () => {
  it("reads the plugin's directory out of `paseo plugin ls --json`", () => {
    const listing = JSON.stringify([
      { id: "herald", path: "/plugins/herald" },
      { id: "firstmate", path: "/p/node_modules/@gpambrozio/paseo-firstmate", installation: { identity: { kind: "npm" } } },
    ]);
    expect(pluginPathIn(listing, "firstmate")).toBe("/p/node_modules/@gpambrozio/paseo-firstmate");
    expect(pluginPathIn(listing, "skills")).toBeNull();
    expect(pluginPathIn("not json", "firstmate")).toBeNull();
    expect(pluginPathIn(JSON.stringify({ id: "firstmate" }), "firstmate")).toBeNull();
  });
});
