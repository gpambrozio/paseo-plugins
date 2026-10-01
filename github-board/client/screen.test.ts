import { afterEach, describe, expect, it, vi } from "vitest";

import type { Board, BoardItem } from "../shared/board";
import {
  bindScreenOpener,
  boardScreenInput,
  boardScreenTitle,
  findBoardItem,
  itemKey,
  requestedItemKey,
  showBoardItem,
} from "./screen";

function item(repository: string, number: number): BoardItem {
  return { id: `${repository}#${number}`, repository, number } as BoardItem;
}

function board(columns: Record<string, BoardItem[]>): Board {
  return {
    columns: Object.entries(columns).map(([id, items]) => ({ id, items })),
  } as unknown as Board;
}

describe("board screen params", () => {
  afterEach(() => bindScreenOpener(null));

  it("spells a card as owner/name#number", () => {
    expect(itemKey(item("octo/repo", 12))).toBe("octo/repo#12");
  });

  it("reads no card from missing or empty params", () => {
    expect(requestedItemKey({})).toBeNull();
    expect(requestedItemKey({ item: "" })).toBeNull();
    expect(requestedItemKey({ item: "octo/repo#12" })).toBe("octo/repo#12");
  });

  it("names the open card in the title", () => {
    expect(boardScreenTitle({})).toBe("GitHub");
    expect(boardScreenTitle({ item: "octo/repo#12" })).toBe("GitHub · octo/repo#12");
  });

  it("opens the card in params and closes with none", () => {
    expect(boardScreenInput(item("octo/repo", 12))).toEqual({
      screenId: "board",
      params: { item: "octo/repo#12" },
    });
    expect(boardScreenInput(null)).toEqual({ screenId: "board", params: {} });
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

  it("navigates through the lent opener, and throws when there is none", () => {
    expect(() => showBoardItem(null)).toThrow(/not bound/);
    const open = vi.fn();
    bindScreenOpener(open);
    showBoardItem(item("octo/repo", 3));
    expect(open).toHaveBeenCalledWith({ screenId: "board", params: { item: "octo/repo#3" } });
  });
});
