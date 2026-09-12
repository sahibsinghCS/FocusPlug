/**
 * Serializes whole-array persists (lists:set-style last-write-wins IPC) so a
 * second edit clicked while the first is in flight is computed from the array
 * the first write returned, not the render-time snapshot — which would
 * silently revert the first change once the second write lands.
 */
export type QueuedWrite<T> = (
  snapshot: readonly T[],
  mutate: (current: readonly T[]) => T[],
) => Promise<T[]>;

export function createWriteQueue<T>(persist: (next: T[]) => Promise<T[]>): QueuedWrite<T> {
  let tail: Promise<unknown> = Promise.resolve();
  // Latest array a write actually persisted; null while the queue is idle so
  // the next write starts from the caller's committed snapshot. A failed
  // write never lands here, so later writes build on the last good array.
  let latest: T[] | null = null;
  let inFlight = 0;

  return (snapshot, mutate) => {
    inFlight += 1;
    const task = tail.then(async (): Promise<T[]> => {
      const returned = await persist(mutate(latest ?? snapshot));
      latest = returned;
      return returned;
    });
    tail = task.then(
      () => undefined,
      () => undefined,
    );
    return task.finally(() => {
      inFlight -= 1;
      if (inFlight === 0) {
        latest = null;
      }
    });
  };
}
