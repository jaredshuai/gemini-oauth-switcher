import path from "node:path";
import { existsSync } from "node:fs";
import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import type { AppSettings, OAuthLoginCancelRequest, OAuthLoginSaveRequest, OAuthLoginSession, RevealTarget, TrayBehavior } from "../shared/types";
import { getDefaultProfilesRoot, getDefaultTargetGeminiDir, getDefaultTargetOAuthPath, getSettingsPath } from "./paths";
import {
  cleanupOAuthLoginSession,
  cleanupStaleOAuthLoginSessions,
  createOAuthLoginSession,
  inspectOAuthLoginSession,
  saveOAuthLoginSession
} from "./oauthLoginService";
import { deleteProfile, getProfileOAuthPath, listProfiles, switchProfile, validateProfileName } from "./profileService";
import { readSettings, saveSettings } from "./settings";
import { collectLocalDiagnostics } from "./systemDiagnostics";
import { queryGeminiUsageFromOAuthFile } from "./usageService";
import { persistWindowBoundsBeforeClose, shouldHideWindowOnClose } from "./windowLifecycle";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let trayBehavior: TrayBehavior = "exit";
const oauthLoginSessions = new Map<string, OAuthLoginSession>();

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function settingsPath(): string {
  return getSettingsPath(app.getPath("userData"));
}

function getAppIconPath(): string | undefined {
  const appIconPath = path.join(app.getAppPath(), "assets", "app-icon.ico");
  const resourceIconPath = path.join(process.resourcesPath, "assets", "app-icon.ico");
  const candidates = app.isPackaged ? [resourceIconPath, appIconPath] : [appIconPath, resourceIconPath];

  return candidates.find((candidate) => existsSync(candidate));
}

function getConfiguredProfilesRoot(settings: AppSettings): string {
  return settings.profilesRoot || getDefaultProfilesRoot();
}

async function openResolvedPath(targetPath: string): Promise<void> {
  const openError = await shell.openPath(path.resolve(targetPath));
  if (openError) {
    throw new Error(openError);
  }
}

async function showMainWindow(): Promise<void> {
  if (!mainWindow) {
    await createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  if (tray) {
    return;
  }

  const iconPath = getAppIconPath();
  if (!iconPath) {
    return;
  }

  tray = new Tray(iconPath);
  tray.setToolTip("Gemini OAuth Switcher");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开主窗口",
        click: () => {
          void showMainWindow();
        }
      },
      {
        label: "打开账号库目录",
        click: async () => {
          const settings = await readSettings(settingsPath());
          await openResolvedPath(getConfiguredProfilesRoot(settings));
        }
      },
      {
        label: "打开 Gemini CLI 默认目录",
        click: async () => {
          await openResolvedPath(getDefaultTargetGeminiDir());
        }
      },
      { type: "separator" },
      {
        label: "退出应用",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );

  tray.on("click", () => {
    void showMainWindow();
  });
  tray.on("double-click", () => {
    void showMainWindow();
  });
}

function normalizeProfileName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Profile name is required");
  }

  return validateProfileName(value);
}

function normalizeLoginSessionId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Login session id is required");
  }

  return value.trim();
}

function getOAuthLoginSession(rawSessionId: unknown): OAuthLoginSession {
  const sessionId = normalizeLoginSessionId(rawSessionId);
  const session = oauthLoginSessions.get(sessionId);
  if (!session) {
    throw new Error("Login session was not found. Start a new login first.");
  }

  return session;
}

function normalizeOAuthLoginSaveRequest(value: unknown): OAuthLoginSaveRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Login save request is required");
  }

  const input = value as { sessionId?: unknown; profileName?: unknown; nickname?: unknown };
  return {
    sessionId: normalizeLoginSessionId(input.sessionId),
    profileName: typeof input.profileName === "string" ? input.profileName : undefined,
    nickname: typeof input.nickname === "string" ? input.nickname : undefined
  };
}

function normalizeOAuthLoginCancelRequest(value: unknown): OAuthLoginCancelRequest {
  if (typeof value === "string") {
    return { sessionId: normalizeLoginSessionId(value) };
  }
  if (!value || typeof value !== "object") {
    throw new Error("Login cancel request is required");
  }

  const input = value as { sessionId?: unknown; pendingProfilePath?: unknown };
  return {
    sessionId: normalizeLoginSessionId(input.sessionId),
    pendingProfilePath: typeof input.pendingProfilePath === "string" ? input.pendingProfilePath : undefined
  };
}

function normalizeRevealTarget(value: unknown): RevealTarget {
  if (value === "profilesRoot" || value === "targetGeminiDir") {
    return value;
  }

  throw new Error("Unsupported path target");
}

function logWindowClosePersistenceError(error: unknown): void {
  console.error("Failed to save window bounds before closing.", error);
}

function logStaleLoginCleanupResult(result: { failed: string[]; skipped: string[] }): void {
  if (result.failed.length > 0) {
    console.warn("Failed to clean stale OAuth login entries.", result.failed);
  }
  if (result.skipped.length > 0) {
    console.warn("Skipped suspicious OAuth login entries during cleanup.", result.skipped);
  }
}

async function createWindow(): Promise<void> {
  const settings = await readSettings(settingsPath());
  const bounds = settings.windowBounds ?? { width: 1040, height: 760 };
  trayBehavior = settings.trayBehavior ?? "exit";

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 860,
    minHeight: 560,
    title: "Gemini OAuth Switcher",
    icon: getAppIconPath(),
    backgroundColor: "#f6f4ef",
    autoHideMenuBar: true,
    show: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    const closingWindow = mainWindow;
    if (!closingWindow) {
      return;
    }

    const hideOnClose = shouldHideWindowOnClose({
      isQuitting,
      trayBehavior,
      hasTray: Boolean(tray)
    });
    event.preventDefault();
    void persistWindowBoundsBeforeClose({
      window: closingWindow,
      hideOnClose,
      saveWindowBounds: (windowBounds) => saveSettings(settingsPath(), { windowBounds })
    }).catch(logWindowClosePersistenceError);
  });

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("settings:get", async () => readSettings(settingsPath()));

  ipcMain.handle("settings:save", async (_event, patch: Partial<AppSettings>) => {
    const nextSettings = await saveSettings(settingsPath(), patch);
    trayBehavior = nextSettings.trayBehavior ?? "exit";
    return nextSettings;
  });

  ipcMain.handle("profiles:list", async () => {
    const settings = await readSettings(settingsPath());
    const targetOAuthPath = getDefaultTargetOAuthPath();

    return listProfiles({
      profilesRoot: getConfiguredProfilesRoot(settings),
      targetOAuthPath
    });
  });

  ipcMain.handle("profiles:switch", async (_event, rawProfileName: unknown) => {
    const profileName = normalizeProfileName(rawProfileName);
    const settings = await readSettings(settingsPath());
    const result = await switchProfile({
      profilesRoot: getConfiguredProfilesRoot(settings),
      profileName,
      targetOAuthPath: getDefaultTargetOAuthPath()
    });

    await saveSettings(settingsPath(), {
      lastSelectedProfile: profileName,
      lastSwitch: {
        profileName,
        switchedAt: Date.now(),
        verified: true
      }
    });

    return result;
  });

  ipcMain.handle("profiles:delete", async (_event, rawProfileName: unknown) => {
    const profileName = normalizeProfileName(rawProfileName);
    const settings = await readSettings(settingsPath());
    const result = await deleteProfile({
      profilesRoot: getConfiguredProfilesRoot(settings),
      profileName,
      targetOAuthPath: getDefaultTargetOAuthPath(),
      removeDirectory: (profilePath) => shell.trashItem(profilePath)
    });

    if (settings.lastSelectedProfile === profileName) {
      await saveSettings(settingsPath(), {
        lastSelectedProfile: undefined
      });
    }

    return result;
  });

  ipcMain.handle("profiles:usage:refresh", async (_event, rawProfileName: unknown) => {
    const profileName = normalizeProfileName(rawProfileName);
    const settings = await readSettings(settingsPath());
    const profilesRoot = getConfiguredProfilesRoot(settings);

    return queryGeminiUsageFromOAuthFile({
      profileName,
      oauthPath: getProfileOAuthPath(profilesRoot, profileName)
    });
  });

  ipcMain.handle("profiles:usage:refreshAll", async () => {
    const settings = await readSettings(settingsPath());
    const profilesRoot = getConfiguredProfilesRoot(settings);
    const result = await listProfiles({
      profilesRoot,
      targetOAuthPath: getDefaultTargetOAuthPath()
    });

    const usages = await Promise.all(
      result.profiles.map(async (profile) => [
        profile.name,
        await queryGeminiUsageFromOAuthFile({
          profileName: profile.name,
          oauthPath: getProfileOAuthPath(profilesRoot, profile.name)
        })
      ] as const)
    );

    return Object.fromEntries(usages);
  });

  ipcMain.handle("diagnostics:get", async () => collectLocalDiagnostics());

  ipcMain.handle("oauthLogin:start", async () => {
    const settings = await readSettings(settingsPath());
    const session = await createOAuthLoginSession({
      profilesRoot: getConfiguredProfilesRoot(settings)
    });
    oauthLoginSessions.set(session.sessionId, session);

    return session;
  });

  ipcMain.handle("oauthLogin:inspect", async (_event, rawSessionId: unknown) => {
    const session = getOAuthLoginSession(rawSessionId);
    const settings = await readSettings(settingsPath());

    return inspectOAuthLoginSession({
      profilesRoot: getConfiguredProfilesRoot(settings),
      sessionId: session.sessionId,
      pendingProfilePath: session.pendingProfilePath
    });
  });

  ipcMain.handle("oauthLogin:save", async (_event, rawRequest: unknown) => {
    const request = normalizeOAuthLoginSaveRequest(rawRequest);
    const session = getOAuthLoginSession(request.sessionId);
    const settings = await readSettings(settingsPath());
    const profilesRoot = getConfiguredProfilesRoot(settings);
    const result = await saveOAuthLoginSession({
      profilesRoot,
      sessionId: session.sessionId,
      pendingProfilePath: session.pendingProfilePath,
      profileName: request.profileName,
      nickname: request.nickname
    });

    const nextNicknames = { ...(settings.profileNicknames ?? {}) };
    if (result.nickname && result.nickname !== result.profileName) {
      nextNicknames[result.profileName] = result.nickname;
    } else {
      delete nextNicknames[result.profileName];
    }
    await saveSettings(settingsPath(), {
      profileNicknames: nextNicknames
    });
    await cleanupOAuthLoginSession({
      profilesRoot,
      sessionId: session.sessionId,
      pendingProfilePath: session.pendingProfilePath,
      pidFilePath: session.pidFilePath
    }).catch(() => undefined);
    oauthLoginSessions.delete(session.sessionId);

    return result;
  });

  ipcMain.handle("oauthLogin:cancel", async (_event, rawRequest: unknown) => {
    const request = normalizeOAuthLoginCancelRequest(rawRequest);
    const session = oauthLoginSessions.get(request.sessionId);
    const settings = await readSettings(settingsPath());
    const pendingProfilePath = session?.pendingProfilePath ?? request.pendingProfilePath;
    if (!pendingProfilePath) {
      throw new Error("Login session was not found. Start a new login first.");
    }

    await cleanupOAuthLoginSession({
      profilesRoot: getConfiguredProfilesRoot(settings),
      sessionId: request.sessionId,
      pendingProfilePath,
      pidFilePath: session?.pidFilePath
    });
    oauthLoginSessions.delete(request.sessionId);
  });

  ipcMain.handle("path:reveal", async (_event, rawTarget: unknown) => {
    const target = normalizeRevealTarget(rawTarget);
    if (target === "targetGeminiDir") {
      await openResolvedPath(getDefaultTargetGeminiDir());
      return;
    }

    const settings = await readSettings(settingsPath());
    await openResolvedPath(getConfiguredProfilesRoot(settings));
  });

  ipcMain.handle("path:selectDirectory", async (_event, rawDefaultPath?: unknown) => {
    const settings = await readSettings(settingsPath());
    const defaultPath =
      typeof rawDefaultPath === "string" && rawDefaultPath.trim()
        ? path.resolve(rawDefaultPath)
        : getConfiguredProfilesRoot(settings);
    const options: OpenDialogOptions = {
      title: "选择账号目录",
      defaultPath,
      properties: ["openDirectory"]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }

    return result.filePaths[0];
  });
}

app.setAppUserModelId("local.gemini-oauth-switcher");
Menu.setApplicationMenu(null);
registerIpcHandlers();

app.whenReady().then(async () => {
  createTray();
  const settings = await readSettings(settingsPath());
  await cleanupStaleOAuthLoginSessions({
    profilesRoot: getConfiguredProfilesRoot(settings)
  })
    .then(logStaleLoginCleanupResult)
    .catch((error: unknown) => {
      console.warn("Failed to run stale OAuth login cleanup.", error);
    });
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
