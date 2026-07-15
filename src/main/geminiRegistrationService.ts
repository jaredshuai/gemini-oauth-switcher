import { rm } from "node:fs/promises";
import type { AppSettings, OAuthLoginSaveResult } from "../shared/types";
import { resolveOAuthIdentityFromFile, sanitizeOAuthProfileName } from "./oauthLoginService";
import { registerCurrentProfileSnapshot } from "./profileService";

interface RegisterCurrentGeminiAccountOptions {
  profilesRoot: string;
  targetOAuthPath: string;
  profileNicknames?: Record<string, string>;
  saveSettingsPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

export async function registerCurrentGeminiAccount(
  options: RegisterCurrentGeminiAccountOptions
): Promise<OAuthLoginSaveResult> {
  const registered = await registerCurrentProfileSnapshot({
    profilesRoot: options.profilesRoot,
    targetOAuthPath: options.targetOAuthPath,
    deriveProfile: async (snapshotPath, snapshotHash) => {
      const accountEmail = (await resolveOAuthIdentityFromFile(snapshotPath)).accountEmail;
      return {
        profileName: accountEmail
          ? sanitizeOAuthProfileName(accountEmail)
          : `gemini-account-${snapshotHash.slice(0, 8)}`,
        nickname: accountEmail,
        accountEmail
      };
    },
    onExistingProfile: async ({ profileFilePath, metadata }) => {
      const currentEmail = metadata.accountEmail?.trim().toLowerCase();
      const existingEmail = (await resolveOAuthIdentityFromFile(profileFilePath)).accountEmail?.trim().toLowerCase();
      if (!currentEmail || !existingEmail || currentEmail !== existingEmail) {
        throw new Error("同名账号目录已存在，但其中的账号身份不一致，已停止覆盖。");
      }
      return "replace";
    }
  });

  if (!registered.created) {
    return {
      sessionId: "current-gemini",
      targetTool: "gemini",
      profileName: registered.profileName,
      nickname: registered.nickname,
      profilePath: registered.profilePath,
      oauthPath: registered.targetPath,
      accountEmail: registered.accountEmail,
      sha256: registered.targetHash
    };
  }

  const nextNicknames = { ...(options.profileNicknames ?? {}) };
  if (registered.nickname && registered.nickname !== registered.profileName) {
    nextNicknames[registered.profileName] = registered.nickname;
  }
  try {
    await options.saveSettingsPatch({
      selectedTool: "gemini",
      lastSelectedProfile: registered.profileName,
      profileNicknames: nextNicknames
    });
  } catch (error) {
    try {
      await rm(registered.profilePath, { recursive: true, force: true });
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Gemini profile registration failed and rollback was incomplete.");
    }
    throw error;
  }

  return {
    sessionId: "current-gemini",
    targetTool: "gemini",
    profileName: registered.profileName,
    nickname: registered.nickname,
    profilePath: registered.profilePath,
    oauthPath: registered.targetPath,
    accountEmail: registered.accountEmail,
    sha256: registered.targetHash
  };
}
