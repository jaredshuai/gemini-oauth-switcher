import { describe, expect, it, vi } from "vitest";
import { createStartupSettingsService } from "../src/main/startupSettingsService";
import type { AppSettings } from "../src/shared/types";

const SETTINGS: AppSettings = {
  profilesRoot: "C:\\profiles",
  selectedTool: "gemini",
  autoUpdateEnabled: true,
  usageDisplayMode: "used",
  uiTheme: "classic"
};

describe("startupSettingsService", () => {
  it("loads settings once and retains the startup recovery state for diagnostics", async () => {
    const readSettings = vi.fn().mockResolvedValue({
      settings: SETTINGS,
      status: "recovered_from_backup" as const
    });
    const service = createStartupSettingsService({ readSettings });

    expect(service.getReadStatus()).toBeUndefined();
    await expect(service.load()).resolves.toEqual(SETTINGS);
    await expect(service.load()).resolves.toEqual(SETTINGS);

    expect(readSettings).toHaveBeenCalledTimes(1);
    expect(service.getReadStatus()).toBe("recovered_from_backup");
  });

  it("allows startup settings to be retried after a transient read failure", async () => {
    const readSettings = vi.fn()
      .mockRejectedValueOnce(new Error("temporary read failure"))
      .mockResolvedValueOnce({ settings: SETTINGS, status: "loaded" as const });
    const service = createStartupSettingsService({ readSettings });

    await expect(service.load()).rejects.toThrow(/temporary read failure/);
    await expect(service.load()).resolves.toEqual(SETTINGS);

    expect(readSettings).toHaveBeenCalledTimes(2);
    expect(service.getReadStatus()).toBe("loaded");
  });
});
