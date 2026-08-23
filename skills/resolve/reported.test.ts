import { describe, expect, test } from "vitest";

import { selectReported, supportsCommands } from "./reported";

const brainstorming = {
  name: "brainstorming",
  description: "Turns ideas into designs",
  argumentHint: "[topic]",
  kind: "skill" as const,
};

describe("selectReported", () => {
  test("splits on the kind the provider assigned", () => {
    const result = selectReported(
      [brainstorming, { ...brainstorming, name: "usage", kind: "command" as const }],
      [],
    );
    expect(result.skills.map((entry) => entry.name)).toEqual(["brainstorming"]);
    expect(result.commands.map((entry) => entry.name)).toEqual(["usage"]);
  });

  test("carries name, description, and argument hint through", () => {
    expect(selectReported([brainstorming], []).skills).toEqual([
      { name: "brainstorming", description: "Turns ideas into designs", argumentHint: "[topic]" },
    ]);
  });

  // A missing kind means the provider declined to classify, not that the entry is
  // a session control. Bucketing those as commands would empty the skills section
  // for any provider that does not populate the field.
  test("treats an entry with no kind as a skill", () => {
    const unclassified = { name: "review", description: "Review a diff", argumentHint: "" };
    const result = selectReported([unclassified], []);
    expect(result.skills.map((entry) => entry.name)).toEqual(["review"]);
    expect(result.commands).toEqual([]);
  });

  test("drops names filesystem discovery already found from both buckets", () => {
    const commands = [
      brainstorming,
      { ...brainstorming, name: "dataviz" },
      { ...brainstorming, name: "usage", kind: "command" as const },
    ];
    const result = selectReported(commands, ["brainstorming", "usage"]);
    expect(result.skills.map((entry) => entry.name)).toEqual(["dataviz"]);
    expect(result.commands).toEqual([]);
  });

  // Plugin skills are discovered as `plugin:skill` and reported under the same
  // name, so the two lists agree without any name rewriting.
  test("matches a discovered plugin skill by its namespaced name", () => {
    const commands = [{ ...brainstorming, name: "superpowers:brainstorming" }];
    expect(selectReported(commands, ["superpowers:brainstorming"]).skills).toEqual([]);
  });

  test("sorts each bucket by name", () => {
    const commands = [
      { ...brainstorming, name: "zebra" },
      { ...brainstorming, name: "alpha" },
      { ...brainstorming, name: "yak", kind: "command" as const },
      { ...brainstorming, name: "bison", kind: "command" as const },
    ];
    const result = selectReported(commands, []);
    expect(result.skills.map((entry) => entry.name)).toEqual(["alpha", "zebra"]);
    expect(result.commands.map((entry) => entry.name)).toEqual(["bison", "yak"]);
  });

  test("drops a duplicate name the provider reported twice", () => {
    const commands = [brainstorming, { ...brainstorming, description: "Second copy" }];
    expect(selectReported(commands, []).skills).toHaveLength(1);
  });

  test("tolerates an empty list", () => {
    expect(selectReported([], ["brainstorming"])).toEqual({ skills: [], commands: [] });
  });
});

describe("supportsCommands", () => {
  test("accepts a handle from a daemon that exposes commands()", () => {
    expect(supportsCommands({ commands: () => Promise.resolve({ commands: [], error: null }) })).toBe(
      true,
    );
  });

  test("rejects a handle from a daemon that predates commands()", () => {
    expect(supportsCommands({ send: () => Promise.resolve() })).toBe(false);
  });

  test("rejects a non-callable commands property", () => {
    expect(supportsCommands({ commands: [] })).toBe(false);
  });
});
