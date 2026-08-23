import { describe, expect, test } from "vitest";

import { parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  test("reads name and description and returns the body", () => {
    const raw = "---\nname: brainstorming\ndescription: Turns ideas into designs\n---\n\n# Body\n\nText.\n";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.name).toBe("brainstorming");
    expect(result.frontmatter.description).toBe("Turns ideas into designs");
    expect(result.body).toBe("# Body\n\nText.\n");
  });

  test("keeps colons inside a value", () => {
    const raw = "---\ndescription: Use when: you are stuck\n---\nbody\n";
    expect(parseFrontmatter(raw).frontmatter.description).toBe("Use when: you are stuck");
  });

  test("strips surrounding quotes from a value", () => {
    const raw = "---\nname: \"my-skill\"\ndescription: 'single quoted'\n---\nbody\n";
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.name).toBe("my-skill");
    expect(frontmatter.description).toBe("single quoted");
  });

  test("normalizes CRLF line endings", () => {
    const raw = "---\r\nname: windows\r\n---\r\nbody\r\n";
    expect(parseFrontmatter(raw).frontmatter.name).toBe("windows");
  });

  test("treats a file with no frontmatter as all body", () => {
    const raw = "# Just a document\n";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("# Just a document\n");
  });

  test("treats unterminated frontmatter as all body", () => {
    const raw = "---\nname: broken\nstill going\n";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(raw);
  });

  test("ignores lines with no colon", () => {
    const raw = "---\nname: ok\njust-a-line\n---\nbody\n";
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({ name: "ok" });
  });

  test("ignores an empty key", () => {
    const raw = "---\n: value\nname: ok\n---\nbody\n";
    expect(parseFrontmatter(raw).frontmatter).toEqual({ name: "ok" });
  });

  test("folds a `>` block scalar into a single line", () => {
    const raw = [
      "---",
      "name: visual-explainer",
      "description: >",
      "  Generate self-contained HTML visualizations. Use for implementation",
      "  plans, PR explainers, and architecture diagrams.",
      "---",
      "",
      "# Body",
      "",
    ].join("\n");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.name).toBe("visual-explainer");
    expect(frontmatter.description).toBe(
      "Generate self-contained HTML visualizations. Use for implementation plans, PR explainers, and architecture diagrams.",
    );
  });

  test("keeps newlines in a `|` block scalar", () => {
    const raw = "---\nname: steps\ndescription: |\n  first\n  second\n---\nbody\n";
    expect(parseFrontmatter(raw).frontmatter.description).toBe("first\nsecond");
  });

  test("accepts chomping indicators on block scalars", () => {
    const raw = "---\ndescription: >-\n  folded text\n---\nbody\n";
    expect(parseFrontmatter(raw).frontmatter.description).toBe("folded text");
  });

  test("a nested key does not overwrite a top-level key", () => {
    const raw = "---\nname: real-name\nmetadata:\n  name: nested-name\n  type: internal\n---\nbody\n";
    expect(parseFrontmatter(raw).frontmatter.name).toBe("real-name");
  });

  test("recognizes a closing fence with trailing whitespace", () => {
    const raw = "---\nname: ok\ndescription: fine\n---  \nbody\n";
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.name).toBe("ok");
    expect(body).toBe("body\n");
  });

  test("terminates a block scalar at the closing fence", () => {
    const raw = "---\ndescription: >\n  only line\n---\n# Body\n";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.description).toBe("only line");
    expect(result.body).toBe("# Body\n");
  });
});
