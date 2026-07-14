export interface AsyncOperationQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export function createAsyncOperationQueue(): AsyncOperationQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const next = tail.catch(() => undefined).then(operation);
      tail = next;
      return next;
    }
  };
}
