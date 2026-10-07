import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REMOVE_ATTEMPTS, prepareHome, readSuggestions, removeSuggestion } from "./home";
import { FirstmateConfigSchema } from "../shared/fleet";
import {
  MAX_DISMISSED,
  MAX_SUGGESTIONS,
  parseDismissed,
  parseSuggestions,
  withDismissal,
  withoutSuggestion,
} from "./suggestions";
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
      await mkdir(join(home, "data"), { recursive: true });
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

describe("dismissed suggestions", () => {
  const land = { label: "Land web#42", prompt: "Merge https://github.com/you/web/pull/42" };
  const scout = { label: "Scout", prompt: "Look around" };
  const on = new Date(2026, 9, 7, 12);

  async function withHome(run: (home: string) => Promise<void>): Promise<void> {
    const home = await mkdtemp(join(tmpdir(), "firstmate-dismissed-"));
    try {
      await mkdir(join(home, "data"));
      await run(home);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }

  it("writes each dismissal as a suggestion line with the day it went", () => {
    expect(withDismissal("", land, on)).toBe(
      "- Land web#42 :: Merge https://github.com/you/web/pull/42 (dismissed 2026-10-07)\n",
    );
    expect(withDismissal("# Dismissed\n<!-- a note -->", { label: " A  b ", prompt: "one\n two " }, on)).toBe(
      "# Dismissed\n<!-- a note -->\n- A b :: one two (dismissed 2026-10-07)\n",
    );
    expect(parseDismissed(withDismissal("", land, on))).toEqual(new Set([land.prompt]));
  });

  it("starts as a file with no dismissals in a new home", async () => {
    const template = await readTemplate(TEMPLATES.suggestionsDismissed);
    expect(parseDismissed(template)).toEqual(new Set());
    expect(withDismissal(template, land, on).startsWith(template)).toBe(true);
  });

  it("keeps the newest dismissals, each prompt once, and the file's heading and notes", async () => {
    const head = await readTemplate(TEMPLATES.suggestionsDismissed);
    let file = head;
    for (let index = 0; index < MAX_DISMISSED + 5; index++) {
      file = withDismissal(file, { label: `S${index}`, prompt: `Do ${index}` }, on);
    }
    file = withDismissal(file, { label: "Again", prompt: `  Do  ${MAX_DISMISSED + 4}` }, on);
    const lines = file.slice(head.length).trimEnd().split("\n");
    expect(file.startsWith(head)).toBe(true);
    expect(lines).toHaveLength(MAX_DISMISSED);
    expect(lines[0]).toBe("- S5 :: Do 5 (dismissed 2026-10-07)");
    expect(lines[lines.length - 1]).toBe(`- Again :: Do ${MAX_DISMISSED + 4} (dismissed 2026-10-07)`);
    expect(parseDismissed(file).size).toBe(MAX_DISMISSED);
  });

  it("hides a suggestion whose prompt was dismissed, and shows one whose prompt changed", () => {
    const dismissed = parseDismissed(withDismissal("", land, on));
    const file = [
      "- Land it now :: Merge   https://github.com/you/web/pull/42 ",
      "- Land web#43 :: Merge https://github.com/you/web/pull/43",
      "- Scout :: Look around",
    ].join("\n");
    expect(parseSuggestions(file, dismissed)).toEqual([
      { label: "Land web#43", prompt: "Merge https://github.com/you/web/pull/43" },
      scout,
    ]);
  });

  it("does not let hidden suggestions take a place in the list", () => {
    const lines = Array.from({ length: MAX_SUGGESTIONS + 2 }, (_, index) => `- S${index} :: Do ${index}`);
    const dismissed = new Set(["Do 0", "Do 1"]);
    const shown = parseSuggestions(lines.join("\n"), dismissed);
    expect(shown).toHaveLength(MAX_SUGGESTIONS);
    expect(shown[0]).toEqual({ label: "S2", prompt: "Do 2" });
  });

  it("records a removal, hides the first mate's repeat of it and never edits the file to do so", async () => {
    await withHome(async (home) => {
      const path = join(home, TEMPLATES.suggestions);
      const dismissedPath = join(home, TEMPLATES.suggestionsDismissed);
      await writeFile(path, `- ${land.label} :: ${land.prompt}\n- Scout :: Look around\n`);

      expect(await removeSuggestion(home, land, {}, on)).toEqual([scout]);
      expect(await readFile(dismissedPath, "utf8")).toContain(
        "- Land web#42 :: Merge https://github.com/you/web/pull/42 (dismissed 2026-10-07)\n",
      );

      // The first mate rewrites its list from its records, the removed suggestion included.
      const rewrite = `- Land :: ${land.prompt}\n- Scout :: Look around\n- Land web#42 :: Merge https://github.com/you/web/pull/42 now it has a new head\n`;
      await writeFile(path, rewrite);
      expect(await readSuggestions(home)).toEqual([
        scout,
        { label: "Land web#42", prompt: "Merge https://github.com/you/web/pull/42 now it has a new head" },
      ]);
      expect(await readFile(path, "utf8")).toBe(rewrite);
    });
  });

  it("records a removal the file no longer has, and a second one beside the first", async () => {
    await withHome(async (home) => {
      await prepareHome(home, FirstmateConfigSchema.parse({}));
      const dismissedPath = join(home, TEMPLATES.suggestionsDismissed);
      const template = await readTemplate(TEMPLATES.suggestionsDismissed);
      expect(await readFile(dismissedPath, "utf8")).toBe(template);

      expect(await removeSuggestion(home, land, {}, on)).toEqual([]);
      await Promise.all([removeSuggestion(home, scout, {}, on), removeSuggestion(home, { label: "C", prompt: "c" }, {}, on)]);
      const file = await readFile(dismissedPath, "utf8");
      expect(file.startsWith(template)).toBe(true);
      expect(parseDismissed(file)).toEqual(new Set([land.prompt, scout.prompt, "c"]));
    });
  });

  it("is no dismissals when the file is missing", async () => {
    await withHome(async (home) => {
      await writeFile(join(home, TEMPLATES.suggestions), "- Scout :: Look around\n");
      expect(await readSuggestions(home)).toEqual([scout]);
    });
  });
});
