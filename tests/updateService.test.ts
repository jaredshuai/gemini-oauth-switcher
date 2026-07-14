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

  it("notifies immediately when an update starts downloading", async () => {
    const { updater, listeners } = createFakeUpdater();
    const showMessageBox = vi.fn(async () => ({ response: 0 }));
    const manager = createAutoUpdateManager({
      isPackaged: true,
      isPortable: false,
      updater,
      setTimeoutFn: () => Symbol("timer"),
      clearTimeoutFn: () => undefined,
      showMessageBox,
      prepareToQuitForUpdate: vi.fn()
    });

    await manager.setEnabled(true);
    listeners.get("update-available")?.({ version: "0.2.3" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(showMessageBox).toHaveBeenCalledWith({
      type: "info",
      buttons: ["知道了"],
      defaultId: 0,
      cancelId: 0,
      title: "发现新版本",
      message: "新版本 0.2.3 正在下载",
      detail: "更新会在后台继续下载。下载完成后会再次提示安装，请保持应用运行。"
    });
  });

  it("retains the latest version and download phase for the renderer", async () => {
    const { updater, listeners } = createFakeUpdater();
    const manager = createAutoUpdateManager({
      isPackaged: true,
      isPortable: false,
      updater,
      setTimeoutFn: () => Symbol("timer"),
      clearTimeoutFn: () => undefined,
      showMessageBox: async () => ({ response: 1 }),
      prepareToQuitForUpdate: vi.fn()
    });
    expect(manager.getStatus).toBeTypeOf("function");
    await manager.setEnabled(true);
    expect(manager.getStatus()).toEqual({ phase: "idle" });

    listeners.get("update-available")?.({ version: "0.2.4" });
    expect(manager.getStatus()).toEqual({ phase: "downloading", latestVersion: "0.2.4" });

    listeners.get("update-downloaded")?.({ version: "0.2.4" });
    expect(manager.getStatus()).toEqual({ phase: "downloaded", latestVersion: "0.2.4" });
  });

  it("runs a manual update check immediately and cancels the delayed check", async () => {
    const { updater } = createFakeUpdater();
    const timer = Symbol("timer");
    let scheduledCheck: (() => void) | undefined;
    const clearTimeoutFn = vi.fn();
    const manager = createAutoUpdateManager({
      isPackaged: true,
      isPortable: false,
      updater,
      setTimeoutFn: (callback) => {
        scheduledCheck = callback;
        return timer;
      },
      clearTimeoutFn,
      showMessageBox: async () => ({ response: 1 }),
      prepareToQuitForUpdate: vi.fn()
    });

    await manager.setEnabled(true);
    await expect(manager.checkNow()).resolves.toBe(true);

    expect(clearTimeoutFn).toHaveBeenCalledWith(timer);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(manager.getStatus()).toEqual({ phase: "checking" });

    scheduledCheck?.();
    await Promise.resolve();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("isolates a re-enabled updater from an unresolved check in the previous activation", async () => {
    const { updater, listeners } = createFakeUpdater();
    let rejectOldCheck: ((error: Error) => void) | undefined;
    const oldCheck = new Promise<never>((_resolve, reject) => {
      rejectOldCheck = reject;
    });
    updater.checkForUpdates
      .mockImplementationOnce(() => oldCheck)
      .mockResolvedValueOnce(undefined);
    const scheduledChecks: Array<() => void> = [];
    const manager = createAutoUpdateManager({
      isPackaged: true,
      isPortable: false,
      updater,
      setTimeoutFn: (callback) => {
        scheduledChecks.push(callback);
        return Symbol("timer");
      },
      clearTimeoutFn: () => undefined,
      showMessageBox: async () => ({ response: 1 }),
      prepareToQuitForUpdate: vi.fn()
    });

    await manager.setEnabled(true);
    const oldCheckResult = manager.checkNow();
    await manager.setEnabled(false);
    await manager.setEnabled(true);
    expect(manager.getStatus()).toEqual({ phase: "idle" });

    listeners.get("error")?.(new Error("old event"));
    scheduledChecks.at(-1)?.();
    rejectOldCheck?.(new Error("old check failed"));
    await expect(oldCheckResult).resolves.toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(manager.getStatus()).toEqual({ phase: "checking" });
  });

  it("waits for the download notice before showing the install prompt", async () => {
    const { updater, listeners } = createFakeUpdater();
    let closeDownloadNotice: (() => void) | undefined;
    const downloadNotice = new Promise<void>((resolve) => {
      closeDownloadNotice = resolve;
    });
    const shownMessages: string[] = [];
    const showMessageBox = vi.fn(async (options: { message: string }) => {
      shownMessages.push(options.message);
      if (shownMessages.length === 1) {
        await downloadNotice;
      }
      return { response: 1 };
    });
    const manager = createAutoUpdateManager({
      isPackaged: true,
      isPortable: false,
      updater,
      setTimeoutFn: () => Symbol("timer"),
      clearTimeoutFn: () => undefined,
      showMessageBox,
      prepareToQuitForUpdate: vi.fn()
    });

    await manager.setEnabled(true);
    listeners.get("update-available")?.({ version: "0.2.3" });
    listeners.get("update-downloaded")?.({ version: "0.2.3" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shownMessages).toEqual(["新版本 0.2.3 正在下载"]);

    closeDownloadNotice?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shownMessages).toEqual(["新版本 0.2.3 正在下载", "新版本 0.2.3 已下载"]);
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
