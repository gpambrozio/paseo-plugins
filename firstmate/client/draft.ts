/**
 * Half-typed messages to the first mate, one per first mate.
 *
 * Module scope is not enough to keep them. The app drops a plugin whenever
 * its host's connection drops — the phone going to the background, the Mac
 * sleeping, the network changing — and evaluates the bundle afresh when the
 * connection is back, so every module-scope variable starts over and the
 * draft with it. The app evaluates the bundle in its own global scope, though,
 * so a slot on `globalThis` is still there for the new evaluation to find: a
 * draft lasts as long as the app does. The CHAT composer also persists text
 * through `chat-drafts`; card answers remain memory-only.
 */
export interface DraftStore {
  get(key: string): string;
  /** An empty draft is forgotten rather than kept. */
  set(key: string, text: string): void;
  /**
   * Called after every `set`, so the chat on screen hears a change made by
   * another — a failed send putting its text back after the chat that sent it
   * was unmounted. Returns the unsubscribe.
   */
  subscribe(listener: () => void): () => void;
}

/** A registered symbol, so each evaluation of the bundle names the same slot. */
const SLOT = Symbol.for("paseo.firstmate.drafts");

/** The drafts kept on `root`; every store built on the same root shares them. */
export function createDraftStore(root: object): DraftStore {
  let drafts = Reflect.get(root, SLOT) as Map<string, string> | undefined;
  if (!(drafts instanceof Map)) {
    drafts = new Map<string, string>();
    Reflect.set(root, SLOT, drafts);
  }
  const store = drafts;
  const listenerSlot = Symbol.for("paseo.firstmate.draft-listeners");
  let listeners = Reflect.get(root, listenerSlot) as Set<() => void> | undefined;
  if (!listeners) {
    listeners = new Set<() => void>();
    Reflect.set(root, listenerSlot, listeners);
  }
  const sharedListeners = listeners;
  return {
    get: (key) => store.get(key) ?? "",
    set: (key, text) => {
      if (text === "") store.delete(key);
      else store.set(key, text);
      sharedListeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      sharedListeners.add(listener);
      return () => sharedListeners.delete(listener);
    },
  };
}

export const drafts = createDraftStore(globalThis);
