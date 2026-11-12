import type { DraftStore } from "./draft";

/** Clear only after delivery, and only if no follow-up edit occurred meanwhile. */
export function prepareDraftSend(store: DraftStore, key: string, text: string): (success: boolean) => void {
  let changed = false;
  const stop = store.subscribe(() => { if (store.get(key) !== text) changed = true; });
  return success => {
    stop();
    if (success && !changed && store.get(key) === text) store.set(key, "");
  };
}
