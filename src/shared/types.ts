export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export type TrayBehavior = "exit" | "minimize_to_tray";
export type RevealTarget = "profilesRoot" | "targetGeminiDir";

export interface AppSettings {
  profilesRoot: string;
  windowBounds?: WindowBounds;
  trayBehavior?: TrayBehavior;
  lastSelectedProfile?: string;
  lastSwitch?: LastSwitchResult;
  profileNicknames?: Record<string, string>;
}

export interface LastSwitchResult {
  profileName: string;
  switchedAt: number;
  verified: boolean;
}

export interface ProfileInfo {
  name: string;
  profilePath: string;
  oauthPath: string;
  exists: boolean;
  updatedAt?: string;
  updatedAtMs?: number;
  sha256?: string;
  shortHash?: string;
  isCurrent: boolean;
}

export type CredentialStatus = "valid" | "expired" | "not_found" | "parse_error";

export interface UsageTier {
  name: string;
  label: string;
  utilization: number;
  resetsAt?: string;
}

export interface ProfileUsageResult {
  profileName: string;
  success: boolean;
  credentialStatus: CredentialStatus;
  tiers: UsageTier[];
  error?: string;
  queriedAt?: number;
}

export interface ProfileListResult {
  profilesRoot: string;
  targetGeminiDir: string;
  targetOAuthPath: string;
  targetHash?: string;
  profiles: ProfileInfo[];
}

export interface LocalDiagnosticsResult {
  envRisks: string[];
  geminiCommand: {
    available: boolean;
    path?: string;
  };
  checkedAt: number;
}

export interface SwitchProfileResult {
  profileName: string;
  sourcePath: string;
  targetPath: string;
  sourceHash: string;
  targetHash: string;
}

export interface DeleteProfileResult {
  profileName: string;
  profilePath: string;
}

export interface OAuthLoginSession {
  sessionId: string;
  pendingProfilePath: string;
  pidFilePath?: string;
  oauthPath: string;
  startedAt: number;
}

export interface OAuthLoginInspectResult {
  sessionId: string;
  pendingProfilePath: string;
  oauthPath: string;
  oauthExists: boolean;
  updatedAt?: string;
  updatedAtMs?: number;
  sha256?: string;
  shortHash?: string;
  accountEmail?: string;
  proposedProfileName?: string;
  proposedNickname?: string;
  conflictProfileName?: string;
  targetProfilePath?: string;
}

export interface OAuthLoginSaveRequest {
  sessionId: string;
  profileName?: string;
  nickname?: string;
}

export interface OAuthLoginSaveResult {
  sessionId: string;
  profileName: string;
  nickname?: string;
  profilePath: string;
  oauthPath: string;
  accountEmail?: string;
  sha256: string;
}

export interface OAuthLoginCancelRequest {
  sessionId: string;
  pendingProfilePath?: string;
}

export interface GeminiSwitcherApi {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  listProfiles(): Promise<ProfileListResult>;
  switchProfile(profileName: string): Promise<SwitchProfileResult>;
  deleteProfile(profileName: string): Promise<DeleteProfileResult>;
  startOAuthLogin(): Promise<OAuthLoginSession>;
  inspectOAuthLogin(sessionId: string): Promise<OAuthLoginInspectResult>;
  saveOAuthLogin(request: OAuthLoginSaveRequest): Promise<OAuthLoginSaveResult>;
  cancelOAuthLogin(request: OAuthLoginCancelRequest): Promise<void>;
  refreshProfileUsage(profileName: string): Promise<ProfileUsageResult>;
  refreshAllUsage(): Promise<Record<string, ProfileUsageResult>>;
  getLocalDiagnostics(): Promise<LocalDiagnosticsResult>;
  selectDirectory(defaultPath?: string): Promise<string | undefined>;
  revealPath(target: RevealTarget): Promise<void>;
}
