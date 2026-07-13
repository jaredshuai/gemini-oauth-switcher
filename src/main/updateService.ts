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
  on(eventName: "update-available", listener: (info: { version?: string }) => void): unknown;
  on(eventName: "update-downloaded", listener: (info: { version?: string }) => void): unknown;
  on(eventName: "error", listener: (error: unknown) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface AutoUpdateManagerOptions {
  isPackaged: boolean;
  isPortable?: boolean;
  updater?: AutoUpdaterLike;
  loadUpdater?: () => Promise<AutoUpdaterLike>;
  checkDelayMs?: number;
  setTimeoutFn?: (callback: () => void, delayMs: number) => unknown;
  clearTimeoutFn?: (timer: unknown) => void;
  showMessageBox: (options: UpdateDialogOptions) => Promise<{ response: number }>;
  prepareToQuitForUpdate: () => void;
  logWarning?: (message: string, error?: unknown) => void;
}

export interface AutoUpdateManager {
  setEnabled(enabled: boolean): Promise<boolean>;
}

export function shouldCheckForUpdates(options: ShouldCheckForUpdatesOptions): boolean {
  return options.isPackaged && !options.isPortable && options.settings.autoUpdateEnabled !== false;
}

class AutoUpdateManagerImpl implements AutoUpdateManager {
  private activationGeneration = 0;
  private enabled = false;
  private listenersAttached = false;
  private timer: unknown;
  private updater?: AutoUpdaterLike;
  private updaterPromise?: Promise<AutoUpdaterLike>;
  private announcedUpdateVersion?: string;
  private downloadNoticePromise?: Promise<void>;

  constructor(private readonly options: AutoUpdateManagerOptions) {
    this.updater = options.updater;
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    const shouldEnable = shouldCheckForUpdates({
      settings: { autoUpdateEnabled: enabled },
      isPackaged: this.options.isPackaged,
      isPortable: this.options.isPortable
    });

    if (!shouldEnable) {
      this.activationGeneration += 1;
      this.disable();
      return false;
    }
    if (this.enabled) {
      return false;
    }

    const activationGeneration = ++this.activationGeneration;
    this.enabled = true;
    let updater: AutoUpdaterLike;
    try {
      updater = await this.getUpdater();
    } catch (error) {
      if (activationGeneration === this.activationGeneration) {
        this.enabled = false;
      }
      throw error;
    }
    if (!this.enabled) {
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      return false;
    }
    if (activationGeneration !== this.activationGeneration) {
      return false;
    }

    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    this.attachListeners(updater);
    this.scheduleCheck(updater);
    return true;
  }

  private disable(): void {
    this.enabled = false;
    this.announcedUpdateVersion = undefined;
    this.downloadNoticePromise = undefined;
    if (this.timer !== undefined) {
      const clearTimeoutFn = this.options.clearTimeoutFn ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
      clearTimeoutFn(this.timer);
      this.timer = undefined;
    }
    if (this.updater) {
      this.updater.autoDownload = false;
      this.updater.autoInstallOnAppQuit = false;
    }
  }

  private async getUpdater(): Promise<AutoUpdaterLike> {
    if (this.updater) {
      return this.updater;
    }

    const loadUpdater = this.options.loadUpdater ?? loadAutoUpdater;
    this.updaterPromise ??= loadUpdater()
      .then((updater) => {
        this.updater = updater;
        return updater;
      })
      .catch((error: unknown) => {
        this.updaterPromise = undefined;
        throw error;
      });
    return this.updaterPromise;
  }

  private attachListeners(updater: AutoUpdaterLike): void {
    if (this.listenersAttached) {
      return;
    }
    this.listenersAttached = true;

    updater.on("error", (error) => {
      if (this.enabled) {
        this.logWarning("Auto update check failed.", error);
      }
    });
    updater.on("update-available", (info) => {
      if (!this.enabled) {
        return;
      }

      const versionKey = info.version?.trim() || "unknown";
      if (this.announcedUpdateVersion === versionKey) {
        return;
      }
      this.announcedUpdateVersion = versionKey;

      const noticePromise = showUpdateDownloadStarted({
        showMessageBox: this.options.showMessageBox,
        version: info.version
      }).catch((error: unknown) => {
        this.logWarning("Failed to show update download notice.", error);
      });
      this.downloadNoticePromise = noticePromise;
      void noticePromise.finally(() => {
        if (this.downloadNoticePromise === noticePromise) {
          this.downloadNoticePromise = undefined;
        }
      });
    });
    updater.on("update-downloaded", (info) => {
      if (!this.enabled) {
        return;
      }
      const downloadNoticePromise = this.downloadNoticePromise;
      void (async () => {
        await downloadNoticePromise;
        if (!this.enabled) {
          return;
        }
        await promptToInstallUpdate({
          updater,
          showMessageBox: this.options.showMessageBox,
          version: info.version,
          isEnabled: () => this.enabled,
          prepareToQuitForUpdate: this.options.prepareToQuitForUpdate
        });
      })().catch((error: unknown) => {
        this.logWarning("Failed to prompt for update installation.", error);
      });
    });
  }

  private scheduleCheck(updater: AutoUpdaterLike): void {
    const setTimeoutFn = this.options.setTimeoutFn ?? setTimeout;
    this.timer = setTimeoutFn(() => {
      this.timer = undefined;
      if (!this.enabled) {
        return;
      }
      void updater.checkForUpdates().catch((error: unknown) => {
        if (this.enabled) {
          this.logWarning("Auto update check failed.", error);
        }
      });
    }, this.options.checkDelayMs ?? 5_000);
  }

  private logWarning(message: string, error?: unknown): void {
    const logWarning = this.options.logWarning ?? console.warn;
    logWarning(message, error);
  }
}

export function createAutoUpdateManager(options: AutoUpdateManagerOptions): AutoUpdateManager {
  return new AutoUpdateManagerImpl(options);
}

async function loadAutoUpdater(): Promise<AutoUpdaterLike> {
  const electronUpdater = await import("electron-updater");
  return electronUpdater.autoUpdater as AutoUpdaterLike;
}

async function showUpdateDownloadStarted(options: {
  showMessageBox: (options: UpdateDialogOptions) => Promise<{ response: number }>;
  version?: string;
}): Promise<void> {
  const versionLabel = options.version ? `新版本 ${options.version}` : "新版本";
  await options.showMessageBox({
    type: "info",
    buttons: ["知道了"],
    defaultId: 0,
    cancelId: 0,
    title: "发现新版本",
    message: `${versionLabel} 正在下载`,
    detail: "更新会在后台继续下载。下载完成后会再次提示安装，请保持应用运行。"
  });
}

async function promptToInstallUpdate(options: {
  updater: AutoUpdaterLike;
  showMessageBox: (options: UpdateDialogOptions) => Promise<{ response: number }>;
  version?: string;
  isEnabled: () => boolean;
  prepareToQuitForUpdate: () => void;
}): Promise<void> {
  const versionLabel = options.version ? `新版本 ${options.version}` : "新版本";
  const result = await options.showMessageBox({
    type: "info",
    buttons: ["重启安装", "稍后"],
    defaultId: 0,
    cancelId: 1,
    title: "发现新版本",
    message: `${versionLabel} 已下载`,
    detail: "重启应用后会自动安装更新。当前账号目录和 OAuth 文件不会被修改。"
  });

  if (result.response === 0 && options.isEnabled()) {
    options.prepareToQuitForUpdate();
    options.updater.quitAndInstall(false, true);
  }
}
