/**
 * How the table is ordered.
 *
 * This lives in `shared/` rather than beside the table it serves for one
 * reason: it is the only non-trivial logic on the client side, and a module
 * that imports React Native cannot be unit-tested here. Nothing about ordering
 * needs a renderer, so it does not have to be in one.
 */
import type { PriceRow } from "./pricing";
import { providerLabel } from "./providers";

/** One row, with the relative multiple already worked out for the visible set. */
export interface TableRow {
  row: PriceRow;
  relative: number;
}

export type SortKey = "name" | "context" | "output" | "price" | "relative" | "provider";

export interface Sort {
  key: SortKey;
  descending: boolean;
}

/**
 * Ordering for one key.
 *
 * **Unknowns sort last whichever way the arrow points.** A model that does not
 * publish its context window is not the model with the smallest one, so the
 * null test sits outside the direction multiply rather than inside it — putting
 * it inside would float every em dash to the top on one of the two presses.
 */
export function compareRows(a: TableRow, b: TableRow, sort: Sort): number {
  const direction = sort.descending ? -1 : 1;
  switch (sort.key) {
    case "name":
      return a.row.name.localeCompare(b.row.name) * direction;
    case "provider":
      // Ties broken by name, so pressing PLATFORM twice does not shuffle the
      // rows within a provider.
      return (
        (providerLabel(a.row.providerId).localeCompare(providerLabel(b.row.providerId)) ||
          a.row.name.localeCompare(b.row.name)) * direction
      );
    case "context":
      return compareNullable(a.row.contextTokens, b.row.contextTokens, direction);
    case "output":
      return compareNullable(a.row.outputTokens, b.row.outputTokens, direction);
    case "price":
      // Input price alone, deliberately: RELATIVE already orders by the blend
      // of input and output, so ordering PRICE the same way would give two
      // columns that sort identically and no way to rank on input cost.
      return compareNullable(a.row.inputCost, b.row.inputCost, direction);
    case "relative":
      return compareNullable(a.relative, b.relative, direction);
  }
}

function compareNullable(a: number | null, b: number | null, direction: number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}
