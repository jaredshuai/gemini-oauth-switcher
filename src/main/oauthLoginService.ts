import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { OAuthLoginInspectResult, OAuthLoginSaveResult, OAuthLoginSession } from "../shared/types";
import { fileExists, hashFile, validateProfileName } from "./profileService";

const GEMINI_DIR = ".gemini";
const OAUTH_FILE = "oauth_creds.json";
const PENDING_LOGIN_PREFIX = ".pending-login-";

type LaunchPowerShell = (script: string) => Promise<void>;
type TerminateProcessTree = (pid: number) => Promise<void>;

interface PowerShellLaunchCommand {
  file: string;
  args: string[];
}

interface PowerShellLoginScriptOptions {
  profilePath: string;
  pidFilePath?: string;
  workingDirectory: string;
}

interface CreateOAuthLoginSessionOptions {
  profilesRoot: string;
  launchPowerShell?: LaunchPowerShell;
  now?: () => Date;
  randomId?: () => string;
}

interface OAuthLoginSessionOptions {
  profilesRoot: string;
  sessionId: string;
  pendingProfilePath: string;
  pidFilePath?: string;
}

interface CleanupOAuthLoginSessionOptions extends OAuthLoginSessionOptions {
  removeDirectory?: (directoryPath: string) => Promise<void>;
  removeFile?: (filePath: string) => Promise<void>;
  terminateProcessTree?: TerminateProcessTree;
}

interface CleanupStaleOAuthLoginSessionsOptions {
  profilesRoot: string;
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
}

interface ParsedOAuthIdentity {
  accountEmail?: string;
}

export async function createOAuthLoginSession(options: CreateOAuthLoginSessionOptions): Promise<OAuthLoginSession> {
  const profilesRoot = path.resolve(options.profilesRoot);
  await mkdir(profilesRoot, { recursive: true });

  const sessionId = makeSessionId(options.now?.() ?? new Date(), options.randomId?.() ?? randomBytes(4).toString("hex"));
  const pendingProfilePath = path.join(profilesRoot, `${PENDING_LOGIN_PREFIX}${sessionId}`);
  const pidFilePath = getPidFilePath(profilesRoot, sessionId);
  await mkdir(pendingProfilePath, { recursive: true });

  const script = buildPowerShellLoginScript({
    profilePath: pendingProfilePath,
    pidFilePath,
    workingDirectory: profilesRoot
  });
  await (options.launchPowerShell ?? launchPowerShellWindow)(script);

  return {
    sessionId,
    pendingProfilePath,
    pidFilePath,
    oauthPath: getOAuthPath(pendingProfilePath),
    startedAt: Date.now()
  };
}

export async function inspectOAuthLoginSession(options: OAuthLoginSessionOptions): Promise<OAuthLoginInspectResult> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const pendingProfilePath = path.resolve(options.pendingProfilePath);
  assertPendingProfilePath(profilesRoot, pendingProfilePath);

  const oauthPath = getOAuthPath(pendingProfilePath);
  if (!(await fileExists(oauthPath))) {
    return {
      sessionId: options.sessionId,
      pendingProfilePath,
      oauthPath,
      oauthExists: false
    };
  }

  const [oauthStat, identity, sha256] = await Promise.all([stat(oauthPath), readOAuthIdentity(oauthPath), hashFile(oauthPath)]);
  const proposedBaseName = identity.accountEmail ?? `gemini-account-${sha256.slice(0, 8)}`;
  const proposedProfileName = sanitizeProfileName(proposedBaseName);
  const conflictProfileName = await findConflictProfileName(profilesRoot, proposedProfileName, identity.accountEmail);

  return {
    sessionId: options.sessionId,
    pendingProfilePath,
    oauthPath,
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
  const pendingProfilePath = path.resolve(options.pendingProfilePath);
  assertPendingProfilePath(profilesRoot, pendingProfilePath);

  const inspection = await inspectOAuthLoginSession({
    profilesRoot,
    sessionId: options.sessionId,
    pendingProfilePath
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

  await rename(pendingProfilePath, targetProfilePath);
  const savedOAuthPath = getOAuthPath(targetProfilePath);
  const savedHash = await hashFile(savedOAuthPath);

  return {
    sessionId: options.sessionId,
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
  lines.push(
    "$env:GEMINI_CLI_HOME = $profile",
    "Remove-Item Env:\\GEMINI_API_KEY -ErrorAction SilentlyContinue",
    "Remove-Item Env:\\GOOGLE_API_KEY -ErrorAction SilentlyContinue",
    "Remove-Item Env:\\GOOGLE_GEMINI_BASE_URL -ErrorAction SilentlyContinue",
    "Remove-Item Env:\\GOOGLE_VERTEX_BASE_URL -ErrorAction SilentlyContinue",
    "Set-Location -LiteralPath $workspace",
    "gemini --skip-trust"
  );
  return lines.join("\r\n");
}

export function getOAuthPath(profilePath: string): string {
  return path.join(profilePath, GEMINI_DIR, OAUTH_FILE);
}

async function launchPowerShellWindow(script: string): Promise<void> {
  const command = buildPowerShellLaunchCommand(script);
  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
}

export function buildPowerShellLaunchCommand(script: string): PowerShellLaunchCommand {
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  return {
    file: "cmd.exe",
    args: [
      "/d",
      "/c",
      "start",
      "Gemini OAuth Login",
      "powershell.exe",
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(oauthPath, "utf8"));
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

function normalizeEmail(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : undefined;
}

function sanitizeProfileName(value: string): string {
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
