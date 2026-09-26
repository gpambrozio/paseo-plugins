/**
 * Which suggestions have a removal on its way, by what they say rather than where they sit: a poll or
 * another removal can move a card while its request is out, and the card has to stay shut wherever it
 * lands. Two identical suggestions are one key, so both wait while either is being removed — a second
 * press on the twin could otherwise take out one line more than the captain meant. Pure.
 */
import type { Suggestion } from "../shared/fleet";

export function suggestionKey(suggestion: Suggestion): string {
  return JSON.stringify([suggestion.label, suggestion.prompt]);
}

export interface RemovalGate {
  pending: (suggestion: Suggestion) => boolean;
  /**
   * Runs `task` unless a removal of the same suggestion is already out; null when refused. Checked and
   * shut synchronously, so two presses before a re-render still start one removal.
   */
  run: (suggestion: Suggestion, task: () => Promise<void>) => Promise<void> | null;
}

export function createRemovalGate(onChange: () => void): RemovalGate {
  const keys = new Set<string>();
  return {
    pending: (suggestion) => keys.has(suggestionKey(suggestion)),
    run(suggestion, task) {
      const key = suggestionKey(suggestion);
      if (keys.has(key)) return null;
      keys.add(key);
      onChange();
      let started: Promise<void>;
      try {
        started = task();
      } catch (error) {
        started = Promise.reject(error);
      }
      return started.finally(() => {
        keys.delete(key);
        onChange();
      });
    },
  };
}
