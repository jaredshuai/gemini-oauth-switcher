import type { ProfileListResult, RevealTarget, TargetTool } from "../shared/types";

export const TOOL_LABELS: Record<
  TargetTool,
  {
    name: string;
    shortName: string;
    targetLabel: string;
    fileLabel: string;
    missingLabel: string;
    command: string;
    targetPathFallback: string;
    targetReveal: RevealTarget;
  }
> = {
  gemini: {
    name: "Gemini CLI",
    shortName: "Gemini",
    targetLabel: "目标 OAuth",
    fileLabel: "OAuth",
    missingLabel: "缺 OAuth",
    command: "gemini",
    targetPathFallback: "C:\\Users\\<current-user>\\.gemini\\oauth_creds.json",
    targetReveal: "targetGeminiDir"
  },
  "antigravity-cli": {
    name: "Antigravity CLI",
    shortName: "Antigravity",
    targetLabel: "目标凭据",
    fileLabel: "凭据",
    missingLabel: "缺凭据",
    command: "agy",
    targetPathFallback: "Windows Credential Manager: gemini:antigravity",
    targetReveal: "targetAntigravityCliDir"
  }
};

export const emptyResult: ProfileListResult = {
  profilesRoot: "",
  targetGeminiDir: "",
  targetOAuthPath: "",
  profiles: []
};
