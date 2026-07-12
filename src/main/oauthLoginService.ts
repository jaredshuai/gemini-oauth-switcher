import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { OAuthLoginInspectResult, OAuthLoginSaveResult, OAuthLoginSession, TargetTool } from "../shared/types";
import {
  ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET,
  type CredentialStore,
  getAntigravityLoginBackupCredentialTarget,
  getAntigravityProfileCredentialTarget,
  hashCredentialPayload,
  nativeAntigravityCredentialStore
} from "./antigravityCredentialService";
import { fileExists, getProfileFilePath, hashFile, validateProfileName } from "./profileService";
import { getProfileTargetConfig, normalizeTargetTool } from "./profileTargets";

const GEMINI_DIR = ".gemini";
const OAUTH_FILE = "oauth_creds.json";
const PENDING_LOGIN_PREFIX = ".pending-login-";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const USERINFO_TIMEOUT_MS = 4_000;
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 30_000;

const hasPwsh = spawnSync("where.exe", ["pwsh.exe"], { stdio: "ignore" }).status === 0;

type LaunchPowerShell = (script: string, title: string) => Promise<void>;
type TerminateProcessTree = (pid: number) => Promise<void>;
type OAuthIdentityResolver = (value: string) => Promise<ParsedOAuthIdentity>;
type OAuthUserInfoFetcher = (accessToken: string) => Promise<unknown>;

interface PowerShellLaunchCommand {
  file: string;
  args: string[];
}

interface PowerShellLoginScriptOptions {
  profilePath: string;
  pidFilePath?: string;
  workingDirectory: string;
  targetTool?: TargetTool;
}

interface CreateOAuthLoginSessionOptions {
  profilesRoot: string;
  targetTool?: TargetTool;
  credentialStore?: CredentialStore;
  credentialTarget?: string;
  launchPowerShell?: LaunchPowerShell;
  now?: () => Date;
  randomId?: () => string;
}

interface OAuthLoginSessionOptions {
  profilesRoot: string;
  sessionId: string;
  pendingProfilePath: string;
  targetTool?: TargetTool;
  pidFilePath?: string;
  credentialBackupTarget?: string;
  credentialStore?: CredentialStore;
  credentialTarget?: string;
  resolveIdentity?: OAuthIdentityResolver;
}

interface CleanupOAuthLoginSessionOptions extends OAuthLoginSessionOptions {
  restorePreviousCredential?: boolean;
  removeDirectory?: (directoryPath: string) => Promise<void>;
  removeFile?: (filePath: string) => Promise<void>;
  terminateProcessTree?: TerminateProcessTree;
}

interface CleanupStaleOAuthLoginSessionsOptions {
  profilesRoot: string;
  credentialStore?: CredentialStore;
  credentialTarget?: string;
  olderThanMs?: number;
  nowMs?: () => number;
  removeDirectory?: (directoryPath: string) => Promise<void>;
  removeFile?: (filePath: string) => Promise<void>;
  terminateProcessTree?: TerminateProcessTree;
}

interface CleanupStaleOAuthLoginSessionsResult {
  removed: string[];
  failed: string[];
  skipped: string[];
}

interface SaveOAuthLoginSessionOptions extends OAuthLoginSessionOptions {
  profileName?: string;
  nickname?: string;
  getProfileCredentialTarget?: (profileName: string) => string;
}

export interface ParsedOAuthIdentity {
  accountEmail?: string;
}

export interface ResolveOAuthIdentityOptions {
  fetchUserInfo?: OAuthUserInfoFetcher;
  now?: () => number;
}

interface AntigravityLoginCredentialOptions {
  targetTool?: TargetTool;
  credentialStore?: CredentialStore;
  credentialTarget?: string;
}

export async function createOAuthLoginSession(options: CreateOAuthLoginSessionOptions): Promise<OAuthLoginSession> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const targetTool = normalizeTargetTool(options.targetTool);
  await mkdir(profilesRoot, { recursive: true });

  const sessionId = makeSessionId(options.now?.() ?? new Date(), options.randomId?.() ?? randomBytes(4).toString("hex"));
  const pendingProfilePath = path.join(profilesRoot, `${PENDING_LOGIN_PREFIX}${sessionId}`);
  const pidFilePath = getPidFilePath(profilesRoot, sessionId);
  const credentialMode = getAntigravityLoginCredentialMode(options);
  const credentialBackupTarget = credentialMode
    ? getAntigravityLoginBackupCredentialTarget(profilesRoot, sessionId)
    : undefined;
  await mkdir(pendingProfilePath, { recursive: true });

  if (credentialMode && credentialBackupTarget) {
    await prepareAntigravityLoginCredential(credentialMode, credentialBackupTarget);
  }

  const script = buildPowerShellLoginScript({
    profilePath: pendingProfilePath,
    pidFilePath,
    workingDirectory: profilesRoot,
    targetTool
  });
  try {
    await (options.launchPowerShell ?? launchPowerShellWindow)(
      script,
      targetTool === "antigravity-cli" ? "Antigravity CLI Login" : "Gemini OAuth Login"
    );
  } catch (error) {
    if (credentialMode && credentialBackupTarget) {
      await finalizeAntigravityLoginCredential(credentialMode, credentialBackupTarget, true, true).catch(() => undefined);
    }
    await rm(pendingProfilePath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return {
    sessionId,
    targetTool,
    loginRoot: profilesRoot,
    pendingProfilePath,
    pidFilePath,
    credentialBackupTarget,
    oauthPath: getLoginCredentialPath(pendingProfilePath, targetTool),
    startedAt: Date.now()
  };
}

export async function inspectOAuthLoginSession(options: OAuthLoginSessionOptions): Promise<OAuthLoginInspectResult> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const targetTool = normalizeTargetTool(options.targetTool);
  const pendingProfilePath = path.resolve(options.pendingProfilePath);
  assertPendingProfilePath(profilesRoot, pendingProfilePath);

  const oauthPath = getLoginCredentialPath(pendingProfilePath, targetTool);
  const credentialMode = getAntigravityLoginCredentialMode(options);
  const credentialPayload = credentialMode ? await credentialMode.store.get(credentialMode.target) : undefined;
  const oauthExists = await fileExists(oauthPath);
  if (!oauthExists && !credentialPayload) {
    return {
      sessionId: options.sessionId,
      targetTool,
      pendingProfilePath,
      oauthPath,
      oauthExists: false
    };
  }

  const [oauthStat, identity, sha256] = oauthExists
    ? await Promise.all([stat(oauthPath), readOAuthIdentity(oauthPath), hashFile(oauthPath)])
    : [
        await stat(pendingProfilePath),
        await (options.resolveIdentity ?? resolveOAuthIdentityFromText)(credentialPayload ?? ""),
        hashCredentialPayload(credentialPayload ?? "")
      ] as const;
  const proposedBaseName = identity.accountEmail ?? `${targetTool === "antigravity-cli" ? "antigravity-profile" : "gemini-account"}-${sha256.slice(0, 8)}`;
  const proposedProfileName = sanitizeOAuthProfileName(proposedBaseName);
  const conflictProfileName = await findConflictProfileName(profilesRoot, proposedProfileName, identity.accountEmail);

  return {
    sessionId: options.sessionId,
    targetTool,
    pendingProfilePath,
    oauthPath: oauthExists ? oauthPath : (credentialMode?.target ?? oauthPath),
    oauthExists: true,
    updatedAt: oauthStat.mtime.toISOString(),
    updatedAtMs: oauthStat.mtimeMs,
    sha256,
    shortHash: sha256.slice(0, 8),
    accountEmail: identity.accountEmail,
    proposedProfileName,
    proposedNickname: identity.accountEmail,
    conflictProfileName,
    targetProfilePath: path.join(profilesRoot, proposedProfileName)
  };
}

export async function saveOAuthLoginSession(options: SaveOAuthLoginSessionOptions): Promise<OAuthLoginSaveResult> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const targetTool = normalizeTargetTool(options.targetTool);
  const pendingProfilePath = path.resolve(options.pendingProfilePath);
  assertPendingProfilePath(profilesRoot, pendingProfilePath);

  const inspection = await inspectOAuthLoginSession({
    profilesRoot,
    sessionId: options.sessionId,
    pendingProfilePath,
    targetTool,
    credentialStore: options.credentialStore,
    credentialTarget: options.credentialTarget
  });
  if (!inspection.oauthExists) {
    throw new Error("OAuth file has not been created yet.");
  }
  if (!inspection.sha256) {
    throw new Error("OAuth file hash is unavailable.");
  }

  const profileName = validateProfileName(options.profileName?.trim() || inspection.proposedProfileName || "");
  const targetProfilePath = path.resolve(profilesRoot, profileName);
  if (!isInsideDirectory(targetProfilePath, profilesRoot)) {
    throw new Error("Invalid profile name: profile must be a direct child of profilesRoot");
  }

  if (await directoryExists(targetProfilePath)) {
    throw new Error(`Profile already exists: ${profileName}`);
  }

  const credentialMode = getAntigravityLoginCredentialMode(options);
  const credentialPayload = credentialMode ? await credentialMode.store.get(credentialMode.target) : undefined;
  await rename(pendingProfilePath, targetProfilePath);

  let savedOAuthPath = getLoginCredentialPath(targetProfilePath, targetTool);
  let savedHash = await fileExists(savedOAuthPath) ? await hashFile(savedOAuthPath) : inspection.sha256;
  if (credentialMode && credentialPayload) {
    const profileCredentialTarget = (options.getProfileCredentialTarget ?? getAntigravityProfileCredentialTarget)(
      profileName
    );
    await credentialMode.store.set(profileCredentialTarget, credentialPayload);
    savedOAuthPath = profileCredentialTarget;
    savedHash = hashCredentialPayload(credentialPayload);
  }

  return {
    sessionId: options.sessionId,
    targetTool,
    profileName,
    nickname: options.nickname?.trim() || inspection.proposedNickname,
    profilePath: targetProfilePath,
    oauthPath: savedOAuthPath,
    accountEmail: inspection.accountEmail,
    sha256: savedHash
  };
}

export async function cleanupOAuthLoginSession(options: CleanupOAuthLoginSessionOptions): Promise<void> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const pendingProfilePath = path.resolve(options.pendingProfilePath);
  assertPendingProfilePath(profilesRoot, pendingProfilePath);
  const removeDirectory = options.removeDirectory ?? ((directoryPath: string) => rm(directoryPath, { recursive: true, force: true }));
  const removeFile = options.removeFile ?? ((filePath: string) => rm(filePath, { force: true }));
  const pidFilePath = resolvePidFilePath(profilesRoot, options.sessionId, options.pidFilePath);

  await terminateOAuthLoginProcess(
    pidFilePath,
    options.terminateProcessTree ?? terminateWindowsProcessTree,
    options.terminateProcessTree ? 0 : 1500
  );

  const credentialMode = getAntigravityLoginCredentialMode(options);
  if (credentialMode) {
    const credentialBackupTarget =
      options.credentialBackupTarget ?? getAntigravityLoginBackupCredentialTarget(profilesRoot, options.sessionId);
    await finalizeAntigravityLoginCredential(
      credentialMode,
      credentialBackupTarget,
      options.restorePreviousCredential === true,
      options.restorePreviousCredential === true
    );
  }

  try {
    await removeDirectoryWithRetry(pendingProfilePath, removeDirectory);
  } catch (error) {
    if (isBusyError(error)) {
      throw new Error("登录窗口仍在使用这个临时目录。请先关闭 PowerShell 登录窗口后再取消。");
    }
    throw error;
  } finally {
    await removeFile(pidFilePath);
  }
}

export async function cleanupStaleOAuthLoginSessions(
  options: CleanupStaleOAuthLoginSessionsOptions
): Promise<CleanupStaleOAuthLoginSessionsResult> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const olderThanMs = options.olderThanMs ?? 24 * 60 * 60 * 1000;
  const nowMs = options.nowMs ?? Date.now;
  const removeDirectory = options.removeDirectory ?? ((directoryPath: string) => rm(directoryPath, { recursive: true, force: true }));
  const removeFile = options.removeFile ?? ((filePath: string) => rm(filePath, { force: true }));
  const terminateProcessTree = options.terminateProcessTree ?? terminateWindowsProcessTree;
  const credentialMode =
    options.credentialStore && options.credentialTarget
      ? { store: options.credentialStore, target: options.credentialTarget }
      : undefined;

  const rootStat = await stat(profilesRoot).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  });
  if (!rootStat?.isDirectory()) {
    return { removed: [], failed: [], skipped: [] };
  }

  const removed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const entries = await readdir(profilesRoot, { withFileTypes: true });
  const cleanupResults = await Promise.allSettled(
    entries.map(async (entry) => {
      const hasPendingName = entry.name.startsWith(PENDING_LOGIN_PREFIX);
      const isPendingPidFileName = hasPendingName && entry.name.endsWith(".pid");
      if (!hasPendingName) {
        return;
      }

      const entryPath = path.join(profilesRoot, entry.name);
      const entryLinkStat = await lstat(entryPath).catch((error: unknown) => {
        if (isNotFoundError(error)) {
          return undefined;
        }
        throw error;
      });
      if (!entryLinkStat || nowMs() - entryLinkStat.mtimeMs < olderThanMs) {
        return;
      }
      if (!(await isSafePendingEntryPath(profilesRoot, entryPath))) {
        skipped.push(entry.name);
        return;
      }

      if (isPendingPidFileName) {
        if (!entryLinkStat.isFile()) {
          return;
        }
        await removeFile(entryPath);
        removed.push(entry.name);
        return;
      }

      if (entryLinkStat.isDirectory()) {
        const sessionId = entry.name.slice(PENDING_LOGIN_PREFIX.length);
        const pidFilePath = getPidFilePathIfValid(profilesRoot, sessionId);
        if (pidFilePath) {
          await terminateOAuthLoginProcess(pidFilePath, terminateProcessTree, 0);
        }
        if (credentialMode) {
          await finalizeAntigravityLoginCredential(
            credentialMode,
            getAntigravityLoginBackupCredentialTarget(profilesRoot, sessionId),
            true,
            false
          );
        }
        await removeDirectoryWithRetry(entryPath, removeDirectory);
        if (pidFilePath && (await fileExists(pidFilePath))) {
          await removeFile(pidFilePath);
          removed.push(path.basename(pidFilePath));
        }
        removed.push(entry.name);
      }
    })
  );
  for (const [index, result] of cleanupResults.entries()) {
    if (result.status === "rejected") {
      failed.push(entries[index]?.name ?? "unknown");
    }
  }

  removed.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  failed.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  skipped.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return { removed: [...new Set(removed)], failed, skipped };
}

export function buildPowerShellLoginScript(options: PowerShellLoginScriptOptions): string {
  const targetTool = normalizeTargetTool(options.targetTool);
  const lines = [
    `$profile = '${escapePowerShellSingleQuoted(options.profilePath)}'`,
    `$workspace = '${escapePowerShellSingleQuoted(options.workingDirectory)}'`,
    "New-Item -ItemType Directory -Force -Path $profile | Out-Null",
    "New-Item -ItemType Directory -Force -Path $workspace | Out-Null"
  ];
  if (options.pidFilePath) {
    lines.push(
      `$pidFile = '${escapePowerShellSingleQuoted(options.pidFilePath)}'`,
      "Set-Content -LiteralPath $pidFile -Value $PID -Encoding ascii -Force"
    );
  }
  if (targetTool === "antigravity-cli") {
    lines.push(
      "$env:USERPROFILE = $profile",
      "$env:HOME = $profile",
      "$env:APPDATA = Join-Path $profile 'AppData\\Roaming'",
      "$env:LOCALAPPDATA = Join-Path $profile 'AppData\\Local'",
      "New-Item -ItemType Directory -Force -Path $env:APPDATA | Out-Null",
      "New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA | Out-Null",
      "Remove-Item Env:\\GEMINI_API_KEY -ErrorAction SilentlyContinue",
      "Remove-Item Env:\\GOOGLE_API_KEY -ErrorAction SilentlyContinue",
      "Remove-Item Env:\\GOOGLE_GEMINI_BASE_URL -ErrorAction SilentlyContinue",
      "Remove-Item Env:\\GOOGLE_VERTEX_BASE_URL -ErrorAction SilentlyContinue",
      "Set-Location -LiteralPath $workspace",
      "agy"
    );
  } else {
    lines.push(
      "$env:GEMINI_CLI_HOME = $profile",
      "Remove-Item Env:\\GEMINI_API_KEY -ErrorAction SilentlyContinue",
      "Remove-Item Env:\\GOOGLE_API_KEY -ErrorAction SilentlyContinue",
      "Remove-Item Env:\\GOOGLE_GEMINI_BASE_URL -ErrorAction SilentlyContinue",
      "Remove-Item Env:\\GOOGLE_VERTEX_BASE_URL -ErrorAction SilentlyContinue",
      "Set-Location -LiteralPath $workspace",
      "gemini --skip-trust"
    );
  }
  return lines.join("\r\n");
}

export function getOAuthPath(profilePath: string): string {
  return path.join(profilePath, GEMINI_DIR, OAUTH_FILE);
}

export function getLoginCredentialPath(profilePath: string, targetTool?: TargetTool): string {
  const target = getProfileTargetConfig(targetTool);
  return getProfileFilePath(profilePath, "", target.profileFileRelativePath);
}

async function launchPowerShellWindow(script: string, title: string): Promise<void> {
  const command = buildPowerShellLaunchCommand(script, title);
  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
}

export function buildPowerShellLaunchCommand(script: string, title = "Gemini OAuth Login"): PowerShellLaunchCommand {
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  const psExe = hasPwsh ? "pwsh.exe" : "powershell.exe";
  return {
    file: "cmd.exe",
    args: [
      "/d",
      "/c",
      "start",
      title,
      psExe,
      "-NoExit",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedCommand
    ]
  };
}

async function readOAuthIdentity(oauthPath: string): Promise<ParsedOAuthIdentity> {
  try {
    return readOAuthIdentityFromText(await readFile(oauthPath, "utf8"));
  } catch {
    return {};
  }
}

export function readOAuthIdentityFromText(value: string): ParsedOAuthIdentity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }

  const preferredEmail = findEmailByPreferredKey(parsed);
  if (preferredEmail) {
    return { accountEmail: preferredEmail };
  }

  const jwtEmail = findJwtEmail(parsed);
  if (jwtEmail) {
    return { accountEmail: jwtEmail };
  }

  return { accountEmail: findAnyEmail(parsed) };
}

export async function resolveOAuthIdentityFromText(
  value: string,
  options: ResolveOAuthIdentityOptions = {}
): Promise<ParsedOAuthIdentity> {
  const embeddedIdentity = readOAuthIdentityFromText(value);
  if (embeddedIdentity.accountEmail) {
    return embeddedIdentity;
  }

  const accessToken = readFreshOAuthAccessToken(value, options.now?.() ?? Date.now());
  if (!accessToken) {
    return {};
  }

  try {
    const userInfo = await (options.fetchUserInfo ?? fetchGoogleOAuthUserInfo)(accessToken);
    if (!userInfo || typeof userInfo !== "object") {
      return {};
    }

    const email = normalizeEmail((userInfo as { email?: unknown }).email);
    return email ? { accountEmail: email } : {};
  } catch {
    return {};
  }
}

function readFreshOAuthAccessToken(value: string, nowMs: number): string | undefined {
  try {
    const parsed = JSON.parse(value) as { token?: { access_token?: unknown; expiry?: unknown } };
    const accessToken = parsed.token?.access_token;
    const expiry = parsed.token?.expiry;
    if (typeof accessToken !== "string" || !accessToken || typeof expiry !== "string") {
      return undefined;
    }

    const expiryMs = Date.parse(expiry);
    return Number.isFinite(expiryMs) && expiryMs > nowMs + ACCESS_TOKEN_EXPIRY_SKEW_MS
      ? accessToken
      : undefined;
  } catch {
    return undefined;
  }
}

async function fetchGoogleOAuthUserInfo(accessToken: string): Promise<unknown> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS)
  });
  if (!response.ok) {
    return undefined;
  }

  return response.json();
}

function getAntigravityLoginCredentialMode(options: AntigravityLoginCredentialOptions):
  | {
      store: CredentialStore;
      target: string;
    }
  | undefined {
  if (normalizeTargetTool(options.targetTool) !== "antigravity-cli") {
    return undefined;
  }

  return {
    store: options.credentialStore ?? nativeAntigravityCredentialStore,
    target: options.credentialTarget ?? ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET
  };
}

async function prepareAntigravityLoginCredential(
  credentialMode: { store: CredentialStore; target: string },
  credentialBackupTarget: string
): Promise<void> {
  const previousPayload = await credentialMode.store.get(credentialMode.target);
  if (previousPayload) {
    await credentialMode.store.set(credentialBackupTarget, previousPayload);
  } else {
    await credentialMode.store.delete(credentialBackupTarget);
  }

  try {
    await credentialMode.store.delete(credentialMode.target);
  } catch (error) {
    if (previousPayload) {
      await credentialMode.store.set(credentialMode.target, previousPayload).catch(() => undefined);
    }
    await credentialMode.store.delete(credentialBackupTarget).catch(() => undefined);
    throw error;
  }
}

async function finalizeAntigravityLoginCredential(
  credentialMode: { store: CredentialStore; target: string },
  credentialBackupTarget: string,
  restorePreviousCredential: boolean,
  deleteCurrentWhenBackupMissing: boolean
): Promise<void> {
  const previousPayload = await credentialMode.store.get(credentialBackupTarget);
  if (restorePreviousCredential) {
    if (previousPayload) {
      await credentialMode.store.set(credentialMode.target, previousPayload);
    } else if (deleteCurrentWhenBackupMissing) {
      await credentialMode.store.delete(credentialMode.target);
    }
  }

  await credentialMode.store.delete(credentialBackupTarget);
}

function findEmailByPreferredKey(value: unknown): string | undefined {
  return findEmail(value, (key) =>
    ["email", "account", "user_email", "email_address", "preferred_username", "login"].includes(key.toLowerCase())
  );
}

function findAnyEmail(value: unknown): string | undefined {
  return findEmail(value, () => true);
}

function findEmail(value: unknown, keyMatches: (key: string) => boolean): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const email = findEmail(item, keyMatches);
      if (email) {
        return email;
      }
    }
    return undefined;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === "string" && keyMatches(key)) {
      const email = normalizeEmail(entryValue);
      if (email) {
        return email;
      }
    }

    const nestedEmail = findEmail(entryValue, keyMatches);
    if (nestedEmail) {
      return nestedEmail;
    }
  }

  return undefined;
}

function findJwtEmail(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const email = findJwtEmail(item);
      if (email) {
        return email;
      }
    }
    return undefined;
  }

  for (const entryValue of Object.values(value)) {
    if (typeof entryValue === "string") {
      const email = readJwtPayloadEmail(entryValue);
      if (email) {
        return email;
      }
    }

    const nestedEmail = findJwtEmail(entryValue);
    if (nestedEmail) {
      return nestedEmail;
    }
  }

  return undefined;
}

function readJwtPayloadEmail(value: string): string | undefined {
  const parts = value.split(".");
  if (parts.length < 2) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(base64UrlToBase64(parts[1]), "base64").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" ? normalizeEmail(payload.email) : undefined;
  } catch {
    return undefined;
  }
}

function base64UrlToBase64(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : undefined;
}

export function sanitizeOAuthProfileName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 96);

  return sanitized || "gemini-account";
}

function makeSessionId(now: Date, randomId: string): string {
  return `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-")}-${randomId}`;
}

function getPidFilePath(profilesRoot: string, sessionId: string): string {
  assertLoginSessionId(sessionId);
  return path.join(profilesRoot, `${PENDING_LOGIN_PREFIX}${sessionId}.pid`);
}

function getPidFilePathIfValid(profilesRoot: string, sessionId: string): string | undefined {
  try {
    return getPidFilePath(profilesRoot, sessionId);
  } catch {
    return undefined;
  }
}

function resolvePidFilePath(profilesRoot: string, sessionId: string, pidFilePath?: string): string {
  const resolvedPath = path.resolve(pidFilePath ?? getPidFilePath(profilesRoot, sessionId));
  const expectedPath = path.resolve(getPidFilePath(profilesRoot, sessionId));
  if (resolvedPath !== expectedPath) {
    throw new Error("Invalid login session process file path.");
  }

  return resolvedPath;
}

async function terminateOAuthLoginProcess(
  pidFilePath: string,
  terminateProcessTree: TerminateProcessTree,
  waitForPidMs: number
): Promise<void> {
  const pid = await readPidFileWithWait(pidFilePath, waitForPidMs);
  if (!pid) {
    return;
  }

  await terminateProcessTree(pid);
}

async function readPidFileWithWait(pidFilePath: string, waitForPidMs: number): Promise<number | undefined> {
  const deadline = Date.now() + waitForPidMs;
  let pid = await readPidFile(pidFilePath);
  while (!pid && Date.now() < deadline) {
    await delay(100);
    pid = await readPidFile(pidFilePath);
  }

  return pid;
}

async function readPidFile(pidFilePath: string): Promise<number | undefined> {
  let rawPid: string;
  try {
    rawPid = await readFile(pidFilePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }

  const pid = Number.parseInt(rawPid.trim(), 10);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

async function terminateWindowsProcessTree(pid: number): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  await new Promise<void>((resolve) => {
    const child = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", () => resolve());
    child.once("close", () => resolve());
  });
}

async function removeDirectoryWithRetry(
  directoryPath: string,
  removeDirectory: (directoryPath: string) => Promise<void>
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await removeDirectory(directoryPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isBusyError(error)) {
        throw error;
      }
      await delay(150);
    }
  }

  throw lastError;
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    const directoryStat = await stat(directoryPath);
    return directoryStat.isDirectory();
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function isSafePendingEntryPath(profilesRoot: string, entryPath: string): Promise<boolean> {
  const entryLinkStat = await lstat(entryPath).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  });
  if (!entryLinkStat || entryLinkStat.isSymbolicLink()) {
    return false;
  }

  const [realRoot, realEntryPath] = await Promise.all([realpath(profilesRoot), realpath(entryPath)]);
  return isInsideDirectory(realEntryPath, realRoot);
}

async function findConflictProfileName(
  profilesRoot: string,
  proposedProfileName: string,
  accountEmail?: string
): Promise<string | undefined> {
  if (await directoryExists(path.join(profilesRoot, proposedProfileName))) {
    return proposedProfileName;
  }

  if (!accountEmail || accountEmail === proposedProfileName) {
    return undefined;
  }

  let exactEmailProfileName: string;
  try {
    exactEmailProfileName = validateProfileName(accountEmail);
  } catch {
    return undefined;
  }

  return (await directoryExists(path.join(profilesRoot, exactEmailProfileName))) ? exactEmailProfileName : undefined;
}

function assertPendingProfilePath(profilesRoot: string, pendingProfilePath: string): void {
  if (!isInsideDirectory(pendingProfilePath, profilesRoot) || !path.basename(pendingProfilePath).startsWith(PENDING_LOGIN_PREFIX)) {
    throw new Error("Invalid login session path.");
  }
}

function assertLoginSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new Error("Invalid login session id.");
  }
}

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(filePath));
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isBusyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EBUSY" || error.code === "EPERM")
  );
}
