import { describe, expect, it, vi } from "vitest";

import { cliError, helperIdsIn, sweepHelpers, MAX_SWEEP_PASSES } from "./cleanup";

describe("helperIdsIn", () => {
  it("reads the ids out of a page, ignoring anything without one", () => {
    const page = JSON.stringify([
      { id: "a", name: "Herald summary" },
      { name: "no id here" },
      { id: "" },
      { id: 7 },
      "not an object",
      { id: "b" },
    ]);
    expect(helperIdsIn(page)).toEqual(["a", "b"]);
  });

  it("reads an empty answer as no helpers", () => {
    expect(helperIdsIn("")).toEqual([]);
    expect(helperIdsIn("  \n ")).toEqual([]);
    expect(helperIdsIn("[]")).toEqual([]);
  });

  it("refuses an answer that is not a list", () => {
    expect(() => helperIdsIn('{"error":{"code":"NOPE"}}')).toThrow("list of agents");
  });
});

describe("cliError", () => {
  it("prefers the message inside the CLI's JSON error", () => {
    const stderr = JSON.stringify({ error: { code: "DAEMON_NOT_RUNNING", message: "Cannot connect to daemon" } });
    expect(cliError({ code: 1, stdout: "", stderr })).toBe("Cannot connect to daemon");
  });

  it("falls back to the first line of whatever was printed", () => {
    expect(cliError({ code: 1, stdout: "", stderr: "Error: boom\nStart with: …" })).toBe("Error: boom");
    expect(cliError({ code: 2, stdout: "Error: from stdout", stderr: "" })).toBe("Error: from stdout");
  });

  it("says the exit code when the command printed nothing", () => {
    expect(cliError({ code: 3, stdout: "", stderr: "" })).toBe("exit 3");
  });
});

describe("sweepHelpers", () => {
  /** `paseo ls` answers one page at a time, so the sweep has to ask again. */
  function pages(...answers: string[][]): () => Promise<string[]> {
    const queue = [...answers];
    return vi.fn(async () => queue.shift() ?? []);
  }

  it("keeps asking until a page comes back empty", async () => {
    const list = pages(["a", "b"], ["c"], []);
    const remove = vi.fn(async () => {});
    await expect(sweepHelpers({ list, remove })).resolves.toEqual({ deleted: 3, failed: 0 });
    expect(remove.mock.calls.flat()).toEqual(["a", "b", "c"]);
  });

  it("never deletes a helper still writing its summary", async () => {
    const list = pages(["live", "old"], ["live"], ["live"]);
    const remove = vi.fn(async () => {});
    await expect(sweepHelpers({ list, remove, keep: new Set(["live"]) })).resolves.toEqual({
      deleted: 1,
      failed: 0,
    });
    expect(remove.mock.calls.flat()).toEqual(["old"]);
  });

  it("counts a failure and stops rather than re-reading a page it cannot clear", async () => {
    const list = vi.fn(async () => ["a", "b"]);
    const remove = vi.fn(async () => {
      throw new Error("Agent not found");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(sweepHelpers({ list, remove })).resolves.toEqual({ deleted: 0, failed: 2 });
    } finally {
      logged.mockRestore();
    }
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("gives up rather than looping for ever on a daemon that never runs out", async () => {
    const list = vi.fn(async () => ["a"]);
    const remove = vi.fn(async () => {});
    const result = await sweepHelpers({ list, remove });
    expect(result.deleted).toBe(MAX_SWEEP_PASSES);
  });
});
