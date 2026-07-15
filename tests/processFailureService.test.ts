import { describe, expect, it, vi } from "vitest";
import { createProcessFailureHandlers } from "../src/main/processFailureService";

describe("processFailureService", () => {
  it("records a fatal main-process error before showing a generic message and exiting", async () => {
    const events: string[] = [];
    const handlers = createProcessFailureHandlers({
      logError: async (event, metadata) => {
        events.push(`log:${event}:${metadata.name}`);
      },
      logWarning: async () => undefined,
      showFatalError: () => events.push("show"),
      exit: (code) => events.push(`exit:${code}`)
    });

    await handlers.handleUncaughtException(new Error("refresh_token=secret"));

    expect(events).toEqual(["log:main.uncaught_exception:Error", "show", "exit:1"]);
  });

  it("records unhandled rejections without terminating the application", async () => {
    const exit = vi.fn();
    const logWarning = vi.fn().mockResolvedValue(undefined);
    const handlers = createProcessFailureHandlers({
      logError: async () => undefined,
      logWarning,
      showFatalError: () => undefined,
      exit
    });

    await handlers.handleUnhandledRejection("rejected");

    expect(logWarning).toHaveBeenCalledWith("main.unhandled_rejection", { type: "string" });
    expect(exit).not.toHaveBeenCalled();
  });

  it("still exits when diagnostic logging or the fatal dialog throws synchronously", async () => {
    const exit = vi.fn();
    const handlers = createProcessFailureHandlers({
      logError: () => {
        throw new Error("logger unavailable");
      },
      logWarning: async () => undefined,
      showFatalError: () => {
        throw new Error("dialog unavailable");
      },
      exit
    });

    await expect(handlers.handleUncaughtException(new Error("fatal"))).resolves.toBeUndefined();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
