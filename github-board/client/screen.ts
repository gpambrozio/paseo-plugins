import type { PluginOpenScreenInput, PluginScreenParams } from "@getpaseo/plugin/client";

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
 * The screen param naming the card the detail panel is open on, as
 * `owner/name#number`. A param rather than component state so the open card
 * lives in the screen's URL: a reload, back and forward, and a link keep it.
 */
export const ITEM_PARAM = "item";

/** How a card is spelled in the screen's URL and title: `owner/name#number`. */
export function itemKey(item: Pick<BoardItem, "repository" | "number">): string {
  return `${item.repository}#${item.number}`;
}

/** The card the screen's params name, or null when they name none. */
export function requestedItemKey(params: PluginScreenParams): string | null {
  const value = params[ITEM_PARAM];
  return value === undefined || value === "" ? null : value;
}

/** The params that open the panel on `item`, or close it when `item` is null. */
export function boardScreenInput(item: BoardItem | null): PluginOpenScreenInput {
  return {
    screenId: BOARD_SCREEN_ID,
    params: item === null ? {} : { [ITEM_PARAM]: itemKey(item) },
  };
}

/** The screen header: the open card when there is one, else the board. */
export function boardScreenTitle(params: PluginScreenParams): string {
  const key = requestedItemKey(params);
  return key === null ? BOARD_TITLE : `${BOARD_TITLE} · ${key}`;
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

/**
 * Opening a screen is a `PluginClientContext` capability: `PluginScreenProps`
 * carries the params but no way to change them. `index.client.tsx` lends the
 * opener here at contribution time, which happens before the screen can mount.
 * Module scope belongs to this host's bundle eval, so the opener navigates on
 * the host this board is drawn for.
 */
let openScreen: ((input: PluginOpenScreenInput) => void) | null = null;

export function bindScreenOpener(open: ((input: PluginOpenScreenInput) => void) | null): void {
  openScreen = open;
}

/** Opens the board on `item`, or with no card when null. */
export function showBoardItem(item: BoardItem | null): void {
  if (openScreen === null) {
    throw new Error("github-board: the screen opener is not bound; index.client.tsx binds it");
  }
  openScreen(boardScreenInput(item));
}
