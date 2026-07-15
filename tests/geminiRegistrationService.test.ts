import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCurrentGeminiAccount } from "../src/main/geminiRegistrationService";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gemini-registration-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Gemini current-account registration", () => {
  it("rolls back the registered profile when settings persistence fails", async () => {
    const profilesRoot = await makeTempRoot();
    const targetRoot = await makeTempRoot();
    const targetOAuthPath = path.join(targetRoot, ".gemini", "oauth_creds.json");
    await mkdir(path.dirname(targetOAuthPath), { recursive: true });
    await writeFile(targetOAuthPath, JSON.stringify({
      account: { email: "rollback@example.com" },
      token: "opaque"
    }), "utf8");

    await expect(registerCurrentGeminiAccount({
      profilesRoot,
      targetOAuthPath,
      profileNicknames: {},
      saveSettingsPatch: async () => {
        throw new Error("settings unavailable");
      }
    })).rejects.toThrow("settings unavailable");

    await expect(stat(path.join(profilesRoot, "rollback@example.com"))).rejects.toThrow();
    expect((await readdir(profilesRoot)).filter((entry) => entry.startsWith(".pending-register-"))).toEqual([]);
  });

  it("persists non-sensitive metadata for the exact registered snapshot", async () => {
    const profilesRoot = await makeTempRoot();
    const targetRoot = await makeTempRoot();
    const targetOAuthPath = path.join(targetRoot, ".gemini", "oauth_creds.json");
    const credential = JSON.stringify({ account: { email: "registered@example.com" }, token: "opaque" });
    await mkdir(path.dirname(targetOAuthPath), { recursive: true });
    await writeFile(targetOAuthPath, credential, "utf8");
    const saveSettingsPatch = vi.fn(async () => undefined);

    const result = await registerCurrentGeminiAccount({
      profilesRoot,
      targetOAuthPath,
      profileNicknames: { existing: "Existing" },
      saveSettingsPatch
    });

    expect(result).toMatchObject({
      targetTool: "gemini",
      profileName: "registered_example_com",
      nickname: "registered@example.com",
      accountEmail: "registered@example.com"
    });
    await expect(readFile(result.oauthPath, "utf8")).resolves.toBe(credential);
    expect(saveSettingsPatch).toHaveBeenCalledWith({
      selectedTool: "gemini",
      lastSelectedProfile: "registered_example_com",
      profileNicknames: {
        existing: "Existing",
        registered_example_com: "registered@example.com"
      }
    });
  });

  it("refreshes an existing profile when the current OAuth belongs to the same account", async () => {
    const profilesRoot = await makeTempRoot();
    const targetRoot = await makeTempRoot();
    const targetOAuthPath = path.join(targetRoot, ".gemini", "oauth_creds.json");
    const profilePath = path.join(profilesRoot, "same_example_com", ".gemini", "oauth_creds.json");
    const refreshedCredential = JSON.stringify({ account: { email: "same@example.com" }, token: "refreshed" });
    await mkdir(path.dirname(targetOAuthPath), { recursive: true });
    await mkdir(path.dirname(profilePath), { recursive: true });
    await writeFile(targetOAuthPath, refreshedCredential, "utf8");
    await writeFile(profilePath, JSON.stringify({ account: { email: "same@example.com" }, token: "stale" }), "utf8");
    const saveSettingsPatch = vi.fn(async () => undefined);

    const result = await registerCurrentGeminiAccount({
      profilesRoot,
      targetOAuthPath,
      profileNicknames: {},
      saveSettingsPatch
    });

    expect(result).toMatchObject({
      profileName: "same_example_com",
      nickname: "same@example.com",
      accountEmail: "same@example.com"
    });
    await expect(readFile(profilePath, "utf8")).resolves.toBe(refreshedCredential);
    expect(saveSettingsPatch).not.toHaveBeenCalled();
  });

  it("does not overwrite a same-name profile that belongs to a different account", async () => {
    const profilesRoot = await makeTempRoot();
    const targetRoot = await makeTempRoot();
    const targetOAuthPath = path.join(targetRoot, ".gemini", "oauth_creds.json");
    const profilePath = path.join(profilesRoot, "user_one_example_com", ".gemini", "oauth_creds.json");
    const existingCredential = JSON.stringify({ account: { email: "user.one@example.com" }, token: "existing" });
    await mkdir(path.dirname(targetOAuthPath), { recursive: true });
    await mkdir(path.dirname(profilePath), { recursive: true });
    await writeFile(targetOAuthPath, JSON.stringify({
      account: { email: "user+one@example.com" },
      token: "current"
    }), "utf8");
    await writeFile(profilePath, existingCredential, "utf8");

    await expect(registerCurrentGeminiAccount({
      profilesRoot,
      targetOAuthPath,
      profileNicknames: {},
      saveSettingsPatch: async () => undefined
    })).rejects.toThrow(/同名账号目录.*身份不一致/);

    await expect(readFile(profilePath, "utf8")).resolves.toBe(existingCredential);
  });
});
