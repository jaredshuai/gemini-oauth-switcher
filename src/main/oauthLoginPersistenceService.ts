import { rename } from "node:fs/promises";
import type { OAuthLoginSaveResult } from "../shared/types";
import { saveOAuthLoginSession } from "./oauthLoginService";

interface SaveGeminiOAuthLoginWithSettingsOptions {
  profilesRoot: string;
  sessionId: string;
  pendingProfilePath: string;
  profileName?: string;
  nickname?: string;
  persistResult: (result: OAuthLoginSaveResult) => Promise<void>;
  restorePendingDirectory?: (profilePath: string, pendingProfilePath: string) => Promise<void>;
}

export async function saveGeminiOAuthLoginWithSettings(
  options: SaveGeminiOAuthLoginWithSettingsOptions
): Promise<OAuthLoginSaveResult> {
  const result = await saveOAuthLoginSession({
    profilesRoot: options.profilesRoot,
    sessionId: options.sessionId,
    pendingProfilePath: options.pendingProfilePath,
    targetTool: "gemini",
    profileName: options.profileName,
    nickname: options.nickname
  });

  try {
    await options.persistResult(result);
  } catch (error) {
    try {
      await (options.restorePendingDirectory ?? rename)(result.profilePath, options.pendingProfilePath);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Gemini OAuth login was saved but settings persistence and directory rollback both failed."
      );
    }
    throw error;
  }

  return result;
}
