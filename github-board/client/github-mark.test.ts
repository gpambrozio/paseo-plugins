import { findSvgIconProblem } from "@getpaseo/plugin";
import { describe, expect, it } from "vitest";

import { GITHUB_MARK } from "./github-mark";

describe("GITHUB_MARK", () => {
  // The check Paseo runs when the contribution registers; a problem there is a load failure.
  it("is an SVG Paseo accepts as an icon", () => {
    expect(findSvgIconProblem(GITHUB_MARK.svg)).toBeNull();
  });

  // Without it the mark ignores the colour the host draws it in, and stays black in a dark theme.
  it("takes the host's colour", () => {
    expect(GITHUB_MARK.svg).toContain('fill="currentColor"');
  });
});
