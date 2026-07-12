import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, GeminiSwitcherApi, OAuthLoginCancelRequest, OAuthLoginSaveRequest, RevealTarget, TargetTool } from "../shared/types";

const api: GeminiSwitcherApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("settings:save", settings),
  listProfiles: (targetTool?: TargetTool) => ipcRenderer.invoke("profiles:list", targetTool),
  switchProfile: (profileName: string, targetTool?: TargetTool) => ipcRenderer.invoke("profiles:switch", profileName, targetTool),
  deleteProfile: (profileIdentifier: string, targetTool?: TargetTool) => ipcRenderer.invoke("profiles:delete", profileIdentifier, targetTool),
  registerCurrentAntigravity: () => ipcRenderer.invoke("profiles:antigravity:registerCurrent"),
  startOAuthLogin: (targetTool?: TargetTool) => ipcRenderer.invoke("oauthLogin:start", targetTool),
  inspectOAuthLogin: (sessionId: string) => ipcRenderer.invoke("oauthLogin:inspect", sessionId),
  saveOAuthLogin: (request: OAuthLoginSaveRequest) => ipcRenderer.invoke("oauthLogin:save", request),
  cancelOAuthLogin: (request: OAuthLoginCancelRequest) => ipcRenderer.invoke("oauthLogin:cancel", request),
  refreshProfileUsage: (profileName: string) => ipcRenderer.invoke("profiles:usage:refresh", profileName),
  refreshAllUsage: () => ipcRenderer.invoke("profiles:usage:refreshAll"),
  getLocalDiagnostics: () => ipcRenderer.invoke("diagnostics:get"),
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke("path:selectDirectory", defaultPath),
  revealPath: (target: RevealTarget) => ipcRenderer.invoke("path:reveal", target)
};

contextBridge.exposeInMainWorld("geminiSwitcher", api);
