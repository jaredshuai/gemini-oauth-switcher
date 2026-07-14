import { describe, expect, it, vi } from "vitest";
import { configureSingleInstance } from "../src/main/singleInstanceService";

describe("single instance service", () => {
  it("quits immediately when another application instance owns the lock", () => {
    const quit = vi.fn();
    const onSecondInstance = vi.fn();

    expect(configureSingleInstance({
      requestLock: () => false,
      quit,
      onSecondInstance,
      showMainWindow: async () => undefined
    })).toBe(false);

    expect(quit).toHaveBeenCalledOnce();
    expect(onSecondInstance).not.toHaveBeenCalled();
  });

  it("shows the primary window when Windows launches the application again", async () => {
    let secondInstanceListener: (() => void) | undefined;
    const showMainWindow = vi.fn(async () => undefined);

    expect(configureSingleInstance({
      requestLock: () => true,
      quit: vi.fn(),
      onSecondInstance: (listener) => {
        secondInstanceListener = listener;
      },
      showMainWindow
    })).toBe(true);

    secondInstanceListener?.();
    await Promise.resolve();

    expect(showMainWindow).toHaveBeenCalledOnce();
  });

  it("reports a window restore failure without rejecting the event listener", async () => {
    let secondInstanceListener: (() => void) | undefined;
    const error = new Error("window unavailable");
    const onShowError = vi.fn();

    configureSingleInstance({
      requestLock: () => true,
      quit: vi.fn(),
      onSecondInstance: (listener) => {
        secondInstanceListener = listener;
      },
      showMainWindow: async () => {
        throw error;
      },
      onShowError
    });

    secondInstanceListener?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onShowError).toHaveBeenCalledWith(error);
  });
});
