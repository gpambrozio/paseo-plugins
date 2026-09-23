import { describe, expect, it } from "vitest";

import { parseCrewReport, reportUrl } from "./crew-report";

describe("parseCrewReport", () => {
  it("reads the status line at the end of the last message", () => {
    expect(parseCrewReport("Opened the PR and CI is green.\n\ndone: PR https://github.com/o/r/pull/42")).toEqual({
      state: "done",
      text: "PR https://github.com/o/r/pull/42",
    });
  });

  it("accepts the spellings an agent drifts into", () => {
    expect(parseCrewReport("**needs-decision:** keep the old API or remove it?")?.state).toBe("needs-decision");
    expect(parseCrewReport("- blocked: tests need a DATABASE_URL")?.state).toBe("blocked");
    expect(parseCrewReport("Status: paused: waiting for CI")?.state).toBe("paused");
    expect(parseCrewReport("needs decision [key=api]: which way?")?.state).toBe("needs-decision");
    expect(parseCrewReport("DONE: ready in branch fm/x")?.state).toBe("done");
  });

  it("ignores a status word earlier in the message", () => {
    expect(parseCrewReport("done: the first part\n\nThen I kept going.\nStill more.\nAnd more.\nThe end.")).toBeNull();
  });

  it("is null for no message and for a message with no status line", () => {
    expect(parseCrewReport(null)).toBeNull();
    expect(parseCrewReport("I made some changes.")).toBeNull();
  });

  it("looks past a closing code fence", () => {
    expect(parseCrewReport("```\nfailed: the build is red\n```")?.state).toBe("failed");
  });
});

describe("reportUrl", () => {
  it("finds the pull request and drops trailing punctuation", () => {
    expect(reportUrl("PR https://github.com/o/r/pull/42.")).toBe("https://github.com/o/r/pull/42");
    expect(reportUrl("ready in branch fm/x")).toBeNull();
  });
});
