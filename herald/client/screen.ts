/**
 * The Herald screen's id and its one param. Pure.
 *
 * The id is the sidebar item's too, and is not a free choice: Settings ›
 * Sidebar keys its ordering and hidden state on the item id, and a saved
 * `/plugin/herald/sidebar/herald` link resolves to the screen of the same id,
 * so renaming either loses both.
 */
import type { PluginOpenScreenInput, PluginScreenParams } from "@getpaseo/plugin/client";

export const HERALD_SCREEN_ID = "herald";
export const HERALD_TITLE = "Herald";

/**
 * The screen param naming the agent to bring into view, set by the sidebar
 * popover. A param rather than component state so it lives in the screen's URL.
 */
export const AGENT_PARAM = "agent";

/** The agent the screen's params ask it to focus, or null. */
export function focusedAgentId(params: PluginScreenParams): string | null {
  const value = params[AGENT_PARAM];
  return value === undefined || value === "" ? null : value;
}

/** Opens the Herald screen, focused on `agentId` when one is given. */
export function heraldScreenInput(agentId: string | null = null): PluginOpenScreenInput {
  return {
    screenId: HERALD_SCREEN_ID,
    params: agentId === null ? {} : { [AGENT_PARAM]: agentId },
  };
}
