import { describe, expect, it } from "vitest";
import { createAsyncOperationQueue } from "../src/main/operationQueue";

describe("async operation queue", () => {
  it("serializes settings-dependent operations", async () => {
    const queue = createAsyncOperationQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const first = queue.run(async () => {
      events.push("first:start");
      markFirstStarted?.();
      await firstGate;
      events.push("first:end");
    });
    const second = queue.run(async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await firstStarted;
    expect(events).toEqual(["first:start"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});
