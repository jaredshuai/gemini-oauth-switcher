import { describe, expect, it, vi } from "vitest";
import type { AppSettings, OAuthLoginSaveResult, ProfileListResult, TargetTool } from "../src/shared/types";
import { refreshAfterOAuthLoginSave } from "../src/renderer/oauthLoginPostSave";

const savedGeminiLogin: OAuthLoginSaveResult = {
  sessionId: "saved-session",
  targetTool: "gemini",
  profileName: "saved-profile",
  profilePath: "C:\\profiles\\saved-profile",
  oauthPath: "C:\\profiles\\saved-profile\\.gemini\\oauth_creds.json",
  sha256: "a".repeat(64)
};

const settings: AppSettings = { profilesRoot: "C:\\profiles", selectedTool: "gemini" };
const profiles: ProfileListResult = {
  profilesRoot: "C:\\profiles",
  targetGeminiDir: "C:\\Users\\tester\\.gemini",
  targetOAuthPath: "C:\\Users\\tester\\.gemini\\oauth_creds.json",
  profiles: []
};

describe("OAuth login post-save refresh", () => {
  it("does not start an old-tool refresh after the user switches tools", async () => {
    let currentTool: TargetTool = "gemini";
    let resolveSettings: ((value: AppSettings) => void) | undefined;
    const settingsPromise = new Promise<AppSettings>((resolve) => {
      resolveSettings = resolve;
    });
    const loadProfiles = vi.fn(async () => profiles);
    const applySettings = vi.fn();

    const refreshPromise = refreshAfterOAuthLoginSave({
      saved: savedGeminiLogin,
      getCurrentTool: () => currentTool,
      getSettings: () => settingsPromise,
      applySettings,
      loadProfiles
    });
    currentTool = "antigravity-cli";
    resolveSettings?.(settings);

    await expect(refreshPromise).resolves.toEqual({ status: "skipped" });
    expect(applySettings).not.toHaveBeenCalled();
    expect(loadProfiles).not.toHaveBeenCalled();
  });

  it("refreshes only the saved tool and supplies a live relevance guard", async () => {
    let currentTool: TargetTool = "gemini";
    const loadProfiles = vi.fn(async (_tool: TargetTool, isRelevant: () => boolean) => {
      expect(isRelevant()).toBe(true);
      currentTool = "antigravity-cli";
      expect(isRelevant()).toBe(false);
      return undefined;
    });

    await expect(refreshAfterOAuthLoginSave({
      saved: savedGeminiLogin,
      getCurrentTool: () => currentTool,
      getSettings: async () => settings,
      applySettings: vi.fn(),
      loadProfiles
    })).resolves.toEqual({ status: "skipped" });
    expect(loadProfiles).toHaveBeenCalledWith("gemini", expect.any(Function));
  });
});
