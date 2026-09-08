/**
 * The renderer key for the board's timeline row, in the one form both halves
 * can hold at runtime.
 *
 * `sendToChatHandler` writes these onto the row it appends and the client
 * renderer registers against them, so they are the only thing tying the two
 * together — a mismatch is not a compile error, it is a row that renders as
 * nothing. That makes them exactly the case for a shared *runtime* module:
 * `shared/board.ts` is `import type`-only to the server (see CLAUDE.md), so a
 * constant declared there would have to be duplicated on the daemon side and
 * could then drift.
 *
 * Like `shared/image-host.ts`, this file imports nothing at all, so it stays
 * loadable from the standalone server transpile.
 */

/** Unique within this plugin; the host scopes it by plugin id. */
export const BOARD_ITEM_TIMELINE_KIND = "board-item";

/** Bump when `BoardTimelineItemSchema` changes shape. */
export const BOARD_ITEM_TIMELINE_VERSION = 1;
