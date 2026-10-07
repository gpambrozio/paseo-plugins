/**
 * The pricing screen's id, title and icon, shared by the entry and the sidebar
 * row. Pure.
 *
 * The screen takes the id of the sidebar item it replaced, `model-pricing`, not
 * the old surface's `pricing`: Settings › Sidebar keys its order and hidden
 * state on the item id, and a saved `/plugin/model-pricing/sidebar/model-pricing`
 * link resolves to the screen of the same id, so renaming it loses both.
 */
export const PRICING_SCREEN_ID = "model-pricing";
export const PRICING_TITLE = "Model pricing";

/** Any Lucide component name. A typo load-fails the whole plugin. */
export const PRICING_ICON = "CircleDollarSign";
