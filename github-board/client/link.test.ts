import { describe, expect, it } from "vitest";

import { isOpenableLink } from "./link";

describe("isOpenableLink", () => {
  it.each(["https://github.com/o/r/issues/1", "http://example.com/", "HTTPS://github.com/"])(
    "opens %s",
    (url) => {
      expect(isOpenableLink(url)).toBe(true);
    },
  );

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "vscode://file/etc/passwd",
    "mailto:someone@example.com",
    "/relative/path",
    "#anchor",
    "",
  ])("does not open %s", (url) => {
    expect(isOpenableLink(url)).toBe(false);
  });
});
