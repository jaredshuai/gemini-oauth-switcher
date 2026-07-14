import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, AppUpdateStatus, GeminiSwitcherApi, OAuthLoginCancelRequest, OAuthLoginSaveRequest, RevealTarget, TargetTool } from "../shared/types";

const api: GeminiSwitcherApi = {
  getRuntimeInfo: () => ipcRenderer.invoke("app:runtimeInfo"),
  getUpdateStatus: () => ipcRenderer.invoke("app:updateStatus"),
  checkForUpdates: () => ipcRenderer.invoke("app:updateCheck"),
  onUpdateStatusChanged: (listener: (status: AppUpdateStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus) => listener(status);
    ipcRenderer.on("app:updateStatusChanged", handler);
    return () => ipcRenderer.removeListener("app:updateStatusChanged", handler);
  },
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("settings:save", settings),
  listProfiles: (targetTool?: TargetTool) => ipcRenderer.invoke("profiles:list", targetTool),
  switchProfile: (profileName: string, targetTool?: TargetTool) => ipcRenderer.invoke("profiles:switch", profileName, targetTool),
  deleteProfile: (profileIdentifier: string, targetTool?: TargetTool) => ipcRenderer.invoke("profiles:delete", profileIdentifier, targetTool),
  registerCurrentGemini: () => ipcRenderer.invoke("profiles:gemini:registerCurrent"),
  registerCurrentAntigravity: () => ipcRenderer.invoke("profiles:antigravity:registerCurrent"),
  startOAuthLogin: (targetTool?: TargetTool) => ipcRenderer.invoke("oauthLogin:start", targetTool),
  inspectOAuthLogin: (sessionId: string) => ipcRenderer.invoke("oauthLogin:inspect", sessionId),
  saveOAuthLogin: (request: OAuthLoginSaveRequest) => ipcRenderer.invoke("oauthLogin:save", request),
  cancelOAuthLogin: (request: OAuthLoginCancelRequest) => ipcRenderer.invoke("oauthLogin:cancel", request),
  refreshProfileUsage: (profileIdentifier: string, targetTool?: TargetTool) =>
    ipcRenderer.invoke("profiles:usage:refresh", profileIdentifier, targetTool),
  refreshAllUsage: (targetTool?: TargetTool) => ipcRenderer.invoke("profiles:usage:refreshAll", targetTool),
  getLocalDiagnostics: () => ipcRenderer.invoke("diagnostics:get"),
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke("path:selectDirectory", defaultPath),
  revealPath: (target: RevealTarget) => ipcRenderer.invoke("path:reveal", target)
};

contextBridge.exposeInMainWorld("geminiSwitcher", api);
