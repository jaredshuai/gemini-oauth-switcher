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
});
