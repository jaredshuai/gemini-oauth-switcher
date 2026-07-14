interface OAuthLoginAutoInspectOptions<T> {
  inspect: () => Promise<T | undefined>;
  onResult: (result: T) => void;
  isComplete: (result: T) => boolean;
  onError?: (error: unknown) => void;
  intervalMs?: number;
  setIntervalFn?: (callback: () => void, intervalMs: number) => unknown;
  clearIntervalFn?: (timer: unknown) => void;
}

export function startOAuthLoginAutoInspect<T>(options: OAuthLoginAutoInspectOptions<T>): () => void {
  const setIntervalFn = options.setIntervalFn ?? ((callback, intervalMs) => window.setInterval(callback, intervalMs));
  const clearIntervalFn = options.clearIntervalFn ?? ((timer) => window.clearInterval(timer as number));
  let stopped = false;
  let inFlight = false;
  let timer: unknown;

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (timer !== undefined) {
      clearIntervalFn(timer);
    }
  };

  const inspect = async () => {
    if (stopped || inFlight) {
      return;
    }
    inFlight = true;
    try {
      const result = await options.inspect();
      if (stopped || !result) {
        return;
      }
      options.onResult(result);
      if (options.isComplete(result)) {
        stop();
      }
    } catch (error) {
      if (!stopped) {
        options.onError?.(error);
      }
    } finally {
      inFlight = false;
    }
  };

  timer = setIntervalFn(() => {
    void inspect();
  }, options.intervalMs ?? 1_500);
  void inspect();

  return stop;
}
