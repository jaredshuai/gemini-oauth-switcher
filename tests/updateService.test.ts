import { describe, expect, it } from "vitest";
import { shouldCheckForUpdates } from "../src/main/updateService";

describe("auto update checks", () => {
  it("only checks for updates in packaged builds when enabled", () => {
    expect(shouldCheckForUpdates({ settings: {}, isPackaged: true })).toBe(true);
    expect(shouldCheckForUpdates({ settings: { autoUpdateEnabled: true }, isPackaged: true })).toBe(true);
    expect(shouldCheckForUpdates({ settings: { autoUpdateEnabled: false }, isPackaged: true })).toBe(false);
    expect(shouldCheckForUpdates({ settings: {}, isPackaged: false })).toBe(false);
    expect(shouldCheckForUpdates({ settings: {}, isPackaged: true, isPortable: true })).toBe(false);
  });
});
