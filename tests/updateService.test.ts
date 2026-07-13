import { describe, expect, it, vi } from "vitest";
import { createAutoUpdateManager, shouldCheckForUpdates } from "../src/main/updateService";

type UpdateListener = (value: unknown) => void;

function createFakeUpdater() {
  const listeners = new Map<string, UpdateListener>();
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: vi.fn((eventName: string, listener: UpdateListener) => {
      listeners.set(eventName, listener);
      return updater;
    }),
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn()
  };

  return { updater, listeners };
}

describe("auto update checks", () => {
  it("only checks for updates in packaged builds when enabled", () => {
    expect(shouldCheckForUpdates({ settings: {}, isPackaged: true })).toBe(true);
    expect(shouldCheckForUpdates({ settings: { autoUpdateEnabled: true }, isPackaged: true })).toBe(true);
    expect(shouldCheckForUpdates({ settings: { autoUpdateEnabled: false }, isPackaged: true })).toBe(false);
    expect(shouldCheckForUpdates({ settings: {}, isPackaged: false })).toBe(false);
    expect(shouldCheckForUpdates({ settings: {}, isPackaged: true, isPortable: true })).toBe(false);
  });

  it("prepares the app to quit before installing a downloaded update", async () => {
    const { updater, listeners } = createFakeUpdater();
    const actions: string[] = [];
    updater.quitAndInstall.mockImplementation(() => {
      actions.push("install");
    });
    const manager = createAutoUpdateManager({
      isPackaged: true,
      isPortable: false,
      updater,
      setTimeoutFn: () => Symbol("timer"),
      clearTimeoutFn: () => undefined,
      showMessageBox: async () => ({ response: 0 }),
      prepareToQuitForUpdate: () => {
        actions.push("prepare");
      }
    });

    await manager.setEnabled(true);
    listeners.get("update-downloaded")?.({ version: "0.2.0" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(actions).toEqual(["prepare", "install"]);
  });

  it("cancels the pending check and suppresses installation when disabled", async () => {
    const { updater, listeners } = createFakeUpdater();
    const timer = Symbol("timer");
    let scheduledCheck: (() => void) | undefined;
    const clearTimeoutFn = vi.fn();
    const showMessageBox = vi.fn(async () => ({ response: 0 }));
    const manager = createAutoUpdateManager({
      isPackaged: true,
      isPortable: false,
      updater,
      setTimeoutFn: (callback: () => void) => {
        scheduledCheck = callback;
        return timer;
      },
      clearTimeoutFn,
      showMessageBox,
      prepareToQuitForUpdate: vi.fn()
    });

    await manager.setEnabled(true);
    await manager.setEnabled(false);
    scheduledCheck?.();
    listeners.get("update-downloaded")?.({ version: "0.2.0" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clearTimeoutFn).toHaveBeenCalledWith(timer);
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("ignores a stale enable request while the updater is loading", async () => {
    const { updater } = createFakeUpdater();
    let resolveUpdater: ((value: typeof updater) => void) | undefined;
    const updaterPromise = new Promise<typeof updater>((resolve) => {
      resolveUpdater = resolve;
    });
    const setTimeoutFn = vi.fn(() => Symbol("timer"));
    const manager = createAutoUpdateManager({
      isPackaged: true,
      isPortable: false,
      loadUpdater: () => updaterPromise,
      setTimeoutFn,
      clearTimeoutFn: vi.fn(),
      showMessageBox: async () => ({ response: 1 }),
      prepareToQuitForUpdate: vi.fn()
    });

    const firstEnable = manager.setEnabled(true);
    await manager.setEnabled(false);
    const secondEnable = manager.setEnabled(true);
    resolveUpdater!(updater);

    expect(await firstEnable).toBe(false);
    expect(await secondEnable).toBe(true);
    expect(setTimeoutFn).toHaveBeenCalledTimes(1);
  });

  it("keeps the in-flight activation when enabled is synchronized twice", async () => {
    const { updater } = createFakeUpdater();
    let resolveUpdater: ((value: typeof updater) => void) | undefined;
    const updaterPromise = new Promise<typeof updater>((resolve) => {
      resolveUpdater = resolve;
    });
    const setTimeoutFn = vi.fn(() => Symbol("timer"));
    const manager = createAutoUpdateManager({
      isPackaged: true,
      isPortable: false,
      loadUpdater: () => updaterPromise,
      setTimeoutFn,
      clearTimeoutFn: vi.fn(),
      showMessageBox: async () => ({ response: 1 }),
      prepareToQuitForUpdate: vi.fn()
    });

    const firstEnable = manager.setEnabled(true);
    await expect(manager.setEnabled(true)).resolves.toBe(false);
    resolveUpdater!(updater);

    await expect(firstEnable).resolves.toBe(true);
    expect(setTimeoutFn).toHaveBeenCalledTimes(1);
  });

  it("can retry after updater initialization fails", async () => {
    const { updater } = createFakeUpdater();
    const loadUpdater = vi.fn()
      .mockRejectedValueOnce(new Error("load failed"))
      .mockResolvedValueOnce(updater);
    const manager = createAutoUpdateManager({
      isPackaged: true,
      isPortable: false,
      loadUpdater,
      setTimeoutFn: () => Symbol("timer"),
      clearTimeoutFn: vi.fn(),
      showMessageBox: async () => ({ response: 1 }),
      prepareToQuitForUpdate: vi.fn()
    });

    await expect(manager.setEnabled(true)).rejects.toThrow("load failed");
    await expect(manager.setEnabled(true)).resolves.toBe(true);
    expect(loadUpdater).toHaveBeenCalledTimes(2);
  });
});
