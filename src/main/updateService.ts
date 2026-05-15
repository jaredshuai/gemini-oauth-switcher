import type { AppSettings } from "../shared/types";

interface ShouldCheckForUpdatesOptions {
  settings: Pick<AppSettings, "autoUpdateEnabled">;
  isPackaged: boolean;
  isPortable?: boolean;
}

interface UpdateDialogOptions {
  type: "info";
  buttons: string[];
  defaultId: number;
  cancelId: number;
  title: string;
  message: string;
  detail: string;
}

interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(eventName: "update-downloaded", listener: (info: { version?: string }) => void): unknown;
  on(eventName: "error", listener: (error: unknown) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface StartAutoUpdateChecksOptions extends ShouldCheckForUpdatesOptions {
  updater?: AutoUpdaterLike;
  checkDelayMs?: number;
  setTimeoutFn?: (callback: () => void, delayMs: number) => unknown;
  showMessageBox: (options: UpdateDialogOptions) => Promise<{ response: number }>;
  logWarning?: (message: string, error?: unknown) => void;
}

let hasStartedAutoUpdateChecks = false;

export function shouldCheckForUpdates(options: ShouldCheckForUpdatesOptions): boolean {
  return options.isPackaged && !options.isPortable && options.settings.autoUpdateEnabled !== false;
}

export async function startAutoUpdateChecks(options: StartAutoUpdateChecksOptions): Promise<boolean> {
  if (!shouldCheckForUpdates(options) || hasStartedAutoUpdateChecks) {
    return false;
  }

  const updater = options.updater ?? (await loadAutoUpdater());
  hasStartedAutoUpdateChecks = true;

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("error", (error) => {
    const logWarning = options.logWarning ?? console.warn;
    logWarning("Auto update check failed.", error);
  });
  updater.on("update-downloaded", (info) => {
    void promptToInstallUpdate({ updater, showMessageBox: options.showMessageBox, version: info.version });
  });

  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  setTimeoutFn(() => {
    void updater.checkForUpdates().catch((error: unknown) => {
      const logWarning = options.logWarning ?? console.warn;
      logWarning("Auto update check failed.", error);
    });
  }, options.checkDelayMs ?? 5_000);

  return true;
}

async function loadAutoUpdater(): Promise<AutoUpdaterLike> {
  const electronUpdater = await import("electron-updater");
  return electronUpdater.autoUpdater as AutoUpdaterLike;
}

async function promptToInstallUpdate(options: {
  updater: AutoUpdaterLike;
  showMessageBox: (options: UpdateDialogOptions) => Promise<{ response: number }>;
  version?: string;
}): Promise<void> {
  const versionText = options.version ? ` ${options.version}` : "";
  const result = await options.showMessageBox({
    type: "info",
    buttons: ["重启安装", "稍后"],
    defaultId: 0,
    cancelId: 1,
    title: "发现新版本",
    message: `新版本${versionText}已下载`,
    detail: "重启应用后会自动安装更新。当前账号目录和 OAuth 文件不会被修改。"
  });

  if (result.response === 0) {
    options.updater.quitAndInstall(false, true);
  }
}
