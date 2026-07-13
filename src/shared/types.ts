export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export type TrayBehavior = "exit" | "minimize_to_tray";
export type TargetTool = "gemini" | "antigravity-cli";
export type RevealTarget = "profilesRoot" | "targetGeminiDir" | "targetAntigravityCliDir";
/** Global usage percentage display preference shared by Gemini and Antigravity. */
export type UsageDisplayMode = "used" | "remaining";
export type UiTheme = "classic" | "rpg-parchment";
export type AppUpdatePhase = "disabled" | "idle" | "checking" | "up-to-date" | "downloading" | "downloaded" | "error";

export interface AppUpdateStatus {
  phase: AppUpdatePhase;
  latestVersion?: string;
}

export interface AppRuntimeInfo {
  isPackaged: boolean;
  isPortable: boolean;
  version: string;
}

export interface AntigravityProfileRecord {
  id: string;
  name: string;
  accountEmail?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  profilesRoot: string;
  windowBounds?: WindowBounds;
  trayBehavior?: TrayBehavior;
  selectedTool?: TargetTool;
  autoUpdateEnabled?: boolean;
  /** How usage percentages are shown. Default/backward-compatible: used percentage. */
  usageDisplayMode?: UsageDisplayMode;
  /** Built-in renderer skin. Default/backward-compatible: classic. */
  uiTheme?: UiTheme;
  lastSelectedProfile?: string;
  lastSwitch?: LastSwitchResult;
  profileNicknames?: Record<string, string>;
  antigravityProfiles?: AntigravityProfileRecord[];
}

export interface LastSwitchResult {
  profileName: string;
  switchedAt: number;
  verified: boolean;
  targetTool?: TargetTool;
}

export interface ProfileInfo {
  id?: string;
  name: string;
  accountEmail?: string;
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

export interface UsageGroup {
  name: string;
  label: string;
  description?: string;
  tiers: UsageTier[];
}

export interface ProfileUsageResult {
  profileName: string;
  success: boolean;
  credentialStatus: CredentialStatus;
  tiers: UsageTier[];
  groups?: UsageGroup[];
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
  targetTool?: TargetTool;
  loginRoot: string;
  pendingProfilePath: string;
  pidFilePath?: string;
  credentialBackupTarget?: string;
  oauthPath: string;
  startedAt: number;
}

export interface OAuthLoginInspectResult {
  sessionId: string;
  targetTool?: TargetTool;
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
  targetTool?: TargetTool;
  profileId?: string;
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
  getRuntimeInfo(): Promise<AppRuntimeInfo>;
  getUpdateStatus(): Promise<AppUpdateStatus>;
  onUpdateStatusChanged(listener: (status: AppUpdateStatus) => void): () => void;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  listProfiles(targetTool?: TargetTool): Promise<ProfileListResult>;
  switchProfile(profileName: string, targetTool?: TargetTool): Promise<SwitchProfileResult>;
  deleteProfile(profileIdentifier: string, targetTool?: TargetTool): Promise<DeleteProfileResult>;
  registerCurrentAntigravity(): Promise<OAuthLoginSaveResult>;
  startOAuthLogin(targetTool?: TargetTool): Promise<OAuthLoginSession>;
  inspectOAuthLogin(sessionId: string): Promise<OAuthLoginInspectResult>;
  saveOAuthLogin(request: OAuthLoginSaveRequest): Promise<OAuthLoginSaveResult>;
  cancelOAuthLogin(request: OAuthLoginCancelRequest): Promise<void>;
  refreshProfileUsage(profileIdentifier: string, targetTool?: TargetTool): Promise<ProfileUsageResult>;
  refreshAllUsage(targetTool?: TargetTool): Promise<Record<string, ProfileUsageResult>>;
  getLocalDiagnostics(): Promise<LocalDiagnosticsResult>;
  selectDirectory(defaultPath?: string): Promise<string | undefined>;
  revealPath(target: RevealTarget): Promise<void>;
}
