import type { AppSettings, OAuthLoginSaveResult, ProfileListResult, TargetTool } from "../shared/types";

interface RefreshAfterOAuthLoginSaveOptions {
  saved: OAuthLoginSaveResult;
  getCurrentTool: () => TargetTool;
  getSettings: () => Promise<AppSettings>;
  applySettings: (settings: AppSettings) => void;
  loadProfiles: (
    targetTool: TargetTool,
    isRelevant: () => boolean
  ) => Promise<ProfileListResult | undefined>;
}

export type OAuthLoginPostSaveRefreshResult =
  | { status: "skipped" }
  | { status: "completed"; settingsLoaded: boolean; profilesLoaded: boolean };

export async function refreshAfterOAuthLoginSave(
  options: RefreshAfterOAuthLoginSaveOptions
): Promise<OAuthLoginPostSaveRefreshResult> {
  const savedTool = options.saved.targetTool ?? options.getCurrentTool();
  const isRelevant = () => options.getCurrentTool() === savedTool;
  let settingsLoaded = true;
  let nextSettings: AppSettings | undefined;
  try {
    nextSettings = await options.getSettings();
  } catch {
    settingsLoaded = false;
  }

  if (!isRelevant()) {
    return { status: "skipped" };
  }
  if (nextSettings) {
    options.applySettings(nextSettings);
  }

  const nextProfiles = await options.loadProfiles(savedTool, isRelevant);
  if (!isRelevant()) {
    return { status: "skipped" };
  }
  return {
    status: "completed",
    settingsLoaded,
    profilesLoaded: Boolean(nextProfiles)
  };
}
