import { describe, expect, it, vi } from "vitest";

import { decodeEntities, htmlToMarkdown } from "./html";
import { parseMarkdown } from "./markdown";

// markdown.tsx draws with react-native, which vitest cannot load; the parse
// under test never touches it.
vi.mock("react-native", () => ({}));

describe("decodeEntities", () => {
  it("decodes named and numeric references", () => {
    expect(decodeEntities("&amp; &lt; &#65; &#x42; &#X43; &copy; &unknown;")).toBe(
      "& < A B C © &unknown;",
    );
  });

  it("decodes the highest code point", () => {
    expect(decodeEntities("&#x10FFFF;")).toBe("\u{10FFFF}");
    expect(decodeEntities("&#1114111;")).toBe("\u{10FFFF}");
  });

  it.each([
    "&#1114112;",
    "&#x110000;",
    "&#xFFFFFFFFFF;",
    "&#99999999999999999999;",
    "&#0;",
    "&#x0;",
    "&#xD800;",
    "&#xDFFF;",
    "&#55296;",
    "&#57343;",
  ])("turns the invalid reference %s into U+FFFD instead of throwing", (entity) => {
    expect(decodeEntities(entity)).toBe("�");
  });
});

describe("a body with an invalid reference", () => {
  it("still converts its HTML", () => {
    expect(htmlToMarkdown("<p>&#x110000; and <b>more</b></p>")).toContain("� and **more**");
  });

  it("still parses for the board", () => {
    expect(() => parseMarkdown("<p>&#1114112;</p>\n\nText &#x110000; here")).not.toThrow();
    expect(JSON.stringify(parseMarkdown("<p>&#1114112;</p>"))).toContain("�");
  });
});
