/**
 * Runs read-check-write sequences one at a time per key, so two RPCs landing
 * together cannot both read the same state and then both write over it. It
 * orders this daemon process only — the first mate writing a file itself is
 * not in the queue, which is what the editor's version check is for.
 */
const tails = new Map<string, Promise<unknown>>();

export function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(task);
  // A failed task must not wedge the ones queued behind it.
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(function () {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
