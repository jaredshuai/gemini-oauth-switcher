import path from "node:path";
import type { TargetTool } from "../shared/types";
import {
  ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET,
  getAntigravityProfileCredentialTarget
} from "./antigravityCredentialService";
import {
  getDefaultTargetAntigravityCliDir,
  getDefaultTargetAntigravityCliSettingsPath,
  getDefaultTargetGeminiDir,
  getDefaultTargetOAuthPath
} from "./paths";

export interface ProfileTargetConfig {
  tool: TargetTool;
  profileFileRelativePath: string;
  targetPath: string;
  targetDir: string;
  profileFileLabel: string;
  targetDirectoryLabel: string;
  credentialTarget?: string;
  getProfileCredentialTarget?: (profileId: string) => string;
}

export function normalizeTargetTool(value: unknown): TargetTool {
  return value === "antigravity-cli" ? "antigravity-cli" : "gemini";
}

export function getProfileTargetConfig(value: unknown): ProfileTargetConfig {
  const tool = normalizeTargetTool(value);
  if (tool === "antigravity-cli") {
    return {
      tool,
      profileFileRelativePath: path.join(".gemini", "antigravity-cli", "settings.json"),
      targetPath: getDefaultTargetAntigravityCliSettingsPath(),
      targetDir: getDefaultTargetAntigravityCliDir(),
      profileFileLabel: "Antigravity CLI credential",
      targetDirectoryLabel: "Target Antigravity CLI directory",
      credentialTarget: ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET,
      getProfileCredentialTarget: getAntigravityProfileCredentialTarget
    };
  }

  return {
    tool,
    profileFileRelativePath: path.join(".gemini", "oauth_creds.json"),
    targetPath: getDefaultTargetOAuthPath(),
    targetDir: getDefaultTargetGeminiDir(),
    profileFileLabel: "OAuth file",
    targetDirectoryLabel: "Target Gemini directory"
  };
}
