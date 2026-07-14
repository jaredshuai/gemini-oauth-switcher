import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, screen, shell, type OpenDialogOptions } from "electron";
import type { AppSettings, AppUpdateStatus, OAuthLoginCancelRequest, OAuthLoginInspectResult, OAuthLoginSaveRequest, OAuthLoginSession, RevealTarget, TargetTool, TrayBehavior } from "../shared/types";
import { getAntigravityLoginRoot, getDefaultProfilesRoot, getDefaultTargetAntigravityCliDir, getDefaultTargetGeminiDir, getDefaultTargetOAuthPath, getSettingsPath } from "./paths";
import {
  cleanupOAuthLoginSession,
  cleanupStaleOAuthLoginSessions,
  createOAuthLoginSession,
  inspectOAuthLoginSession,
  resolveOAuthIdentityFromFile,
  resolveOAuthIdentityFromText,
  sanitizeOAuthProfileName,
  saveOAuthLoginSession
} from "./oauthLoginService";
import { deleteProfile, getProfileOAuthPath, hashFile, listProfiles, registerCurrentProfile, switchProfile, validateProfileName } from "./profileService";
import { getProfileTargetConfig } from "./profileTargets";
import {
  ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET,
  getAntigravityProfileCredentialTarget,
  hashCredentialPayload,
  nativeAntigravityCredentialStore
} from "./antigravityCredentialService";
import {
  deleteAntigravityProfile,
  listAntigravityProfiles,
  registerCurrentAntigravityProfile,
  resolveCurrentAntigravityProfileIdentity,
  switchAntigravityProfile
} from "./antigravityProfileService";
import { readSettings, saveSettings } from "./settings";
import { collectLocalDiagnostics } from "./systemDiagnostics";
import { createAutoUpdateManager, type AutoUpdateManager } from "./updateService";
import { queryGeminiUsageFromOAuthFile } from "./usageService";
import { queryAntigravityUsage, refreshAntigravityAccessToken } from "./antigravityUsageService";
import { ensureWindowBoundsVisible, persistWindowBoundsBeforeClose, shouldHideWindowOnClose } from "./windowLifecycle";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let trayBehavior: TrayBehavior = "exit";
let autoUpdateManager: AutoUpdateManager | undefined;
const oauthLoginSessions = new Map<string, OAuthLoginSession>();

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const WINDOW_TITLE_BAR_HEIGHT = 36;

function getWindowChromeTheme(uiTheme: AppSettings["uiTheme"]): { backgroundColor: string; symbolColor: string } {
  return uiTheme === "rpg-parchment"
    ? { backgroundColor: "#eee4d0", symbolColor: "#5f3024" }
    : { backgroundColor: "#f4eddf", symbolColor: "#3f352b" };
}

function applyWindowChromeTheme(settings: AppSettings): void {
  if (!mainWindow) {
    return;
  }

  const theme = getWindowChromeTheme(settings.uiTheme);
  mainWindow.setBackgroundColor(theme.backgroundColor);
  mainWindow.setTitleBarOverlay({
    color: "#00000000",
    symbolColor: theme.symbolColor,
    height: WINDOW_TITLE_BAR_HEIGHT
  });
}

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

function getCredentialOptions(target: ReturnType<typeof getProfileTargetConfig>) {
  return {
    credentialStore: target.credentialTarget ? nativeAntigravityCredentialStore : undefined,
    credentialTarget: target.credentialTarget,
    getProfileCredentialTarget: target.getProfileCredentialTarget
      ? (profileId: string) => target.getProfileCredentialTarget?.(profileId) ?? ""
      : undefined
  };
}

function resolveAntigravityIdentity(payload: string) {
  return resolveOAuthIdentityFromText(payload, {
    refreshAccessToken: refreshAntigravityAccessToken
  });
}

function normalizeProfileIdentifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Profile identifier is required");
  }
  return value.trim();
}

function getLoginRoot(targetTool: TargetTool, profilesRoot: string): string {
  return targetTool === "antigravity-cli" ? getAntigravityLoginRoot(app.getPath("temp")) : profilesRoot;
}

function findAntigravityConflict(
  inspection: OAuthLoginInspectResult,
  settings: AppSettings
): string | undefined {
  const proposedName = inspection.proposedProfileName?.trim().toLowerCase();
  const accountEmail = inspection.accountEmail?.trim().toLowerCase();
  return settings.antigravityProfiles?.find((profile) =>
    Boolean(accountEmail && profile.accountEmail?.toLowerCase() === accountEmail) ||
    Boolean(proposedName && profile.name.toLowerCase() === proposedName)
  )?.name;
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
  if (value === "profilesRoot" || value === "targetGeminiDir" || value === "targetAntigravityCliDir") {
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

function currentUpdateStatus(): AppUpdateStatus {
  return autoUpdateManager?.getStatus() ?? { phase: "idle" };
}

function broadcastUpdateStatus(status: AppUpdateStatus): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("app:updateStatusChanged", status);
}

function syncAutoUpdateSetting(settings: AppSettings): void {
  autoUpdateManager ??= createAutoUpdateManager({
    isPackaged: app.isPackaged,
    isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    showMessageBox: (options) => (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options)),
    prepareToQuitForUpdate: () => {
      isQuitting = true;
    },
    onStatusChange: broadcastUpdateStatus,
    logWarning: (message, error) => {
      console.warn(message, error);
    }
  });

  void autoUpdateManager.setEnabled(settings.autoUpdateEnabled !== false).catch((error: unknown) => {
    console.warn("Failed to update automatic update settings.", error);
  });
}

async function createWindow(): Promise<void> {
  const settings = await readSettings(settingsPath());
  const savedBounds = settings.windowBounds ?? { width: 1040, height: 760 };
  const bounds = ensureWindowBoundsVisible(savedBounds, screen.getAllDisplays().map((display) => display.workArea));
  const windowChromeTheme = getWindowChromeTheme(settings.uiTheme);
  trayBehavior = settings.trayBehavior ?? "exit";

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 860,
    minHeight: 560,
    title: "Gemini OAuth Switcher",
    icon: getAppIconPath(),
    backgroundColor: windowChromeTheme.backgroundColor,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#00000000",
      symbolColor: windowChromeTheme.symbolColor,
      height: WINDOW_TITLE_BAR_HEIGHT
    },
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
  ipcMain.handle("app:runtimeInfo", () => ({
    isPackaged: app.isPackaged,
    isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    version: app.getVersion()
  }));

  ipcMain.handle("app:updateStatus", () => currentUpdateStatus());
  ipcMain.handle("app:updateCheck", () => autoUpdateManager?.checkNow() ?? false);

  ipcMain.handle("settings:get", async () => readSettings(settingsPath()));

  ipcMain.handle("settings:save", async (_event, patch: Partial<AppSettings>) => {
    const nextSettings = await saveSettings(settingsPath(), patch);
    trayBehavior = nextSettings.trayBehavior ?? "exit";
    applyWindowChromeTheme(nextSettings);
    syncAutoUpdateSetting(nextSettings);
    return nextSettings;
  });

  ipcMain.handle("profiles:list", async (_event, rawTargetTool?: unknown) => {
    const settings = await readSettings(settingsPath());
    const profilesRoot = getConfiguredProfilesRoot(settings);
    const target = getProfileTargetConfig(rawTargetTool ?? settings.selectedTool);

    if (target.tool === "antigravity-cli") {
      const identityResolution = await resolveCurrentAntigravityProfileIdentity({
        profiles: settings.antigravityProfiles ?? [],
        credentialStore: nativeAntigravityCredentialStore,
        credentialTarget: ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET,
        resolveIdentity: resolveAntigravityIdentity
      });
      const profiles = identityResolution.changed
        ? (await saveSettings(settingsPath(), { antigravityProfiles: identityResolution.profiles })).antigravityProfiles
          ?? identityResolution.profiles
        : identityResolution.profiles;

      return listAntigravityProfiles({
        profiles,
        credentialStore: nativeAntigravityCredentialStore,
        credentialTarget: ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET
      });
    }

    return listProfiles({
      profilesRoot,
      targetOAuthPath: target.targetPath,
      profileFileRelativePath: target.profileFileRelativePath,
      includeMissingProfiles: false
    });
  });

  ipcMain.handle("profiles:switch", async (_event, rawProfileIdentifier: unknown, rawTargetTool?: unknown) => {
    const settings = await readSettings(settingsPath());
    const profilesRoot = getConfiguredProfilesRoot(settings);
    const target = getProfileTargetConfig(rawTargetTool ?? settings.selectedTool);
    const profileIdentifier = normalizeProfileIdentifier(rawProfileIdentifier);
    const result = target.tool === "antigravity-cli"
      ? await switchAntigravityProfile({
          profileId: profileIdentifier,
          profiles: settings.antigravityProfiles ?? [],
          credentialStore: nativeAntigravityCredentialStore,
          credentialTarget: ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET
        })
      : await switchProfile({
          profilesRoot,
          profileName: validateProfileName(profileIdentifier),
          targetOAuthPath: target.targetPath,
          profileFileRelativePath: target.profileFileRelativePath,
          profileFileLabel: target.profileFileLabel,
          targetDirectoryLabel: target.targetDirectoryLabel
        });

    await saveSettings(settingsPath(), {
      selectedTool: target.tool,
      lastSelectedProfile: profileIdentifier,
      lastSwitch: {
        profileName: result.profileName,
        switchedAt: Date.now(),
        verified: true,
        targetTool: target.tool
      }
    });

    return result;
  });

  ipcMain.handle("profiles:delete", async (_event, rawProfileIdentifier: unknown, rawTargetTool?: unknown) => {
    const settings = await readSettings(settingsPath());
    const target = getProfileTargetConfig(rawTargetTool ?? settings.selectedTool);
    const profileIdentifier = normalizeProfileIdentifier(rawProfileIdentifier);
    if (target.tool === "antigravity-cli") {
      const deleted = await deleteAntigravityProfile({
        profileId: profileIdentifier,
        profiles: settings.antigravityProfiles ?? [],
        credentialStore: nativeAntigravityCredentialStore,
        credentialTarget: ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET
      });
      const nextNicknames = { ...(settings.profileNicknames ?? {}) };
      delete nextNicknames[deleted.profile.id];
      await saveSettings(settingsPath(), {
        antigravityProfiles: deleted.profiles,
        profileNicknames: nextNicknames,
        lastSelectedProfile: settings.lastSelectedProfile === deleted.profile.id ? undefined : settings.lastSelectedProfile
      });
      return {
        profileName: deleted.profile.name,
        profilePath: ""
      };
    }

    const profileName = validateProfileName(profileIdentifier);
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

  ipcMain.handle("profiles:antigravity:registerCurrent", async () => {
    const settings = await readSettings(settingsPath());
    const payload = await nativeAntigravityCredentialStore.get(ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET);
    if (!payload) {
      throw new Error("当前没有可登记的 Antigravity 登录凭据。");
    }

    const accountEmail = (await resolveAntigravityIdentity(payload)).accountEmail;
    const profileName = accountEmail
      ? sanitizeOAuthProfileName(accountEmail)
      : `antigravity-account-${hashCredentialPayload(payload).slice(0, 8)}`;
    const profileId = `agy-${randomUUID()}`;
    const registered = await registerCurrentAntigravityProfile({
      profileId,
      name: profileName,
      accountEmail,
      profiles: settings.antigravityProfiles ?? [],
      credentialStore: nativeAntigravityCredentialStore,
      credentialTarget: ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET
    });
    const nextNicknames = { ...(settings.profileNicknames ?? {}) };
    if (accountEmail && accountEmail !== profileName) {
      nextNicknames[profileId] = accountEmail;
    }

    try {
      await saveSettings(settingsPath(), {
        selectedTool: "antigravity-cli",
        antigravityProfiles: registered.profiles,
        profileNicknames: nextNicknames
      });
    } catch (error) {
      await nativeAntigravityCredentialStore.delete(getAntigravityProfileCredentialTarget(profileId)).catch(() => undefined);
      throw error;
    }

    return {
      sessionId: "current-antigravity",
      targetTool: "antigravity-cli",
      profileId,
      profileName,
      nickname: accountEmail,
      profilePath: "",
      oauthPath: "",
      accountEmail,
      sha256: registered.targetHash
    };
  });

  ipcMain.handle("profiles:gemini:registerCurrent", async () => {
    const settings = await readSettings(settingsPath());
    const profilesRoot = getConfiguredProfilesRoot(settings);
    const targetOAuthPath = getDefaultTargetOAuthPath();
    const accountEmail = (await resolveOAuthIdentityFromFile(targetOAuthPath)).accountEmail;
    const targetHash = await hashFile(targetOAuthPath);
    const profileName = accountEmail
      ? sanitizeOAuthProfileName(accountEmail)
      : `gemini-account-${targetHash.slice(0, 8)}`;
    const registered = await registerCurrentProfile({
      profilesRoot,
      profileName,
      targetOAuthPath
    });
    const nextNicknames = { ...(settings.profileNicknames ?? {}) };
    if (accountEmail && accountEmail !== profileName) {
      nextNicknames[profileName] = accountEmail;
    }
    await saveSettings(settingsPath(), {
      selectedTool: "gemini",
      lastSelectedProfile: profileName,
      profileNicknames: nextNicknames
    });

    return {
      sessionId: "current-gemini",
      targetTool: "gemini",
      profileName,
      nickname: accountEmail,
      profilePath: path.join(profilesRoot, profileName),
      oauthPath: registered.targetPath,
      accountEmail,
      sha256: registered.targetHash
    };
  });

  ipcMain.handle("profiles:usage:refresh", async (_event, rawProfileIdentifier: unknown, rawTargetTool?: unknown) => {
    const settings = await readSettings(settingsPath());
    const target = getProfileTargetConfig(rawTargetTool ?? settings.selectedTool);
    if (target.tool === "antigravity-cli") {
      const profileId = normalizeProfileIdentifier(rawProfileIdentifier);
      const profile = settings.antigravityProfiles?.find((candidate) => candidate.id === profileId);
      if (!profile) {
        throw new Error(`Antigravity profile does not exist: ${profileId}`);
      }

      return queryAntigravityUsage({
        profileName: profile.name,
        credentialTarget: getAntigravityProfileCredentialTarget(profile.id),
        credentialStore: nativeAntigravityCredentialStore
      });
    }

    const profileName = normalizeProfileName(rawProfileIdentifier);
    const profilesRoot = getConfiguredProfilesRoot(settings);

    return queryGeminiUsageFromOAuthFile({
      profileName,
      oauthPath: getProfileOAuthPath(profilesRoot, profileName)
    });
  });

  ipcMain.handle("profiles:usage:refreshAll", async (_event, rawTargetTool?: unknown) => {
    const settings = await readSettings(settingsPath());
    const target = getProfileTargetConfig(rawTargetTool ?? settings.selectedTool);
    if (target.tool === "antigravity-cli") {
      const usages = await Promise.all(
        (settings.antigravityProfiles ?? []).map(async (profile) => [
          profile.id,
          await queryAntigravityUsage({
            profileName: profile.name,
            credentialTarget: getAntigravityProfileCredentialTarget(profile.id),
            credentialStore: nativeAntigravityCredentialStore
          })
        ] as const)
      );

      return Object.fromEntries(usages);
    }

    const profilesRoot = getConfiguredProfilesRoot(settings);
    const result = await listProfiles({
      profilesRoot,
      targetOAuthPath: getDefaultTargetOAuthPath(),
      includeMissingProfiles: false
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

  ipcMain.handle("oauthLogin:start", async (_event, rawTargetTool?: unknown) => {
    const settings = await readSettings(settingsPath());
    const profilesRoot = getConfiguredProfilesRoot(settings);
    const target = getProfileTargetConfig(rawTargetTool ?? settings.selectedTool);
    const loginRoot = getLoginRoot(target.tool, profilesRoot);
    const session = await createOAuthLoginSession({
      profilesRoot: loginRoot,
      targetTool: target.tool,
      ...getCredentialOptions(target)
    });
    oauthLoginSessions.set(session.sessionId, session);

    return session;
  });

  ipcMain.handle("oauthLogin:inspect", async (_event, rawSessionId: unknown) => {
    const session = getOAuthLoginSession(rawSessionId);
    const settings = await readSettings(settingsPath());
    const target = getProfileTargetConfig(session.targetTool);

    const inspection = await inspectOAuthLoginSession({
      profilesRoot: session.loginRoot,
      sessionId: session.sessionId,
      pendingProfilePath: session.pendingProfilePath,
      targetTool: session.targetTool,
      resolveIdentity: target.tool === "antigravity-cli" ? resolveAntigravityIdentity : undefined,
      ...getCredentialOptions(target)
    });
    if (target.tool !== "antigravity-cli") {
      return inspection;
    }

    return {
      ...inspection,
      conflictProfileName: findAntigravityConflict(inspection, settings)
    };
  });

  ipcMain.handle("oauthLogin:save", async (_event, rawRequest: unknown) => {
    const request = normalizeOAuthLoginSaveRequest(rawRequest);
    const session = getOAuthLoginSession(request.sessionId);
    const settings = await readSettings(settingsPath());
    const target = getProfileTargetConfig(session.targetTool);
    if (target.tool === "antigravity-cli") {
      const inspection = await inspectOAuthLoginSession({
        profilesRoot: session.loginRoot,
        sessionId: session.sessionId,
        pendingProfilePath: session.pendingProfilePath,
        targetTool: session.targetTool,
        resolveIdentity: resolveAntigravityIdentity,
        ...getCredentialOptions(target)
      });
      if (!inspection.oauthExists) {
        throw new Error("Antigravity CLI login credential has not been created yet.");
      }

      const profileId = `agy-${randomUUID()}`;
      const profileName = request.profileName?.trim() || inspection.proposedProfileName || "";
      const registered = await registerCurrentAntigravityProfile({
        profileId,
        name: profileName,
        accountEmail: inspection.accountEmail,
        profiles: settings.antigravityProfiles ?? [],
        credentialStore: nativeAntigravityCredentialStore,
        credentialTarget: ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET
      });
      const nextNicknames = { ...(settings.profileNicknames ?? {}) };
      const nickname = request.nickname?.trim() || inspection.proposedNickname;
      if (nickname && nickname !== profileName) {
        nextNicknames[profileId] = nickname;
      }

      try {
        await saveSettings(settingsPath(), {
          selectedTool: target.tool,
          antigravityProfiles: registered.profiles,
          profileNicknames: nextNicknames
        });
      } catch (error) {
        await nativeAntigravityCredentialStore.delete(getAntigravityProfileCredentialTarget(profileId)).catch(() => undefined);
        throw error;
      }

      await cleanupOAuthLoginSession({
        profilesRoot: session.loginRoot,
        sessionId: session.sessionId,
        pendingProfilePath: session.pendingProfilePath,
        pidFilePath: session.pidFilePath,
        credentialBackupTarget: session.credentialBackupTarget,
        targetTool: session.targetTool,
        ...getCredentialOptions(target)
      }).catch(() => undefined);
      oauthLoginSessions.delete(session.sessionId);

      return {
        sessionId: session.sessionId,
        targetTool: target.tool,
        profileId,
        profileName,
        nickname,
        profilePath: "",
        oauthPath: "",
        accountEmail: inspection.accountEmail,
        sha256: registered.targetHash
      };
    }

    const result = await saveOAuthLoginSession({
      profilesRoot: session.loginRoot,
      sessionId: session.sessionId,
      pendingProfilePath: session.pendingProfilePath,
      targetTool: session.targetTool,
      profileName: request.profileName,
      nickname: request.nickname,
      ...getCredentialOptions(target)
    });

    const nextNicknames = { ...(settings.profileNicknames ?? {}) };
    if (result.nickname && result.nickname !== result.profileName) {
      nextNicknames[result.profileName] = result.nickname;
    } else {
      delete nextNicknames[result.profileName];
    }
    await saveSettings(settingsPath(), {
      selectedTool: session.targetTool ?? "gemini",
      profileNicknames: nextNicknames
    });
    await cleanupOAuthLoginSession({
      profilesRoot: session.loginRoot,
      sessionId: session.sessionId,
      pendingProfilePath: session.pendingProfilePath,
      pidFilePath: session.pidFilePath,
      credentialBackupTarget: session.credentialBackupTarget,
      targetTool: session.targetTool,
      ...getCredentialOptions(target)
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

    const target = getProfileTargetConfig(session?.targetTool ?? settings.selectedTool);
    const loginRoot = session?.loginRoot ?? path.dirname(pendingProfilePath);
    await cleanupOAuthLoginSession({
      profilesRoot: loginRoot,
      sessionId: request.sessionId,
      pendingProfilePath,
      pidFilePath: session?.pidFilePath,
      credentialBackupTarget: session?.credentialBackupTarget,
      targetTool: session?.targetTool ?? target.tool,
      restorePreviousCredential: true,
      ...getCredentialOptions(target)
    });
    oauthLoginSessions.delete(request.sessionId);
  });

  ipcMain.handle("path:reveal", async (_event, rawTarget: unknown) => {
    const target = normalizeRevealTarget(rawTarget);
    if (target === "targetGeminiDir") {
      await openResolvedPath(getDefaultTargetGeminiDir());
      return;
    }
    if (target === "targetAntigravityCliDir") {
      await openResolvedPath(getDefaultTargetAntigravityCliDir());
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
  const profilesRoot = getConfiguredProfilesRoot(settings);
  const antigravityTarget = getProfileTargetConfig("antigravity-cli");
  for (const loginRoot of [profilesRoot, getAntigravityLoginRoot(app.getPath("temp"))]) {
    await cleanupStaleOAuthLoginSessions({
      profilesRoot: loginRoot,
      credentialStore: nativeAntigravityCredentialStore,
      credentialTarget: antigravityTarget.credentialTarget
    })
      .then(logStaleLoginCleanupResult)
      .catch((error: unknown) => {
        console.warn("Failed to run stale OAuth login cleanup.", error);
      });
  }
  await createWindow();
  syncAutoUpdateSetting(settings);

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
