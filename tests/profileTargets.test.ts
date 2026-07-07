import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getProfileTargetConfig, normalizeTargetTool } from "../src/main/profileTargets";

describe("profileTargets", () => {
  it("uses Gemini OAuth as the default target", () => {
    const target = getProfileTargetConfig(undefined);

    expect(target.tool).toBe("gemini");
    expect(target.profileFileRelativePath).toBe(path.join(".gemini", "oauth_creds.json"));
    expect(target.targetPath).toBe(path.join(homedir(), ".gemini", "oauth_creds.json"));
    expect(target.targetDir).toBe(path.join(homedir(), ".gemini"));
  });

  it("maps Antigravity CLI to the official settings path", () => {
    const target = getProfileTargetConfig("antigravity-cli");

    expect(target.tool).toBe("antigravity-cli");
    expect(target.profileFileRelativePath).toBe(path.join(".gemini", "antigravity-cli", "settings.json"));
    expect(target.targetPath).toBe(path.join(homedir(), ".gemini", "antigravity-cli", "settings.json"));
    expect(target.targetDir).toBe(path.join(homedir(), ".gemini", "antigravity-cli"));
    expect(target.profileFileLabel).toBe("Antigravity CLI credential");
    expect(target.credentialTarget).toBe("gemini:antigravity");
    expect(target.getProfileCredentialTarget?.("C:\\Users\\alice\\.gemini-homes", "work")).toMatch(
      /^gemini-oauth-switcher:antigravity-cli:[0-9a-f]{32}$/
    );
  });

  it("normalizes unknown target tools back to Gemini", () => {
    expect(normalizeTargetTool("antigravity-cli")).toBe("antigravity-cli");
    expect(normalizeTargetTool("unknown")).toBe("gemini");
    expect(normalizeTargetTool(undefined)).toBe("gemini");
  });
});
