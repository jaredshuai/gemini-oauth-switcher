import os from "node:os";
import path from "node:path";

export function getDefaultProfilesRoot(): string {
  return path.join(os.homedir(), ".gemini-homes");
}

export function getDefaultTargetGeminiDir(): string {
  return path.join(os.homedir(), ".gemini");
}

export function getDefaultTargetOAuthPath(): string {
  return path.join(getDefaultTargetGeminiDir(), "oauth_creds.json");
}

export function getDefaultTargetAntigravityCliDir(): string {
  return path.join(getDefaultTargetGeminiDir(), "antigravity-cli");
}

export function getDefaultTargetAntigravityCliSettingsPath(): string {
  return path.join(getDefaultTargetAntigravityCliDir(), "settings.json");
}

export function getSettingsPath(userDataPath: string): string {
  return path.join(userDataPath, "settings.json");
}
