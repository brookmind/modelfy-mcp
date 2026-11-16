export type Queue = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Runs tasks one at a time, in the order they were queued; a failed task
 * does not stop the ones after it.
 */
export function createQueue(): Queue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}
