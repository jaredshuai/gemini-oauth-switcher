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
  resolveOAuthIdentityFromText,
  sanitizeOAuthProfileName
} from "./oauthLoginService";
import { saveGeminiOAuthLoginWithSettings } from "./oauthLoginPersistenceService";
import { cleanupStaleProfileRegistrations, deleteProfile, getProfileOAuthPath, listProfiles, switchProfile, validateProfileName } from "./profileService";
import { registerCurrentGeminiAccount } from "./geminiRegistrationService";
import { createAsyncOperationQueue } from "./operationQueue";
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
import { readSettings, readSettingsWithStatus, repairSettingsFromBackup, saveSettings } from "./settings";
import { collectLocalDiagnostics } from "./systemDiagnostics";
import { createStartupSettingsService } from "./startupSettingsService";
import { createAutoUpdateManager, type AutoUpdateManager } from "./updateService";
import { queryGeminiUsageFromOAuthFile } from "./usageService";
import { queryAntigravityUsage, refreshAntigravityAccessToken } from "./antigravityUsageService";
import { ensureWindowBoundsVisible, persistWindowBoundsBeforeClose, shouldHideWindowOnClose } from "./windowLifecycle";
import { configureSingleInstance } from "./singleInstanceService";
import { createDiagnosticLogger, type DiagnosticLogger } from "./diagnosticLogger";
import { createProcessFailureHandlers, toDiagnosticErrorMetadata } from "./processFailureService";
import { createRendererFailureController, createRendererFallbackPageUrl, isNavigationAbortError, type RendererFailure, type RendererRecoveryAction } from "./rendererFailureService";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let trayBehavior: TrayBehavior = "exit";
let autoUpdateManager: AutoUpdateManager | undefined;
let diagnosticLogger: DiagnosticLogger | undefined;
const oauthLoginSessions = new Map<string, OAuthLoginSession>();
const settingsDependentOperations = createAsyncOperationQueue();

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

function getDiagnosticLogger(): DiagnosticLogger {
  diagnosticLogger ??= createDiagnosticLogger({
    directory: path.join(app.getPath("userData"), "logs")
  });
  return diagnosticLogger;
}

function logDiagnosticError(event: string, error: unknown): void {
  void getDiagnosticLogger().error(event, toDiagnosticErrorMetadata(error)).catch(() => undefined);
}

function logDiagnosticWarning(event: string, error: unknown): void {
  void getDiagnosticLogger().warn(event, toDiagnosticErrorMetadata(error)).catch(() => undefined);
}

const startupSettingsService = createStartupSettingsService({
  readSettings: () => readSettingsWithStatus(settingsPath())
});

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
  logDiagnosticError("window.bounds_save_failed", error);
}

function logStaleLoginCleanupResult(result: { failed: string[]; skipped: string[] }): void {
  if (result.failed.length > 0) {
    void getDiagnosticLogger().warn("oauth_login.cleanup_failed", {
      failedCount: result.failed.length
    }).catch(() => undefined);
  }
  if (result.skipped.length > 0) {
    void getDiagnosticLogger().warn("oauth_login.cleanup_skipped", {
      skippedCount: result.skipped.length
    }).catch(() => undefined);
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
    logWarning: (_message, error) => logDiagnosticWarning("update.warning", error)
  });

  void autoUpdateManager.setEnabled(settings.autoUpdateEnabled !== false).catch((error: unknown) => {
    logDiagnosticWarning("update.settings_sync_failed", error);
  });
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
    return;
  }

  await window.loadFile(path.join(__dirname, "../../dist/index.html"));
}

async function showRendererRecoveryPrompt(
  window: BrowserWindow,
  failure: RendererFailure
): Promise<RendererRecoveryAction> {
  const result = await dialog.showMessageBox(window, {
    type: "error",
    title: "界面需要恢复",
    message: failure.kind === "load" ? "应用界面加载失败。" : "应用界面进程意外退出。",
    detail: "账号凭据没有被修改。你可以重新加载界面，或打开诊断目录查看故障信息。",
    buttons: ["重新加载", "打开诊断目录", "退出应用"],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });

  return result.response === 0
    ? "retry"
    : result.response === 1
      ? "open_diagnostics"
      : "exit";
}

async function createWindow(initialSettings?: AppSettings): Promise<void> {
  const settings = initialSettings ?? await readSettings(settingsPath());
  const savedBounds = settings.windowBounds ?? { width: 1040, height: 760 };
  const bounds = ensureWindowBoundsVisible(savedBounds, screen.getAllDisplays().map((display) => display.workArea));
  const windowChromeTheme = getWindowChromeTheme(settings.uiTheme);
  trayBehavior = settings.trayBehavior ?? "exit";

  const createdWindow = new BrowserWindow({
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
  mainWindow = createdWindow;
  createdWindow.setMenuBarVisibility(false);

  const rendererFailureController = createRendererFailureController({
    reportFailure: (failure) => getDiagnosticLogger().error(
      failure.kind === "load" ? "renderer.load_failed" : "renderer.process_gone",
      failure
    ),
    renderFallback: async (failure) => {
      if (createdWindow.isDestroyed()) {
        return;
      }
      await createdWindow.loadURL(createRendererFallbackPageUrl(failure.kind));
      createdWindow.show();
    },
    showRecoveryPrompt: (failure) => showRendererRecoveryPrompt(createdWindow, failure),
    reloadRenderer: () => {
      setTimeout(() => {
        if (!createdWindow.isDestroyed()) {
          void loadRenderer(createdWindow).catch((error: unknown) => {
            if (!isNavigationAbortError(error)) {
              logDiagnosticError("renderer.reload_rejected", error);
            }
          });
        }
      }, 0);
    },
    openDiagnosticsDirectory: async () => {
      const logger = getDiagnosticLogger();
      await logger.info("diagnostics.directory_opened");
      await openResolvedPath(logger.directory);
    },
    quit: () => {
      isQuitting = true;
      app.quit();
    }
  });

  createdWindow.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, _validatedUrl, isMainFrame) => {
    void rendererFailureController.handleLoadFailure({
      errorCode,
      isMainFrame: Boolean(isMainFrame)
    }).catch((error: unknown) => {
      logDiagnosticError("renderer.load_recovery_failed", error);
    });
  });

  createdWindow.webContents.on("render-process-gone", (_event, details) => {
    void rendererFailureController.handleRenderProcessGone({
      reason: details.reason,
      exitCode: details.exitCode,
      isQuitting
    }).catch((error: unknown) => {
      logDiagnosticError("renderer.process_recovery_failed", error);
    });
  });

  createdWindow.once("ready-to-show", () => {
    createdWindow.show();
  });

  createdWindow.on("close", (event) => {
    const hideOnClose = shouldHideWindowOnClose({
      isQuitting,
      trayBehavior,
      hasTray: Boolean(tray)
    });
    event.preventDefault();
    void persistWindowBoundsBeforeClose({
      window: createdWindow,
      hideOnClose,
      saveWindowBounds: (windowBounds) => saveSettings(settingsPath(), { windowBounds })
    }).catch(logWindowClosePersistenceError);
  });

  createdWindow.on("closed", () => {
    if (mainWindow === createdWindow) {
      mainWindow = undefined;
    }
  });

  await loadRenderer(createdWindow).catch((error: unknown) => {
    if (!isNavigationAbortError(error)) {
      logDiagnosticError("renderer.initial_navigation_rejected", error);
    }
  });
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

  ipcMain.handle("settings:save", (_event, patch: Partial<AppSettings>) => settingsDependentOperations.run(async () => {
    const nextSettings = await saveSettings(settingsPath(), patch);
    trayBehavior = nextSettings.trayBehavior ?? "exit";
    applyWindowChromeTheme(nextSettings);
    syncAutoUpdateSetting(nextSettings);
    return nextSettings;
  }));

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
      const nextNicknames = { ...(settings.profileNicknames ?? {}) };
      delete nextNicknames[profileIdentifier];
      const deleted = await deleteAntigravityProfile({
        profileId: profileIdentifier,
        profiles: settings.antigravityProfiles ?? [],
        credentialStore: nativeAntigravityCredentialStore,
        credentialTarget: ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET,
        persistProfiles: async (profiles) => {
          await saveSettings(settingsPath(), {
            antigravityProfiles: profiles,
            profileNicknames: nextNicknames,
            lastSelectedProfile: settings.lastSelectedProfile === profileIdentifier ? undefined : settings.lastSelectedProfile
          });
        }
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

  ipcMain.handle("profiles:gemini:registerCurrent", () => settingsDependentOperations.run(async () => {
    const settings = await readSettings(settingsPath());
    const profilesRoot = getConfiguredProfilesRoot(settings);
    const targetOAuthPath = getDefaultTargetOAuthPath();
    return registerCurrentGeminiAccount({
      profilesRoot,
      targetOAuthPath,
      profileNicknames: settings.profileNicknames,
      saveSettingsPatch: async (patch) => {
        await saveSettings(settingsPath(), patch);
      }
    });
  }));

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

  ipcMain.handle("diagnostics:get", async () => collectLocalDiagnostics({
    settingsReadStatus: startupSettingsService.getReadStatus()
  }));
  ipcMain.handle("diagnostics:rendererFailure", async () => {
    await getDiagnosticLogger().error("renderer.react_error_boundary");
  });

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

    const result = await saveGeminiOAuthLoginWithSettings({
      profilesRoot: session.loginRoot,
      sessionId: session.sessionId,
      pendingProfilePath: session.pendingProfilePath,
      profileName: request.profileName,
      nickname: request.nickname,
      persistResult: async (saved) => {
        const nextNicknames = { ...(settings.profileNicknames ?? {}) };
        if (saved.nickname && saved.nickname !== saved.profileName) {
          nextNicknames[saved.profileName] = saved.nickname;
        } else {
          delete nextNicknames[saved.profileName];
        }
        await saveSettings(settingsPath(), {
          selectedTool: "gemini",
          profileNicknames: nextNicknames
        });
      }
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

const isPrimaryInstance = configureSingleInstance({
  requestLock: () => app.requestSingleInstanceLock(),
  quit: () => app.quit(),
  onSecondInstance: (listener) => {
    app.on("second-instance", listener);
  },
  showMainWindow,
  onShowError: (error) => {
    logDiagnosticWarning("window.restore_failed", error);
  }
});

if (isPrimaryInstance) {
  const processFailureHandlers = createProcessFailureHandlers({
    logError: (event, metadata) => getDiagnosticLogger().error(event, metadata),
    logWarning: (event, metadata) => getDiagnosticLogger().warn(event, metadata),
    showFatalError: () => {
      dialog.showErrorBox(
        "应用发生严重错误",
        "诊断信息已写入本地日志。应用将退出，请重新打开后再试。"
      );
    },
    exit: (code) => {
      isQuitting = true;
      app.exit(code);
    }
  });

  process.on("uncaughtException", (error) => {
    void processFailureHandlers.handleUncaughtException(error);
  });
  process.on("unhandledRejection", (reason) => {
    void processFailureHandlers.handleUnhandledRejection(reason);
  });

  app.setAppUserModelId("local.gemini-oauth-switcher");
  Menu.setApplicationMenu(null);
  registerIpcHandlers();

  void app.whenReady().then(async () => {
    await getDiagnosticLogger().info("app.started", {
      version: app.getVersion(),
      packaged: app.isPackaged,
      portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR)
    }).catch(() => undefined);
    createTray();
    const settings = await startupSettingsService.load();
    const settingsReadStatus = startupSettingsService.getReadStatus();
    if (settingsReadStatus === "recovered_from_backup") {
      await repairSettingsFromBackup(settingsPath(), {
        settings,
        status: settingsReadStatus
      }).catch((error: unknown) => {
        logDiagnosticWarning("settings.primary_repair_failed", error);
      });
    }
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
          logDiagnosticWarning("oauth_login.cleanup_run_failed", error);
        });
    }
    await cleanupStaleProfileRegistrations({ profilesRoot })
      .then((result) => {
        if (result.removed.length || result.failed.length || result.skipped.length) {
          void getDiagnosticLogger().info("profile_registration.cleanup_completed", {
            removedCount: result.removed.length,
            failedCount: result.failed.length,
            skippedCount: result.skipped.length
          }).catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        logDiagnosticWarning("profile_registration.cleanup_run_failed", error);
      });
    await createWindow(settings);
    syncAutoUpdateSetting(settings);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow().catch((error: unknown) => {
          logDiagnosticError("window.create_failed", error);
        });
      }
    });
  }).catch((error: unknown) => {
    void processFailureHandlers.handleUncaughtException(error);
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
