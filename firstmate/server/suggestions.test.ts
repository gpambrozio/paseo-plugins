import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readSuggestions } from "./home";
import { MAX_SUGGESTIONS, parseSuggestions } from "./suggestions";
import { TEMPLATES, readTemplate } from "./templates";

describe("parseSuggestions", () => {
  it("reads a label and a prompt from each line, in file order", () => {
    const markdown = [
      "# Suggestions",
      "",
      "- Land web#42 :: Merge https://github.com/you/web/pull/42",
      "* **Review loop** :: Run a review loop on https://github.com/you/web/pull/42 until it is clean",
      "1. `Scout auth` :: Find out why logins time out on web: a :: in the prompt stays",
      "Dark mode :: Add a dark mode toggle to web",
    ].join("\n");
    expect(parseSuggestions(markdown)).toEqual([
      { label: "Land web#42", prompt: "Merge https://github.com/you/web/pull/42" },
      { label: "Review loop", prompt: "Run a review loop on https://github.com/you/web/pull/42 until it is clean" },
      { label: "Scout auth", prompt: "Find out why logins time out on web: a :: in the prompt stays" },
      { label: "Dark mode", prompt: "Add a dark mode toggle to web" },
    ]);
  });

  it("skips lines with no label, no prompt or no separator, and anything in a note", () => {
    const markdown = [
      "- :: Nothing to label",
      "- Nothing to send ::",
      "- Just prose, no separator",
      "<!-- - Example :: not a suggestion -->",
      "<!--",
      "- Also an example :: still a note",
      "-->",
      "- Kept :: This one",
    ].join("\r\n");
    expect(parseSuggestions(markdown)).toEqual([{ label: "Kept", prompt: "This one" }]);
  });

  it("keeps the list short", () => {
    const lines = Array.from({ length: MAX_SUGGESTIONS + 3 }, (_, index) => `- S${index} :: Do ${index}`);
    expect(parseSuggestions(lines.join("\n"))).toHaveLength(MAX_SUGGESTIONS);
  });

  it("finds none in an empty file or a new home's", async () => {
    expect(parseSuggestions("")).toEqual([]);
    expect(parseSuggestions(await readTemplate(TEMPLATES.suggestions))).toEqual([]);
  });
});

describe("readSuggestions", () => {
  it("reads the home's file, and a missing one is no suggestions", async () => {
    const home = await mkdtemp(join(tmpdir(), "firstmate-suggestions-"));
    try {
      expect(await readSuggestions(home)).toEqual([]);
      await mkdir(join(home, "data"));
      await writeFile(join(home, TEMPLATES.suggestions), "- Land web#42 :: Merge https://github.com/you/web/pull/42\n");
      expect(await readSuggestions(home)).toEqual([
        { label: "Land web#42", prompt: "Merge https://github.com/you/web/pull/42" },
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
