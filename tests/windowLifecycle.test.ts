import { describe, expect, it } from "vitest";
import { ensureWindowBoundsVisible, persistWindowBoundsBeforeClose, shouldHideWindowOnClose, type ClosableWindow } from "../src/main/windowLifecycle";

describe("window close behavior", () => {
  it("keeps saved bounds when the title bar remains reachable", () => {
    expect(ensureWindowBoundsVisible(
      { x: -900, y: 80, width: 900, height: 700 },
      [
        { x: -1280, y: 0, width: 1280, height: 1024 },
        { x: 0, y: 0, width: 1920, height: 1080 }
      ]
    )).toEqual({ x: -900, y: 80, width: 900, height: 700 });
  });

  it("drops stale coordinates when the saved title bar is off every display", () => {
    expect(ensureWindowBoundsVisible(
      { x: 2600, y: -800, width: 900, height: 700 },
      [{ x: 0, y: 0, width: 1920, height: 1080 }]
    )).toEqual({ width: 900, height: 700 });
  });

  it("does not hide the window when tray mode is enabled but no tray exists", () => {
    expect(
      shouldHideWindowOnClose({
        isQuitting: false,
        trayBehavior: "minimize_to_tray",
        hasTray: false
      })
    ).toBe(false);
  });

  it("hides the window only when tray mode is active and a tray exists", () => {
    expect(
      shouldHideWindowOnClose({
        isQuitting: false,
        trayBehavior: "minimize_to_tray",
        hasTray: true
      })
    ).toBe(true);
    expect(
      shouldHideWindowOnClose({
        isQuitting: false,
        trayBehavior: "exit",
        hasTray: true
      })
    ).toBe(false);
    expect(
      shouldHideWindowOnClose({
        isQuitting: true,
        trayBehavior: "minimize_to_tray",
        hasTray: true
      })
    ).toBe(false);
  });

  it("waits for window bounds to be saved before hiding the window", async () => {
    const events: string[] = [];
    const window = makeClosableWindow(events);

    await persistWindowBoundsBeforeClose({
      window,
      hideOnClose: true,
      saveWindowBounds: async () => {
        events.push("save:start");
        await Promise.resolve();
        events.push("save:end");
      }
    });

    expect(events).toEqual(["save:start", "save:end", "hide"]);
  });

  it("destroys the window after attempting to save bounds on exit", async () => {
    const events: string[] = [];
    const window = makeClosableWindow(events);

    await expect(
      persistWindowBoundsBeforeClose({
        window,
        hideOnClose: false,
        saveWindowBounds: async () => {
          events.push("save:start");
          throw new Error("write failed");
        }
      })
    ).rejects.toThrow(/write failed/);

    expect(events).toEqual(["save:start", "destroy"]);
  });
});

function makeClosableWindow(events: string[]): ClosableWindow {
  return {
    getBounds: () => ({ width: 900, height: 700 }),
    hide: () => {
      events.push("hide");
    },
    destroy: () => {
      events.push("destroy");
    }
  };
}
