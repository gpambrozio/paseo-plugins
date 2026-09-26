import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REMOVE_ATTEMPTS, readSuggestions, removeSuggestion } from "./home";
import { MAX_SUGGESTIONS, parseSuggestions, withoutSuggestion } from "./suggestions";
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

describe("withoutSuggestion", () => {
  const land = { label: "Land web#42", prompt: "Merge https://github.com/you/web/pull/42" };

  it("drops only the matching line, keeping every other byte", () => {
    const markdown = [
      "# Suggestions",
      "",
      "<!-- - Land web#42 :: Merge https://github.com/you/web/pull/42 -->",
      "- Review loop :: Run a review loop",
      "- **Land web#42** :: Merge https://github.com/you/web/pull/42",
      "Not a suggestion",
      "- Dark mode :: Add a dark mode toggle",
      "",
    ].join("\r\n");
    expect(withoutSuggestion(markdown, land)).toBe(
      [
        "# Suggestions",
        "",
        "<!-- - Land web#42 :: Merge https://github.com/you/web/pull/42 -->",
        "- Review loop :: Run a review loop",
        "Not a suggestion",
        "- Dark mode :: Add a dark mode toggle",
        "",
      ].join("\r\n"),
    );
  });

  it("removes the last line, with or without a newline after it", () => {
    expect(withoutSuggestion("- A :: a\n- Land web#42 :: Merge https://github.com/you/web/pull/42", land)).toBe(
      "- A :: a\n",
    );
    expect(withoutSuggestion("- Land web#42 :: Merge https://github.com/you/web/pull/42\n", land)).toBe("");
  });

  it("is null when no visible line matches both label and prompt", () => {
    expect(withoutSuggestion("", land)).toBeNull();
    expect(withoutSuggestion("- Land web#42 :: Merge it now\n- Land :: Merge https://github.com/you/web/pull/42", land)).toBeNull();
    expect(
      withoutSuggestion("<!--\n- Land web#42 :: Merge https://github.com/you/web/pull/42\n-->\n- A :: a", land),
    ).toBeNull();
  });

  it("keeps a note that opens on the removed line whole, so nothing it hides shows", () => {
    const markdown = "- A :: a <!--\n- Hidden :: hidden\n-->\n- B :: b\n";
    expect(parseSuggestions(markdown)).toEqual([
      { label: "A", prompt: "a" },
      { label: "B", prompt: "b" },
    ]);
    const next = withoutSuggestion(markdown, { label: "A", prompt: "a" });
    expect(next).toBe("<!--\n- Hidden :: hidden\n-->- B :: b\n");
    expect(parseSuggestions(next ?? "")).toEqual([{ label: "B", prompt: "b" }]);
  });

  it("keeps a note that closes on the removed line whole", () => {
    const markdown = "<!--\n- Hidden :: hidden\n--> - A :: a\n- B :: b\n";
    const next = withoutSuggestion(markdown, { label: "A", prompt: "a" });
    expect(next).toBe("<!--\n- Hidden :: hidden\n-->- B :: b\n");
    expect(parseSuggestions(next ?? "")).toEqual([{ label: "B", prompt: "b" }]);
  });

  it("finds a suggestion a note splits across lines, as the board shows it", () => {
    const markdown = "- A <!-- note\nends here --> :: a\n- B :: b\n";
    expect(parseSuggestions(markdown)).toEqual([
      { label: "A", prompt: "a" },
      { label: "B", prompt: "b" },
    ]);
    const next = withoutSuggestion(markdown, { label: "A", prompt: "a" });
    expect(next).toBe("<!-- note\nends here -->- B :: b\n");
    expect(parseSuggestions(next ?? "")).toEqual([{ label: "B", prompt: "b" }]);
  });

  it("leaves exactly the other suggestions, whichever is removed", () => {
    const files = [
      "- A :: a <!--\n- Hidden :: hidden\n-->\n- B :: b\n",
      "<!-- x --> - A :: a <!-- y -->\r\n- B :: b <!--\r\n-->\r\n- C :: c",
      "- A <!-- note\nends here --> :: a\n- B :: b\n- A :: a\n",
      "x\r- A :: a\n\n- B :: b\r- C :: c <!-- open\n",
      "<!-- - Z :: z -->- A :: a<!--\n-->- B :: b",
    ];
    for (const markdown of files) {
      const shown = parseSuggestions(markdown);
      shown.forEach((suggestion, index) => {
        const next = withoutSuggestion(markdown, suggestion);
        const others = [...shown];
        others.splice(shown.findIndex((other) => other.label === suggestion.label && other.prompt === suggestion.prompt), 1);
        expect(parseSuggestions(next ?? ""), `${JSON.stringify(markdown)} without #${index}`).toEqual(others);
      });
    }
  });

  it("removes one of two identical lines at a time", () => {
    const line = "- Land web#42 :: Merge https://github.com/you/web/pull/42";
    const once = withoutSuggestion(`${line}\n- A :: a\n${line}\n`, land);
    expect(once).toBe(`- A :: a\n${line}\n`);
    expect(parseSuggestions(once ?? "")).toEqual([{ label: "A", prompt: "a" }, land]);
    expect(withoutSuggestion(once ?? "", land)).toBe("- A :: a\n");
  });
});

describe("removeSuggestion", () => {
  it("rewrites the home's file without the line and answers with what is left", async () => {
    const home = await mkdtemp(join(tmpdir(), "firstmate-suggestions-"));
    try {
      const target = { label: "Land", prompt: "Merge it" };
      expect(await removeSuggestion(home, target)).toEqual([]);
      await mkdir(join(home, "data"));
      const path = join(home, TEMPLATES.suggestions);
      await writeFile(path, "# Suggestions\n\n- Land :: Merge it\n- Scout :: Look around\n");
      expect(await removeSuggestion(home, target)).toEqual([{ label: "Scout", prompt: "Look around" }]);
      expect(await readFile(path, "utf8")).toBe("# Suggestions\n\n- Scout :: Look around\n");

      // Gone already — the first mate rewrote the list — leaves the file alone.
      expect(await removeSuggestion(home, target)).toEqual([{ label: "Scout", prompt: "Look around" }]);
      expect(await readFile(path, "utf8")).toBe("# Suggestions\n\n- Scout :: Look around\n");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("removeSuggestion when the first mate writes too", () => {
  const land = "- Land :: Merge it\n";
  const scout = "- Scout :: Look around\n";

  async function withHome(run: (home: string, path: string) => Promise<void>): Promise<void> {
    const home = await mkdtemp(join(tmpdir(), "firstmate-suggestions-"));
    try {
      await mkdir(join(home, "data"));
      await run(home, join(home, TEMPLATES.suggestions));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }

  it("starts over from the first mate's rewrite and keeps what it added", async () => {
    await withHome(async (home, path) => {
      await writeFile(path, land + scout);
      let rewrites = 0;
      const left = await removeSuggestion(
        home,
        { label: "Land", prompt: "Merge it" },
        {
          afterStaging: async () => {
            if (rewrites++ === 0) await writeFile(path, `${land}- Scout :: Look closer\n- Ship :: Release it\n`);
          },
        },
      );
      expect(await readFile(path, "utf8")).toBe("- Scout :: Look closer\n- Ship :: Release it\n");
      expect(left).toEqual([
        { label: "Scout", prompt: "Look closer" },
        { label: "Ship", prompt: "Release it" },
      ]);
    });
  });

  it("gives up after a bounded number of rewrites, leaving the first mate's last one", async () => {
    await withHome(async (home, path) => {
      await writeFile(path, land + scout);
      let rewrites = 0;
      await expect(
        removeSuggestion(
          home,
          { label: "Land", prompt: "Merge it" },
          { afterStaging: () => writeFile(path, `${land}- Rewrite :: ${++rewrites}\n`) },
        ),
      ).rejects.toThrow(/kept rewriting/);
      expect(rewrites).toBe(REMOVE_ATTEMPTS);
      expect(await readFile(path, "utf8")).toBe(`${land}- Rewrite :: ${REMOVE_ATTEMPTS}\n`);
    });
  });

  it("writes nothing when the rewrite already dropped the suggestion", async () => {
    await withHome(async (home, path) => {
      await writeFile(path, land + scout);
      const left = await removeSuggestion(
        home,
        { label: "Land", prompt: "Merge it" },
        { afterStaging: () => writeFile(path, scout) },
      );
      expect(left).toEqual([{ label: "Scout", prompt: "Look around" }]);
      expect(await readFile(path, "utf8")).toBe(scout);
    });
  });
});
