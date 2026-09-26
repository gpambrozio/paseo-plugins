/**
 * Which suggestions have a removal on its way, by what they say rather than where they sit: a poll or
 * another removal can move a card while its request is out, and the card has to stay shut wherever it
 * lands. Two identical suggestions are one key, so both wait while either is being removed — a second
 * press on the twin could otherwise take out one line more than the captain meant. Pure.
 *
 * The gate the lists use is in module scope, like the send gate (`./mate-send`): a phone switching tabs,
 * or a wide layout switching the board for Files, unmounts the list while a request can still be out,
 * and the list that mounts next has to find that suggestion still shut.
 */
import type { Suggestion } from "../shared/fleet";

export function suggestionKey(suggestion: Suggestion): string {
  return JSON.stringify([suggestion.label, suggestion.prompt]);
}

export interface RemovalGate {
  pending(suggestion: Suggestion): boolean;
  /** Changes whenever a removal starts or settles; what a list re-renders on. */
  version(): number;
  subscribe(listener: () => void): () => void;
  /**
   * Runs `task` unless a removal of the same suggestion is already out; null when refused. Checked and
   * shut synchronously, so two presses before a re-render still start one removal.
   */
  run(suggestion: Suggestion, task: () => Promise<void>): Promise<void> | null;
}

export function createRemovalGate(): RemovalGate {
  const keys = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;
  function changed(): void {
    version += 1;
    listeners.forEach((listener) => listener());
  }
  return {
    pending: (suggestion) => keys.has(suggestionKey(suggestion)),
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run(suggestion, task) {
      const key = suggestionKey(suggestion);
      if (keys.has(key)) return null;
      keys.add(key);
      changed();
      let started: Promise<void>;
      try {
        started = task();
      } catch (error) {
        started = Promise.reject(error);
      }
      return started.finally(() => {
        keys.delete(key);
        changed();
      });
    },
  };
}

/** Every suggestion list's gate, for the life of the loaded bundle. */
export const suggestionRemovals: RemovalGate = createRemovalGate();
