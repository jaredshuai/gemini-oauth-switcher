import { describe, expect, it, vi } from "vitest";
import { startOAuthLoginAutoInspect } from "../src/renderer/oauthLoginPolling";

describe("OAuth login auto inspection", () => {
  it("polls until a credential is detected and then stops", async () => {
    const callbacks: Array<() => void> = [];
    const clearIntervalFn = vi.fn();
    const inspect = vi.fn()
      .mockResolvedValueOnce({ oauthExists: false })
      .mockResolvedValueOnce({ oauthExists: true, accountEmail: "user@example.com" });
    const onResult = vi.fn();

    const stop = startOAuthLoginAutoInspect({
      inspect,
      onResult,
      isComplete: (result) => result.oauthExists,
      setIntervalFn: (callback) => {
        callbacks.push(callback);
        return 17;
      },
      clearIntervalFn
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenLastCalledWith({ oauthExists: false });

    callbacks[0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(onResult).toHaveBeenLastCalledWith({ oauthExists: true, accountEmail: "user@example.com" });
    expect(clearIntervalFn).toHaveBeenCalledWith(17);

    stop();
  });

  it("does not overlap inspections when one request is still running", async () => {
    let resolveInspection: ((value: { oauthExists: boolean }) => void) | undefined;
    const inspection = new Promise<{ oauthExists: boolean }>((resolve) => {
      resolveInspection = resolve;
    });
    let tick: (() => void) | undefined;
    const inspect = vi.fn(() => inspection);
    const stop = startOAuthLoginAutoInspect({
      inspect,
      onResult: vi.fn(),
      isComplete: () => false,
      setIntervalFn: (callback) => {
        tick = callback;
        return 22;
      },
      clearIntervalFn: vi.fn()
    });

    tick?.();
    tick?.();
    expect(inspect).toHaveBeenCalledTimes(1);

    resolveInspection?.({ oauthExists: false });
    await inspection;
    stop();
  });
});
