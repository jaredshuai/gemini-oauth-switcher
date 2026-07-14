import { ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET, getAntigravityProfileCredentialTarget, hashCredentialIdentity, hashCredentialPayload, writeVerifiedCredentialPayload, type CredentialStore } from "./antigravityCredentialService";
import { getDefaultTargetAntigravityCliDir } from "./paths";
import type { AntigravityProfileRecord, ProfileInfo, ProfileListResult, SwitchProfileResult } from "../shared/types";
export type { AntigravityProfileRecord } from "../shared/types";

interface AntigravityProfileOptions {
  profiles: AntigravityProfileRecord[];
  credentialStore: CredentialStore;
  credentialTarget?: string;
}

interface SelectAntigravityProfileOptions extends AntigravityProfileOptions {
  profileId: string;
  persistProfiles?: (profiles: AntigravityProfileRecord[]) => Promise<void>;
}

interface RegisterAntigravityProfileOptions extends AntigravityProfileOptions {
  profileId: string;
  name: string;
  accountEmail?: string;
  now?: () => number;
}

interface ResolveCurrentAntigravityProfileIdentityOptions extends AntigravityProfileOptions {
  resolveIdentity: (payload: string) => Promise<{ accountEmail?: string }>;
  now?: () => number;
}

export interface ResolveCurrentAntigravityProfileIdentityResult {
  profiles: AntigravityProfileRecord[];
  changed: boolean;
}

const credentialOperationQueues = new Map<string, Promise<unknown>>();

export async function listAntigravityProfiles(options: AntigravityProfileOptions): Promise<ProfileListResult> {
  const credentialTarget = options.credentialTarget ?? ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET;
  const targetPayload = await options.credentialStore.get(credentialTarget);
  const targetHash = targetPayload ? hashCredentialPayload(targetPayload) : undefined;
  const targetIdentity = targetPayload ? hashCredentialIdentity(targetPayload) : undefined;
  const profiles = await Promise.all(
    options.profiles
      .map(sanitizeRecord)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
      .map(async (record): Promise<ProfileInfo> => {
        const profileTarget = getAntigravityProfileCredentialTarget(record.id);
        const payload = await options.credentialStore.get(profileTarget);
        const payloadIdentity = payload ? hashCredentialIdentity(payload) : undefined;
        const isCurrent = Boolean(targetIdentity && payloadIdentity === targetIdentity);
        if (isCurrent && targetPayload && payload !== targetPayload) {
          await options.credentialStore.set(profileTarget, targetPayload);
        }
        const sha256 = isCurrent && targetHash ? targetHash : payload ? hashCredentialPayload(payload) : undefined;
        return {
          id: record.id,
          name: record.name,
          accountEmail: record.accountEmail,
          profilePath: "",
          oauthPath: "",
          exists: Boolean(payload),
          updatedAt: new Date(record.updatedAt).toISOString(),
          updatedAtMs: record.updatedAt,
          sha256,
          shortHash: sha256?.slice(0, 8),
          isCurrent
        };
      })
  );

  return {
    profilesRoot: "",
    targetGeminiDir: getDefaultTargetAntigravityCliDir(),
    targetOAuthPath: credentialTarget,
    targetHash,
    profiles
  };
}

export async function resolveCurrentAntigravityProfileIdentity(
  options: ResolveCurrentAntigravityProfileIdentityOptions
): Promise<ResolveCurrentAntigravityProfileIdentityResult> {
  const profiles = options.profiles.map(sanitizeRecord);
  if (profiles.every((profile) => profile.accountEmail)) {
    return { profiles, changed: false };
  }

  const credentialTarget = options.credentialTarget ?? ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET;
  const targetPayload = await options.credentialStore.get(credentialTarget);
  if (!targetPayload) {
    return { profiles, changed: false };
  }

  const targetIdentity = hashCredentialIdentity(targetPayload);
  for (const profile of profiles) {
    if (profile.accountEmail) {
      continue;
    }

    const profilePayload = await options.credentialStore.get(getAntigravityProfileCredentialTarget(profile.id));
    if (!profilePayload || hashCredentialIdentity(profilePayload) !== targetIdentity) {
      continue;
    }

    const accountEmail = normalizeOptionalEmail((await options.resolveIdentity(targetPayload)).accountEmail);
    if (!accountEmail) {
      return { profiles, changed: false };
    }

    const updatedAt = Math.round(options.now?.() ?? Date.now());
    return {
      changed: true,
      profiles: profiles.map((candidate) =>
        candidate.id === profile.id
          ? { ...candidate, accountEmail, updatedAt }
          : candidate
      )
    };
  }

  return { profiles, changed: false };
}

export async function switchAntigravityProfile(options: SelectAntigravityProfileOptions): Promise<SwitchProfileResult> {
  const credentialTarget = options.credentialTarget ?? ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET;
  return runCredentialOperation(credentialTarget, async () => {
    const profile = findProfile(options.profiles, options.profileId);
    const sourceTarget = getAntigravityProfileCredentialTarget(profile.id);
    const sourcePayload = await options.credentialStore.get(sourceTarget);
    if (!sourcePayload) {
      throw new Error(`Antigravity CLI credential does not exist for profile: ${profile.name}`);
    }

    const { sourceHash, targetHash } = await writeVerifiedCredentialPayload({
      store: options.credentialStore,
      target: credentialTarget,
      payload: sourcePayload,
      verificationErrorMessage: "Target Antigravity CLI credential hash does not match selected profile after switch"
    });

    return {
      profileName: profile.name,
      sourcePath: sourceTarget,
      targetPath: credentialTarget,
      sourceHash,
      targetHash
    };
  });
}

export async function registerCurrentAntigravityProfile(options: RegisterAntigravityProfileOptions): Promise<{
  profile: AntigravityProfileRecord;
  profiles: AntigravityProfileRecord[];
  sourceHash: string;
  targetHash: string;
}> {
  const credentialTarget = options.credentialTarget ?? ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET;
  return runCredentialOperation(credentialTarget, async () => {
    const profileId = validateProfileId(options.profileId);
    const name = validateProfileName(options.name);
    const accountEmail = normalizeOptionalEmail(options.accountEmail);
    assertNoDuplicate(options.profiles, profileId, name, accountEmail);

    const officialPayload = await options.credentialStore.get(credentialTarget);
    if (!officialPayload) {
      throw new Error("Antigravity CLI official credential was not found. Complete login first.");
    }

    const sourceHash = hashCredentialPayload(officialPayload);
    const officialIdentity = hashCredentialIdentity(officialPayload);
    const duplicateCredentialProfiles = await Promise.all(
      options.profiles.map(async (profile) => ({
        profile: sanitizeRecord(profile),
        payload: await options.credentialStore.get(getAntigravityProfileCredentialTarget(profile.id))
      }))
    );
    const duplicateCredential = duplicateCredentialProfiles.find(
      ({ payload }) => payload && hashCredentialIdentity(payload) === officialIdentity
    );
    if (duplicateCredential) {
      throw new Error(`Antigravity profile already exists: ${duplicateCredential.profile.name}`);
    }
    const profileTarget = getAntigravityProfileCredentialTarget(profileId);
    await options.credentialStore.set(profileTarget, officialPayload);
    const savedPayload = await options.credentialStore.get(profileTarget);
    const targetHash = savedPayload ? hashCredentialPayload(savedPayload) : undefined;
    if (targetHash !== sourceHash) {
      await options.credentialStore.delete(profileTarget).catch(() => undefined);
      throw new Error("Saved Antigravity CLI credential hash does not match the official credential");
    }

    const now = Math.max(1, Math.round(options.now?.() ?? Date.now()));
    const profile: AntigravityProfileRecord = {
      id: profileId,
      name,
      ...(accountEmail ? { accountEmail } : {}),
      createdAt: now,
      updatedAt: now
    };

    return {
      profile,
      profiles: [...options.profiles.map(sanitizeRecord), profile],
      sourceHash,
      targetHash
    };
  });
}

export async function deleteAntigravityProfile(options: SelectAntigravityProfileOptions): Promise<{
  profile: AntigravityProfileRecord;
  profiles: AntigravityProfileRecord[];
}> {
  const credentialTarget = options.credentialTarget ?? ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET;
  return runCredentialOperation(credentialTarget, async () => {
    const profile = findProfile(options.profiles, options.profileId);
    const profileTarget = getAntigravityProfileCredentialTarget(profile.id);
    const [profilePayload, targetPayload] = await Promise.all([
      options.credentialStore.get(profileTarget),
      options.credentialStore.get(credentialTarget)
    ]);
    if (profilePayload && targetPayload && hashCredentialIdentity(profilePayload) === hashCredentialIdentity(targetPayload)) {
      throw new Error("Cannot delete the current profile. Switch to another account first.");
    }

    const remainingProfiles = options.profiles
      .filter((candidate) => candidate.id !== profile.id)
      .map(sanitizeRecord);
    await options.credentialStore.delete(profileTarget);
    try {
      await options.persistProfiles?.(remainingProfiles);
    } catch (error) {
      if (profilePayload) {
        try {
          await writeVerifiedCredentialPayload({
            store: options.credentialStore,
            target: profileTarget,
            payload: profilePayload,
            verificationErrorMessage: "Restored Antigravity profile credential hash does not match the deleted credential"
          });
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Antigravity profile deletion failed and credential rollback was incomplete."
          );
        }
      }
      throw error;
    }
    return {
      profile,
      profiles: remainingProfiles
    };
  });
}

function findProfile(profiles: AntigravityProfileRecord[], profileId: string): AntigravityProfileRecord {
  const id = validateProfileId(profileId);
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) {
    throw new Error(`Antigravity profile does not exist: ${id}`);
  }
  return sanitizeRecord(profile);
}

function sanitizeRecord(record: AntigravityProfileRecord): AntigravityProfileRecord {
  const id = validateProfileId(record.id);
  const name = validateProfileName(record.name);
  const accountEmail = normalizeOptionalEmail(record.accountEmail);
  const createdAt = sanitizeTimestamp(record.createdAt);
  const updatedAt = sanitizeTimestamp(record.updatedAt);
  return {
    id,
    name,
    ...(accountEmail ? { accountEmail } : {}),
    createdAt,
    updatedAt
  };
}

function validateProfileId(value: string): string {
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(trimmed)) {
    throw new Error("Invalid Antigravity profile id");
  }
  return trimmed;
}

function validateProfileName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160 || /[\u0000-\u001F]/u.test(trimmed)) {
    throw new Error("Invalid Antigravity profile name");
  }
  return trimmed;
}

function normalizeOptionalEmail(value?: string): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || undefined;
}

function sanitizeTimestamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid Antigravity profile timestamp");
  }
  return Math.round(value);
}

function assertNoDuplicate(
  profiles: AntigravityProfileRecord[],
  profileId: string,
  name: string,
  accountEmail?: string
): void {
  const normalizedName = name.toLowerCase();
  const duplicate = profiles.map(sanitizeRecord).find((profile) =>
    profile.id === profileId ||
    profile.name.toLowerCase() === normalizedName ||
    Boolean(accountEmail && profile.accountEmail?.toLowerCase() === accountEmail)
  );
  if (duplicate) {
    throw new Error(`Antigravity profile already exists: ${duplicate.name}`);
  }
}

async function runCredentialOperation<T>(target: string, operation: () => Promise<T>): Promise<T> {
  const previous = credentialOperationQueues.get(target) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  credentialOperationQueues.set(target, current);
  try {
    return await current;
  } finally {
    if (credentialOperationQueues.get(target) === current) {
      credentialOperationQueues.delete(target);
    }
  }
}
