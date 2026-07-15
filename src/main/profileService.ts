import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DeleteProfileResult, ProfileInfo, ProfileListResult, SwitchProfileResult } from "../shared/types";
import type { CredentialStore } from "./antigravityCredentialService";
import { hashCredentialPayload, writeVerifiedCredentialPayload } from "./antigravityCredentialService";

const GEMINI_DIR = ".gemini";
const OAUTH_FILE = "oauth_creds.json";
const DEFAULT_PROFILE_FILE_RELATIVE_PATH = path.join(GEMINI_DIR, OAUTH_FILE);
const PENDING_LOGIN_PREFIX = ".pending-login-";
const PENDING_REGISTER_PREFIX = ".pending-register-";
const targetOperationQueues = new Map<string, Promise<unknown>>();

export interface ListProfilesOptions {
  profilesRoot: string;
  targetOAuthPath: string;
  includeMissingProfiles?: boolean;
  profileFileRelativePath?: string;
  profileFileLabel?: string;
  targetDirectoryLabel?: string;
  credentialStore?: CredentialStore;
  credentialTarget?: string;
  getProfileCredentialTarget?: (profileName: string) => string;
}

export interface SwitchProfileOptions extends ListProfilesOptions {
  profileName: string;
  fileOperations?: Partial<SwitchFileOperations>;
}

export interface SwitchFileOperations {
  copyFile(sourcePath: string, targetPath: string): Promise<void>;
  rename(sourcePath: string, targetPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  readFile(filePath: string): Promise<Buffer>;
  writeFile(filePath: string, payload: Uint8Array): Promise<void>;
  hashFile(filePath: string): Promise<string>;
}

export interface DeleteProfileOptions extends ListProfilesOptions {
  profileName: string;
  removeDirectory?: (profilePath: string) => Promise<void>;
}

export interface ProfileRegistrationMetadata {
  profileName: string;
  nickname?: string;
  accountEmail?: string;
}

export interface ExistingProfileRegistrationContext {
  profileName: string;
  profilePath: string;
  profileFilePath: string;
  metadata: ProfileRegistrationMetadata;
}

export interface RegisterCurrentProfileSnapshotOptions {
  profilesRoot: string;
  targetOAuthPath: string;
  profileFileRelativePath?: string;
  profileFileLabel?: string;
  deriveProfile: (snapshotPath: string, sha256: string) => Promise<ProfileRegistrationMetadata>;
  onExistingProfile?: (
    context: ExistingProfileRegistrationContext
  ) => Promise<"reject" | "replace">;
  fileOperations?: Partial<SwitchFileOperations>;
}

export interface RegisterCurrentProfileSnapshotResult extends SwitchProfileResult, ProfileRegistrationMetadata {
  profilePath: string;
  created: boolean;
}

export interface CleanupStaleProfileRegistrationsOptions {
  profilesRoot: string;
  olderThanMs?: number;
  nowMs?: () => number;
  removeDirectory?: (profilePath: string) => Promise<void>;
}

export interface CleanupStaleProfileRegistrationsResult {
  removed: string[];
  failed: string[];
  skipped: string[];
}

export function getProfileOAuthPath(profilesRoot: string, profileName: string): string {
  return getProfileFilePath(profilesRoot, profileName);
}

export function getProfileAntigravityCliSettingsPath(profilesRoot: string, profileName: string): string {
  return getProfileFilePath(profilesRoot, profileName, path.join(GEMINI_DIR, "antigravity-cli", "settings.json"));
}

export function getProfileFilePath(
  profilesRoot: string,
  profileName: string,
  profileFileRelativePath = DEFAULT_PROFILE_FILE_RELATIVE_PATH
): string {
  return path.join(profilesRoot, profileName, normalizeProfileFileRelativePath(profileFileRelativePath));
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
  const resolvedTargetOAuthPath = path.resolve(options.targetOAuthPath);
  const targetGeminiDir = path.dirname(resolvedTargetOAuthPath);
  const credentialMode = getCredentialMode(options);
  const targetOAuthPath = credentialMode?.target ?? resolvedTargetOAuthPath;
  const targetCredentialPayload = credentialMode ? await credentialMode.store.get(credentialMode.target) : undefined;
  const targetHash = credentialMode
    ? targetCredentialPayload
      ? hashCredentialPayload(targetCredentialPayload)
      : undefined
    : (await fileExists(resolvedTargetOAuthPath))
      ? await hashFile(resolvedTargetOAuthPath)
      : undefined;
  const profileFileRelativePath = normalizeProfileFileRelativePath(options.profileFileRelativePath);

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
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(PENDING_LOGIN_PREFIX) && !entry.name.startsWith(PENDING_REGISTER_PREFIX))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map(async (entry): Promise<ProfileInfo> => {
        const profilePath = path.join(profilesRoot, entry.name);
        if (credentialMode) {
          const profileCredentialTarget = credentialMode.getProfileTarget(entry.name);
          const profileCredentialPayload = await credentialMode.store.get(profileCredentialTarget);
          if (!profileCredentialPayload) {
            return {
              name: entry.name,
              profilePath,
              oauthPath: profileCredentialTarget,
              exists: false,
              isCurrent: false
            };
          }

          const profileStat = await stat(profilePath);
          const sha256 = hashCredentialPayload(profileCredentialPayload);
          return {
            name: entry.name,
            profilePath,
            oauthPath: profileCredentialTarget,
            exists: true,
            updatedAt: profileStat.mtime.toISOString(),
            updatedAtMs: profileStat.mtimeMs,
            sha256,
            shortHash: sha256.slice(0, 8),
            isCurrent: Boolean(targetHash && sha256 === targetHash)
          };
        }

        const oauthPath = getProfileFilePath(profilesRoot, entry.name, profileFileRelativePath);
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
  const visibleProfiles = options.includeMissingProfiles === false
    ? profiles.filter((profile) => profile.exists)
    : profiles;

  return {
    profilesRoot,
    targetGeminiDir,
    targetOAuthPath,
    targetHash,
    profiles: visibleProfiles
  };
}

export async function switchProfile(options: SwitchProfileOptions): Promise<SwitchProfileResult> {
  const credentialMode = getCredentialMode(options);
  return runTargetOperation(credentialMode?.target ?? path.resolve(options.targetOAuthPath), () => switchProfileUnlocked(options));
}

export async function registerCurrentProfileSnapshot(
  options: RegisterCurrentProfileSnapshotOptions
): Promise<RegisterCurrentProfileSnapshotResult> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const operationKey = path.join(profilesRoot, `${PENDING_REGISTER_PREFIX}queue`);
  return runTargetOperation(operationKey, () => registerCurrentProfileSnapshotUnlocked({ ...options, profilesRoot }));
}

async function registerCurrentProfileSnapshotUnlocked(
  options: RegisterCurrentProfileSnapshotOptions
): Promise<RegisterCurrentProfileSnapshotResult> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const sourcePath = path.resolve(options.targetOAuthPath);
  const profileFileRelativePath = normalizeProfileFileRelativePath(options.profileFileRelativePath);
  const profileFileLabel = options.profileFileLabel ?? "OAuth file";

  if (!(await fileExists(sourcePath))) {
    throw new Error(`Current ${profileFileLabel} does not exist`);
  }

  await mkdir(profilesRoot, { recursive: true });
  const pendingProfilePath = path.join(profilesRoot, `${PENDING_REGISTER_PREFIX}${randomUUID()}`);
  const pendingTargetPath = path.join(pendingProfilePath, profileFileRelativePath);
  try {
    const sourceHashBefore = await hashFile(sourcePath);
    await mkdir(path.dirname(pendingTargetPath), { recursive: true });
    await copyFile(sourcePath, pendingTargetPath);
    const [sourceHashAfter, snapshotHash] = await Promise.all([
      hashFile(sourcePath),
      hashFile(pendingTargetPath)
    ]);
    if (sourceHashBefore !== sourceHashAfter || snapshotHash !== sourceHashAfter) {
      throw new Error(`Current ${profileFileLabel} changed while it was being registered. Try again.`);
    }

    const metadata = await options.deriveProfile(pendingTargetPath, snapshotHash);
    const profileName = validateProfileName(metadata.profileName);
    const profilePath = path.resolve(profilesRoot, profileName);
    if (!isInsideDirectory(profilePath, profilesRoot)) {
      throw new Error("Invalid profile name: profile must be a direct child of profilesRoot");
    }
    const existingProfile = await lstat(profilePath).catch((error: unknown) => {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    });
    if (existingProfile) {
      if (!existingProfile.isDirectory()) {
        throw new Error(`Profile path is not a directory: ${profileName}`);
      }
      await assertProfileDirectoryIsSafe(profilesRoot, profilePath);
      const existingProfileFilePath = path.join(profilePath, profileFileRelativePath);
      if (!(await fileExists(existingProfileFilePath))) {
        throw new Error(`${profileFileLabel} does not exist for profile: ${profileName}`);
      }
      await assertProfileFileIsSafe(profilesRoot, existingProfileFilePath, profileFileLabel);
      const action = await options.onExistingProfile?.({
        profileName,
        profilePath,
        profileFilePath: existingProfileFilePath,
        metadata
      });
      if (action !== "replace") {
        throw new Error(`Profile already exists: ${profileName}`);
      }

      const targetHash = await replaceFileVerified({
        sourcePath: pendingTargetPath,
        sourceHash: snapshotHash,
        targetPath: existingProfileFilePath,
        temporaryHashErrorMessage: `Temporary ${profileFileLabel} hash does not match current account`,
        targetHashErrorMessage: `Updated ${profileFileLabel} hash does not match current account`,
        rollbackErrorMessage: `Failed to update ${profileFileLabel} and rollback was incomplete.`,
        fileOperations: options.fileOperations
      });
      await rm(pendingProfilePath, { recursive: true, force: true }).catch(() => undefined);
      return {
        ...metadata,
        profileName,
        profilePath,
        sourcePath,
        targetPath: existingProfileFilePath,
        sourceHash: snapshotHash,
        targetHash,
        created: false
      };
    }

    await assertNoDuplicateProfileHash(profilesRoot, profileFileRelativePath, snapshotHash);
    await rename(pendingProfilePath, profilePath);
    const targetPath = path.join(profilePath, profileFileRelativePath);
    return {
      ...metadata,
      profileName,
      profilePath,
      sourcePath,
      targetPath,
      sourceHash: snapshotHash,
      targetHash: snapshotHash,
      created: true
    };
  } catch (error) {
    await rm(pendingProfilePath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

interface ReplaceFileVerifiedOptions {
  sourcePath: string;
  sourceHash: string;
  targetPath: string;
  temporaryHashErrorMessage: string;
  targetHashErrorMessage: string;
  rollbackErrorMessage: string;
  fileOperations?: Partial<SwitchFileOperations>;
}

async function replaceFileVerified(options: ReplaceFileVerifiedOptions): Promise<string> {
  await mkdir(path.dirname(options.targetPath), { recursive: true });
  const fileOperations: SwitchFileOperations = {
    copyFile,
    rename,
    unlink,
    readFile,
    writeFile: (filePath, payload) => writeFile(filePath, payload),
    hashFile,
    ...options.fileOperations
  };
  const previousPayload = (await fileExists(options.targetPath))
    ? await fileOperations.readFile(options.targetPath)
    : undefined;
  const tempPath = `${options.targetPath}.${process.pid}.${randomUUID()}.tmp`;
  let targetReplaced = false;

  try {
    await fileOperations.copyFile(options.sourcePath, tempPath);
    const tempHash = await fileOperations.hashFile(tempPath);
    if (tempHash !== options.sourceHash) {
      throw new Error(options.temporaryHashErrorMessage);
    }

    await fileOperations.rename(tempPath, options.targetPath);
    targetReplaced = true;
    const targetHash = await fileOperations.hashFile(options.targetPath);
    if (targetHash !== options.sourceHash) {
      throw new Error(options.targetHashErrorMessage);
    }
    return targetHash;
  } catch (error) {
    await fileOperations.unlink(tempPath).catch(() => undefined);
    if (targetReplaced) {
      try {
        await restoreTargetFile(options.targetPath, previousPayload, fileOperations);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          options.rollbackErrorMessage
        );
      }
    }
    throw error;
  }
}

export async function cleanupStaleProfileRegistrations(
  options: CleanupStaleProfileRegistrationsOptions
): Promise<CleanupStaleProfileRegistrationsResult> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const olderThanMs = options.olderThanMs ?? 24 * 60 * 60 * 1000;
  const nowMs = options.nowMs ?? Date.now;
  const removeDirectory = options.removeDirectory ?? ((profilePath: string) => rm(profilePath, { recursive: true, force: true }));
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
  const entries = (await readdir(profilesRoot, { withFileTypes: true }))
    .filter((entry) => entry.name.startsWith(PENDING_REGISTER_PREFIX));
  const results = await Promise.allSettled(entries.map(async (entry) => {
    const entryPath = path.join(profilesRoot, entry.name);
    const entryStat = await lstat(entryPath).catch((error: unknown) => {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    });
    if (!entryStat || nowMs() - entryStat.mtimeMs < olderThanMs) {
      return;
    }
    if (!entryStat.isDirectory() || entryStat.isSymbolicLink() || !(await isSafeDirectChildDirectory(profilesRoot, entryPath))) {
      skipped.push(entry.name);
      return;
    }
    await removeDirectory(entryPath);
    removed.push(entry.name);
  }));
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      failed.push(entries[index]?.name ?? "unknown");
    }
  }

  for (const values of [removed, failed, skipped]) {
    values.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }
  return { removed, failed, skipped };
}

async function switchProfileUnlocked(options: SwitchProfileOptions): Promise<SwitchProfileResult> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const targetPath = path.resolve(options.targetOAuthPath);
  const profileName = validateProfileName(options.profileName);
  const profilePath = path.resolve(profilesRoot, profileName);
  const sourcePath = path.resolve(getProfileFilePath(profilesRoot, profileName, options.profileFileRelativePath));
  const profileFileLabel = options.profileFileLabel ?? "OAuth file";
  const credentialMode = getCredentialMode(options);

  if (!isInsideDirectory(credentialMode ? profilePath : sourcePath, profilesRoot)) {
    throw new Error("Invalid profile name: profile must be a direct child of profilesRoot");
  }
  await assertProfileDirectoryIsSafe(profilesRoot, profilePath);

  if (credentialMode) {
    const profileCredentialTarget = credentialMode.getProfileTarget(profileName);
    const sourcePayload = await credentialMode.store.get(profileCredentialTarget);
    if (!sourcePayload) {
      throw new Error(`${profileFileLabel} does not exist for profile: ${profileName}`);
    }

    const { sourceHash, targetHash } = await writeVerifiedCredentialPayload({
      store: credentialMode.store,
      target: credentialMode.target,
      payload: sourcePayload,
      verificationErrorMessage: `Target ${profileFileLabel} hash does not match selected profile after switch`
    });

    return {
      profileName,
      sourcePath: profileCredentialTarget,
      targetPath: credentialMode.target,
      sourceHash,
      targetHash
    };
  }

  if (!(await fileExists(sourcePath))) {
    throw new Error(`${profileFileLabel} does not exist for profile: ${profileName}`);
  }
  await assertProfileFileIsSafe(profilesRoot, sourcePath, profileFileLabel);

  const sourceHash = await hashFile(sourcePath);
  await ensureTargetDirectory(targetPath, options.targetDirectoryLabel ?? "Target Gemini directory");

  const targetHash = await replaceFileVerified({
    sourcePath,
    sourceHash,
    targetPath,
    temporaryHashErrorMessage: `Temporary ${profileFileLabel} hash does not match selected profile`,
    targetHashErrorMessage: `Target ${profileFileLabel} hash does not match selected profile after switch`,
    rollbackErrorMessage: `Failed to switch ${profileFileLabel} and rollback was incomplete.`,
    fileOperations: options.fileOperations
  });

  return {
    profileName,
    sourcePath,
    targetPath,
    sourceHash,
    targetHash
  };
}

async function restoreTargetFile(
  targetPath: string,
  previousPayload: Buffer | undefined,
  operations: SwitchFileOperations
): Promise<void> {
  if (previousPayload === undefined) {
    await operations.unlink(targetPath).catch((error: unknown) => {
      if (!isNotFoundError(error)) {
        throw error;
      }
    });
    if (await fileExists(targetPath)) {
      throw new Error("Target OAuth rollback verification failed.");
    }
    return;
  }

  const rollbackPath = `${targetPath}.${process.pid}.${randomUUID()}.rollback.tmp`;
  try {
    await operations.writeFile(rollbackPath, previousPayload);
    await operations.rename(rollbackPath, targetPath);
    const restoredPayload = await operations.readFile(targetPath);
    if (!restoredPayload.equals(previousPayload)) {
      throw new Error("Target OAuth rollback verification failed.");
    }
  } finally {
    await operations.unlink(rollbackPath).catch(() => undefined);
  }
}

export async function deleteProfile(options: DeleteProfileOptions): Promise<DeleteProfileResult> {
  return runTargetOperation(path.resolve(options.targetOAuthPath), () => deleteProfileUnlocked(options));
}

async function deleteProfileUnlocked(options: DeleteProfileOptions): Promise<DeleteProfileResult> {
  const profilesRoot = path.resolve(options.profilesRoot);
  const targetOAuthPath = path.resolve(options.targetOAuthPath);
  const profileName = validateProfileName(options.profileName);
  const profilePath = path.resolve(profilesRoot, profileName);
  const profileFileLabel = options.profileFileLabel ?? "OAuth file";

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

  const sourcePath = path.resolve(getProfileFilePath(profilesRoot, profileName, options.profileFileRelativePath));
  if (!(await fileExists(sourcePath))) {
    throw new Error(`${profileFileLabel} does not exist for profile: ${profileName}`);
  }
  await assertProfileFileIsSafe(profilesRoot, sourcePath, profileFileLabel);

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

function normalizeProfileFileRelativePath(profileFileRelativePath = DEFAULT_PROFILE_FILE_RELATIVE_PATH): string {
  const normalized = path.normalize(profileFileRelativePath);
  if (
    !normalized ||
    normalized === "." ||
    path.isAbsolute(normalized) ||
    normalized.split(/[\\/]+/u).includes("..") ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Invalid profile file path: path must stay inside each profile directory");
  }

  return normalized;
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

async function assertProfileFileIsSafe(profilesRoot: string, profileFilePath: string, profileFileLabel: string): Promise<void> {
  const profileFileLinkStat = await lstat(profileFilePath);
  if (profileFileLinkStat.isSymbolicLink()) {
    throw new Error(`${profileFileLabel} must not be a symbolic link or junction.`);
  }

  const [realRoot, realProfileFilePath] = await Promise.all([realpath(profilesRoot), realpath(profileFilePath)]);
  if (!isInsideDirectory(realProfileFilePath, realRoot)) {
    throw new Error(`${profileFileLabel} resolves outside profilesRoot.`);
  }
}

async function assertNoDuplicateProfileHash(
  profilesRoot: string,
  profileFileRelativePath: string,
  snapshotHash: string
): Promise<void> {
  const entries = await readdir(profilesRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(PENDING_LOGIN_PREFIX) || entry.name.startsWith(PENDING_REGISTER_PREFIX)) {
      continue;
    }
    const profilePath = path.join(profilesRoot, entry.name);
    await assertProfileDirectoryIsSafe(profilesRoot, profilePath);
    const profileFilePath = path.join(profilePath, profileFileRelativePath);
    if (!(await fileExists(profileFilePath))) {
      continue;
    }
    await assertProfileFileIsSafe(profilesRoot, profileFilePath, "Profile OAuth file");
    if (await hashFile(profileFilePath) === snapshotHash) {
      throw new Error(`Profile already exists: ${entry.name}`);
    }
  }
}

async function isSafeDirectChildDirectory(profilesRoot: string, entryPath: string): Promise<boolean> {
  try {
    const [realRoot, realEntryPath] = await Promise.all([realpath(profilesRoot), realpath(entryPath)]);
    return isInsideDirectory(realEntryPath, realRoot);
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function ensureTargetDirectory(targetPath: string, targetDirectoryLabel: string): Promise<void> {
  const targetDir = path.dirname(targetPath);
  const targetDirStat = await stat(targetDir).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  });
  if (targetDirStat && !targetDirStat.isDirectory()) {
    throw new Error(`${targetDirectoryLabel} is not a directory: ${targetDir}`);
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

function getCredentialMode(options: ListProfilesOptions):
  | {
      store: CredentialStore;
      target: string;
      getProfileTarget: (profileName: string) => string;
    }
  | undefined {
  if (!options.credentialStore || !options.credentialTarget || !options.getProfileCredentialTarget) {
    return undefined;
  }

  return {
    store: options.credentialStore,
    target: options.credentialTarget,
    getProfileTarget: options.getProfileCredentialTarget
  };
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
