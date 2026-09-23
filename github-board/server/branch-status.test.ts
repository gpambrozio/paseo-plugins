/**
 * The answers here are trimmed copies of what GitHub really returned for the
 * branch-status query on 2026-09-22 — a same-repository pull request, one from a
 * fork, and one on a repository with "Always suggest updating pull request
 * branches" off. Nothing in this file fetches.
 */
import { describe, expect, it } from "vitest";

import { branchStatusQuery, toBranchStatus } from "./board";

describe("branchStatusQuery", () => {
  it("declares one id and one head variable for every alias it selects", () => {
    const query = branchStatusQuery(3);
    for (const index of [0, 1, 2]) {
      expect(query).toContain(`$id${index}: ID!`);
      expect(query).toContain(`$head${index}: String!`);
      expect(query).toContain(`pr${index}: node(id: $id${index})`);
      expect(query).toContain(`compare(headRef: $head${index})`);
    }
    expect(query).not.toContain("pr3");
  });
});

describe("toBranchStatus", () => {
  it("reads a branch that is behind and that the login may update", () => {
    // gpambrozio/SurfTracker#168: behind main, repository allows updating.
    const node = { viewerCanUpdateBranch: true, baseRef: { compare: { behindBy: 2 } } };
    expect(toBranchStatus(node)).toEqual({ behindBy: 2, canUpdate: true });
  });

  it("reads a pull request from a fork the same way", () => {
    // getpaseo/paseo#5039, head on gpambrozio/paseo, compared by head SHA.
    const node = { viewerCanUpdateBranch: true, baseRef: { compare: { behindBy: 25 } } };
    expect(toBranchStatus(node)).toEqual({ behindBy: 25, canUpdate: true });
  });

  it("keeps the count but offers no update where GitHub would not", () => {
    // gpambrozio/SquarelineToEsphome#23: clean and behind, but the repository
    // does not suggest updating branches, so GitHub answers false.
    const node = { viewerCanUpdateBranch: false, baseRef: { compare: { behindBy: 2 } } };
    expect(toBranchStatus(node)).toEqual({ behindBy: 2, canUpdate: false });
  });

  it("never offers an update on a branch that is not behind", () => {
    const node = { viewerCanUpdateBranch: true, baseRef: { compare: { behindBy: 0 } } };
    expect(toBranchStatus(node)).toEqual({ behindBy: 0, canUpdate: false });
  });

  it("is null when GitHub had no comparison to give", () => {
    expect(toBranchStatus({ viewerCanUpdateBranch: false, baseRef: null })).toBeNull();
    expect(toBranchStatus({ viewerCanUpdateBranch: false, baseRef: { compare: null } })).toBeNull();
    expect(toBranchStatus(null)).toBeNull();
    expect(toBranchStatus(undefined)).toBeNull();
  });
});
