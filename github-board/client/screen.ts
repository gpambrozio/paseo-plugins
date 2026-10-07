import type { PluginScreenParams } from "@getpaseo/plugin/client";

import type { Board, BoardItem, ColumnId } from "../shared/board";

/**
 * The board's one screen. Also the sidebar item's id, which is not a free
 * choice: Settings > Sidebar keys its ordering and hidden state on the item id,
 * and a saved `/plugin/github-board/sidebar/board` link resolves to the screen
 * of the same id, so renaming either loses both.
 */
export const BOARD_SCREEN_ID = "board";
export const BOARD_TITLE = "GitHub";

/**
 * The screen param naming the card to open on arrival, as `owner/name#number`.
 * It is read once, when the screen mounts: every `openScreen` mounts a new
 * instance — the host's stack pushes a route per call, even to the screen
 * already showing — so a screen's params never change while it is up. A link or
 * a reload naming a card lands on it; presses inside the board never touch the
 * URL, because a push per press would stack a live board per card.
 */
export const ITEM_PARAM = "item";

/** How a card is spelled in the screen's URL: `owner/name#number`. */
export function itemKey(item: Pick<BoardItem, "repository" | "number">): string {
  return `${item.repository}#${item.number}`;
}

/** The card the screen's params name, or null when they name none. */
export function requestedItemKey(params: PluginScreenParams): string | null {
  const value = params[ITEM_PARAM];
  return value === undefined || value === "" ? null : value;
}

/**
 * The card `key` names on `board`, with the column it sits in — the column
 * picks the send template. Null when the board does not show it, which a link
 * from another host or a card closed since is.
 */
export function findBoardItem(
  board: Board,
  key: string,
): { item: BoardItem; type: ColumnId } | null {
  for (const column of board.columns) {
    const item = column.items.find((candidate) => itemKey(candidate) === key);
    if (item !== undefined) return { item, type: column.id };
  }
  return null;
}
