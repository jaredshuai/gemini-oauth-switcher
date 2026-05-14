import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, GeminiSwitcherApi, OAuthLoginCancelRequest, OAuthLoginSaveRequest, RevealTarget } from "../shared/types";

const api: GeminiSwitcherApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("settings:save", settings),
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  switchProfile: (profileName: string) => ipcRenderer.invoke("profiles:switch", profileName),
  deleteProfile: (profileName: string) => ipcRenderer.invoke("profiles:delete", profileName),
  startOAuthLogin: () => ipcRenderer.invoke("oauthLogin:start"),
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
