import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, realpath, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { DeleteProfileResult, ProfileInfo, ProfileListResult, SwitchProfileResult } from "../shared/types";

const GEMINI_DIR = ".gemini";
const OAUTH_FILE = "oauth_creds.json";
const PENDING_LOGIN_PREFIX = ".pending-login-";
const targetOperationQueues = new Map<string, Promise<unknown>>();

export interface ListProfilesOptions {
  profilesRoot: string;
  targetOAuthPath: string;
}

export interface SwitchProfileOptions extends ListProfilesOptions {
  profileName: string;
}

export interface DeleteProfileOptions extends ListProfilesOptions {
  profileName: string;
  removeDirectory?: (profilePath: string) => Promise<void>;
}

export function getProfileOAuthPath(profilesRoot: string, profileName: string): string {
  return path.join(profilesRoot, profileName, GEMINI_DIR, OAUTH_FILE);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

export async function hashFile(filePath: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

export async function listProfiles(options: ListProfilesOptions): Promise<ProfileListResult> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const targetOAuthPath = path.resolve(options.targetOAuthPath);
  const targetGeminiDir = path.dirname(targetOAuthPath);
  const targetHash = (await fileExists(targetOAuthPath)) ? await hashFile(targetOAuthPath) : undefined;

  const rootStat = await stat(profilesRoot).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  });
  if (!rootStat) {
    return {
      profilesRoot,
      targetGeminiDir,
      targetOAuthPath,
      targetHash,
      profiles: []
    };
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`profilesRoot is not a directory: ${profilesRoot}`);
  }

  const entries = await readdir(profilesRoot, { withFileTypes: true });
  const profiles = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(PENDING_LOGIN_PREFIX))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map(async (entry): Promise<ProfileInfo> => {
        const profilePath = path.join(profilesRoot, entry.name);
        const oauthPath = getProfileOAuthPath(profilesRoot, entry.name);
        const exists = await fileExists(oauthPath);

        if (!exists) {
          return {
            name: entry.name,
            profilePath,
            oauthPath,
            exists: false,
            isCurrent: false
          };
        }

        const oauthStat = await stat(oauthPath);
        const sha256 = await hashFile(oauthPath);

        return {
          name: entry.name,
          profilePath,
          oauthPath,
          exists: true,
          updatedAt: oauthStat.mtime.toISOString(),
          updatedAtMs: oauthStat.mtimeMs,
          sha256,
          shortHash: sha256.slice(0, 8),
          isCurrent: Boolean(targetHash && sha256 === targetHash)
        };
      })
  );

  return {
    profilesRoot,
    targetGeminiDir,
    targetOAuthPath,
    targetHash,
    profiles
  };
}

export async function switchProfile(options: SwitchProfileOptions): Promise<SwitchProfileResult> {
  return runTargetOperation(path.resolve(options.targetOAuthPath), () => switchProfileUnlocked(options));
}

async function switchProfileUnlocked(options: SwitchProfileOptions): Promise<SwitchProfileResult> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const targetPath = path.resolve(options.targetOAuthPath);
  const profileName = validateProfileName(options.profileName);
  const profilePath = path.resolve(profilesRoot, profileName);
  const sourcePath = path.resolve(getProfileOAuthPath(profilesRoot, profileName));

  if (!isInsideDirectory(sourcePath, profilesRoot)) {
    throw new Error("Invalid profile name: profile must be a direct child of profilesRoot");
  }
  await assertProfileDirectoryIsSafe(profilesRoot, profilePath);

  if (!(await fileExists(sourcePath))) {
    throw new Error(`OAuth file does not exist for profile: ${profileName}`);
  }
  await assertOAuthFileIsSafe(profilesRoot, sourcePath);

  const sourceHash = await hashFile(sourcePath);
  await ensureTargetGeminiDirectory(targetPath);

  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await copyFile(sourcePath, tempPath);

  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }

  const targetHash = await hashFile(targetPath);
  if (targetHash !== sourceHash) {
    throw new Error("Target OAuth hash does not match selected profile after switch");
  }

  return {
    profileName,
    sourcePath,
    targetPath,
    sourceHash,
    targetHash
  };
}

export async function deleteProfile(options: DeleteProfileOptions): Promise<DeleteProfileResult> {
  return runTargetOperation(path.resolve(options.targetOAuthPath), () => deleteProfileUnlocked(options));
}

async function deleteProfileUnlocked(options: DeleteProfileOptions): Promise<DeleteProfileResult> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const targetOAuthPath = path.resolve(options.targetOAuthPath);
  const profileName = validateProfileName(options.profileName);
  const profilePath = path.resolve(profilesRoot, profileName);

  if (!isInsideDirectory(profilePath, profilesRoot)) {
    throw new Error("Invalid profile name: profile must be a direct child of profilesRoot");
  }

  await assertProfileDirectoryIsSafe(profilesRoot, profilePath);
  const profileStat = await stat(profilePath).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  });
  if (!profileStat?.isDirectory()) {
    throw new Error(`Profile directory does not exist: ${profileName}`);
  }

  const sourcePath = path.resolve(getProfileOAuthPath(profilesRoot, profileName));
  if (!(await fileExists(sourcePath))) {
    throw new Error(`OAuth file does not exist for profile: ${profileName}`);
  }
  await assertOAuthFileIsSafe(profilesRoot, sourcePath);

  const targetHash = (await fileExists(targetOAuthPath)) ? await hashFile(targetOAuthPath) : undefined;
  const sourceHash = await hashFile(sourcePath);

  if (targetHash && sourceHash && targetHash === sourceHash) {
    throw new Error("Cannot delete the current profile. Switch to another account first.");
  }

  const removeDirectory = options.removeDirectory ?? ((targetPath: string) => rm(targetPath, { recursive: true }));
  await removeDirectory(profilePath);

  return {
    profileName,
    profilePath
  };
}

export function validateProfileName(profileName: string): string {
  const trimmed = profileName.trim();
  if (!trimmed || trimmed !== profileName || trimmed === "." || trimmed === ".." || path.isAbsolute(trimmed)) {
    throw new Error("Invalid profile name: profile must be a direct child of profilesRoot");
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("Invalid profile name: profile must be a direct child of profilesRoot");
  }

  if (/[<>:"|?*\u0000-\u001F]/u.test(trimmed) || trimmed.endsWith(".")) {
    throw new Error("Invalid profile name: profile contains Windows-reserved characters");
  }

  const deviceName = trimmed.split(".")[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(deviceName)) {
    throw new Error("Invalid profile name: profile uses a Windows-reserved name");
  }

  return trimmed;
}

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(filePath));
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function assertProfileDirectoryIsSafe(profilesRoot: string, profilePath: string): Promise<void> {
  const profileLinkStat = await lstat(profilePath).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  });
  if (!profileLinkStat) {
    return;
  }
  if (profileLinkStat.isSymbolicLink()) {
    throw new Error("Profile directory must not be a symbolic link or junction.");
  }

  const [realRoot, realProfilePath] = await Promise.all([realpath(profilesRoot), realpath(profilePath)]);
  if (!isInsideDirectory(realProfilePath, realRoot)) {
    throw new Error("Profile directory resolves outside profilesRoot.");
  }
}

async function assertOAuthFileIsSafe(profilesRoot: string, oauthPath: string): Promise<void> {
  const oauthLinkStat = await lstat(oauthPath);
  if (oauthLinkStat.isSymbolicLink()) {
    throw new Error("OAuth file must not be a symbolic link or junction.");
  }

  const [realRoot, realOAuthPath] = await Promise.all([realpath(profilesRoot), realpath(oauthPath)]);
  if (!isInsideDirectory(realOAuthPath, realRoot)) {
    throw new Error("OAuth file resolves outside profilesRoot.");
  }
}

async function ensureTargetGeminiDirectory(targetPath: string): Promise<void> {
  const targetDir = path.dirname(targetPath);
  const targetDirStat = await stat(targetDir).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  });
  if (targetDirStat && !targetDirStat.isDirectory()) {
    throw new Error(`Target Gemini directory is not a directory: ${targetDir}`);
  }

  await mkdir(targetDir, { recursive: true });
}

async function runTargetOperation<T>(targetOAuthPath: string, operation: () => Promise<T>): Promise<T> {
  const previousOperation = targetOperationQueues.get(targetOAuthPath) ?? Promise.resolve();
  const nextOperation = previousOperation.catch(() => undefined).then(operation);
  targetOperationQueues.set(targetOAuthPath, nextOperation);
  try {
    return await nextOperation;
  } finally {
    if (targetOperationQueues.get(targetOAuthPath) === nextOperation) {
      targetOperationQueues.delete(targetOAuthPath);
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
