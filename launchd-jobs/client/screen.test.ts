import { describe, expect, it } from "vitest";

import { JOBS_SCREEN_ID, jobsScreenInput, paneFor, paneJobId, requestedJobId } from "./screen";

describe("requestedJobId", () => {
  it("reads the job param", () => {
    expect(requestedJobId({ job: "nightly-backup" })).toBe("nightly-backup");
  });

  it("is null for no param or an empty one", () => {
    expect(requestedJobId({})).toBeNull();
    expect(requestedJobId({ job: "" })).toBeNull();
  });
});

describe("jobsScreenInput", () => {
  it("names the job, or none", () => {
    expect(jobsScreenInput("nightly-backup")).toEqual({
      screenId: JOBS_SCREEN_ID,
      params: { job: "nightly-backup" },
    });
    expect(jobsScreenInput(null)).toEqual({ screenId: JOBS_SCREEN_ID, params: {} });
  });

  it("round-trips through requestedJobId", () => {
    expect(requestedJobId(jobsScreenInput("a").params ?? {})).toBe("a");
    expect(requestedJobId(jobsScreenInput(null).params ?? {})).toBeNull();
  });
});

describe("paneJobId", () => {
  it("is the job a view or an edit is about", () => {
    expect(paneJobId({ kind: "view", id: "a" })).toBe("a");
    expect(paneJobId({ kind: "edit", id: "a" })).toBe("a");
  });

  it("is null for the empty pane and the new-job form", () => {
    expect(paneJobId({ kind: "empty" })).toBeNull();
    expect(paneJobId({ kind: "new" })).toBeNull();
  });
});

describe("paneFor", () => {
  it("keeps a pane already about the requested job, so an open form survives", () => {
    const editing = { kind: "edit", id: "a" } as const;
    expect(paneFor("a", editing)).toBe(editing);
  });

  it("keeps the new-job form when no job is requested", () => {
    const creating = { kind: "new" } as const;
    expect(paneFor(null, creating)).toBe(creating);
  });

  it("opens the requested job's detail over anything else", () => {
    expect(paneFor("b", { kind: "edit", id: "a" })).toEqual({ kind: "view", id: "b" });
    expect(paneFor("b", { kind: "new" })).toEqual({ kind: "view", id: "b" });
    expect(paneFor("b", { kind: "empty" })).toEqual({ kind: "view", id: "b" });
  });

  it("closes a job's pane when no job is requested", () => {
    expect(paneFor(null, { kind: "view", id: "a" })).toEqual({ kind: "empty" });
    expect(paneFor(null, { kind: "edit", id: "a" })).toEqual({ kind: "empty" });
  });
});
