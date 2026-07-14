import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveGeminiOAuthLoginWithSettings } from "../src/main/oauthLoginPersistenceService";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gemini-oauth-switcher-login-persist-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Gemini OAuth login persistence", () => {
  it("restores the pending login directory when settings persistence fails", async () => {
    const profilesRoot = await makeTempRoot();
    const pendingProfilePath = path.join(profilesRoot, ".pending-login-persist-failure");
    const oauthPath = path.join(pendingProfilePath, ".gemini", "oauth_creds.json");
    await mkdir(path.dirname(oauthPath), { recursive: true });
    await writeFile(oauthPath, JSON.stringify({
      account: { email: "retry@example.com" },
      access_token: "redacted"
    }), "utf8");

    await expect(saveGeminiOAuthLoginWithSettings({
      profilesRoot,
      sessionId: "persist-failure",
      pendingProfilePath,
      profileName: "retry_example_com",
      persistResult: async () => {
        throw new Error("settings unavailable");
      }
    })).rejects.toThrow("settings unavailable");

    await expect(readFile(oauthPath, "utf8")).resolves.toContain("retry@example.com");
    await expect(stat(path.join(profilesRoot, "retry_example_com"))).rejects.toThrow();
  });

  it("can retry the same login session after a transient settings failure", async () => {
    const profilesRoot = await makeTempRoot();
    const pendingProfilePath = path.join(profilesRoot, ".pending-login-persist-retry");
    const oauthPath = path.join(pendingProfilePath, ".gemini", "oauth_creds.json");
    await mkdir(path.dirname(oauthPath), { recursive: true });
    await writeFile(oauthPath, JSON.stringify({
      account: { email: "retry@example.com" },
      access_token: "redacted"
    }), "utf8");

    await expect(saveGeminiOAuthLoginWithSettings({
      profilesRoot,
      sessionId: "persist-retry",
      pendingProfilePath,
      profileName: "retry_example_com",
      persistResult: async () => {
        throw new Error("settings unavailable");
      }
    })).rejects.toThrow("settings unavailable");

    const result = await saveGeminiOAuthLoginWithSettings({
      profilesRoot,
      sessionId: "persist-retry",
      pendingProfilePath,
      profileName: "retry_example_com",
      persistResult: async () => undefined
    });

    await expect(readFile(result.oauthPath, "utf8")).resolves.toContain("retry@example.com");
    await expect(stat(pendingProfilePath)).rejects.toThrow();
  });
});
