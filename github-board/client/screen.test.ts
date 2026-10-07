import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Board, BoardItem } from "../shared/board";
import { findBoardItem, itemKey, requestedItemKey } from "./screen";

function item(repository: string, number: number): BoardItem {
  return { id: `${repository}#${number}`, repository, number } as BoardItem;
}

function board(columns: Record<string, BoardItem[]>): Board {
  return {
    columns: Object.entries(columns).map(([id, items]) => ({ id, items })),
  } as unknown as Board;
}

describe("board screen params", () => {
  it("spells a card as owner/name#number", () => {
    expect(itemKey(item("octo/repo", 12))).toBe("octo/repo#12");
  });

  it("reads no card from missing or empty params", () => {
    expect(requestedItemKey({})).toBeNull();
    expect(requestedItemKey({ item: "" })).toBeNull();
    expect(requestedItemKey({ item: "octo/repo#12" })).toBe("octo/repo#12");
  });

  it("finds a card with the column it sits in", () => {
    const pr = item("octo/repo", 7);
    const found = findBoardItem(
      board({ issues: [item("octo/repo", 1)], "open-prs": [pr] }),
      "octo/repo#7",
    );
    expect(found).toEqual({ item: pr, type: "open-prs" });
  });

  it("finds nothing for a card the board does not show", () => {
    expect(findBoardItem(board({ issues: [item("octo/repo", 1)] }), "octo/other#1")).toBeNull();
  });
});

const CLIENT_DIR = dirname(fileURLToPath(import.meta.url));

/** Every module the screen reaches through relative imports, the screen included. */
function screenModules(): Map<string, string> {
  const modules = new Map<string, string>();
  const pending = [join(CLIENT_DIR, "board.tsx")];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || modules.has(file)) continue;
    const source = readFileSync(file, "utf8");
    modules.set(file, source);
    for (const match of source.matchAll(/\bfrom\s*"(\.[^"]*)"/g)) {
      const base = resolve(dirname(file), match[1] ?? "");
      const target = [`${base}.ts`, `${base}.tsx`].find((path) => existsSync(path));
      if (target !== undefined) pending.push(target);
    }
  }
  return modules;
}

/** The source without its comments, which are free to talk about `openScreen`. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the board screen", () => {
  /**
   * `openScreen` is a `router.push` onto a route with no `getId`, so a call
   * from inside the screen — even to the board already showing — mounts
   * another board on top and leaves the old one running underneath. 0.10.0
   * did that on every card press and every close.
   */
  it("never opens a screen, so a card press cannot stack another board", () => {
    const modules = screenModules();
    expect(modules.size).toBeGreaterThan(1);
    const callers = [...modules]
      .filter(([, source]) => /\bopenScreen\b|\bPluginOpenScreenInput\b/.test(code(source)))
      .map(([file]) => file.slice(CLIENT_DIR.length + 1));
    expect(callers).toEqual([]);
  });
});
