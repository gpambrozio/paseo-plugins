import type { DraftStore } from "./draft";

/** One controller per composer, retained across navigation. Writes never overlap.
 * The 300 ms debounce is flushed on background/unmount; neither a flush nor
 * an RPC can guarantee delivery if the OS kills the app before it completes.
 */
export function persistDraft(store: DraftStore, key: string, read: () => Promise<string>,
  write: (text: string) => Promise<unknown>, report: (error: unknown) => void) {
  let current = store.get(key);
  let edited = current !== "";
  let hydrated = false;
  let dirty = edited;
  let applying = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = Promise.resolve();
  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    if (!hydrated || !dirty) return pending;
    dirty = false;
    const text = current;
    pending = pending.then(async () => {
      try { await write(text); }
      catch (error) { dirty = true; report(error); }
    });
    return pending;
  }
  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, 300);
  }
  const unsubscribe = store.subscribe(() => {
    if (applying || current === store.get(key)) return;
    current = store.get(key);
    edited = true;
    dirty = true;
    if (current === "") void flush();
    else schedule();
  });
  let loaded = false;
  let loading: Promise<void> | undefined;
  function hydrate(): Promise<void> {
    if (loaded) return Promise.resolve();
    if (loading) return loading;
    loading = read().then(text => {
      loaded = true;
      if (!edited) {
        current = text;
        applying = true;
        store.set(key, text);
        applying = false;
      }
      hydrated = true;
      if (dirty) void flush();
    }, error => {
      // Retry hydration on reconnect; never save an untouched empty box.
      hydrated = true;
      report(error);
      if (dirty) void flush();
    }).finally(() => { loading = undefined; });
    return loading;
  }
  const ready = hydrate();
  return { ready, hydrate, flush, stop: () => { unsubscribe(); void flush(); } };
}
