import { lstat, mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteProfile, listProfiles, switchProfile, validateProfileName } from "../src/main/profileService";

const tempRoots: string[] = [];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gemini-oauth-switcher-"));
  tempRoots.push(root);
  return root;
}

async function writeProfile(root: string, name: string, content: string): Promise<string> {
  const geminiDir = path.join(root, name, ".gemini");
  await mkdir(geminiDir, { recursive: true });
  const oauthPath = path.join(geminiDir, "oauth_creds.json");
  await writeFile(oauthPath, content, "utf8");
  return oauthPath;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("profileService", () => {
  it("lists profile directories with hashes and marks the current target account", async () => {
    const root = await makeTempRoot();
    const aliceCreds = "{\"account\":\"alice\"}";
    await writeProfile(root, "alice", aliceCreds);
    await mkdir(path.join(root, "bob", ".gemini"), { recursive: true });
    await writeProfile(root, ".pending-login-20260514-080000-abc123", "{\"account\":\"pending\"}");

    const targetRoot = await makeTempRoot();
    const targetOAuthPath = path.join(targetRoot, ".gemini", "oauth_creds.json");
    await mkdir(path.dirname(targetOAuthPath), { recursive: true });
    await writeFile(targetOAuthPath, aliceCreds, "utf8");

    const result = await listProfiles({ profilesRoot: root, targetOAuthPath });

    expect(result.targetHash).toBe(sha256(aliceCreds));
    expect(result.profiles.map((profile) => profile.name)).toEqual(["alice", "bob"]);
    expect(result.profiles[0]).toMatchObject({
      name: "alice",
      exists: true,
      sha256: sha256(aliceCreds),
      shortHash: sha256(aliceCreds).slice(0, 8),
      isCurrent: true
    });
    expect(result.profiles[0].updatedAtMs).toEqual(expect.any(Number));
    expect(result.profiles[1]).toMatchObject({
      name: "bob",
      exists: false,
      isCurrent: false
    });
  });

  it("returns an empty list when profilesRoot does not exist yet", async () => {
    const root = await makeTempRoot();
    const missingRoot = path.join(root, "missing-profiles");
    const targetOAuthPath = path.join(root, "home", ".gemini", "oauth_creds.json");

    await expect(listProfiles({ profilesRoot: missingRoot, targetOAuthPath })).resolves.toMatchObject({
      profilesRoot: missingRoot,
      targetOAuthPath,
      profiles: []
    });
  });

  it("switches a selected profile by replacing the target oauth file and verifying the hash", async () => {
    const root = await makeTempRoot();
    const sourceCreds = "{\"account\":\"carol\"}";
    await writeProfile(root, "carol", sourceCreds);

    const targetOAuthPath = path.join(root, "home", ".gemini", "oauth_creds.json");
    const result = await switchProfile({ profilesRoot: root, profileName: "carol", targetOAuthPath });

    await expect(readFile(targetOAuthPath, "utf8")).resolves.toBe(sourceCreds);
    await expect(readFile(`${targetOAuthPath}.tmp`, "utf8")).rejects.toThrow();
    expect(result.profileName).toBe("carol");
    expect(result.sourceHash).toBe(sha256(sourceCreds));
    expect(result.targetHash).toBe(sha256(sourceCreds));
  });

  it("does not use the shared target .tmp path when switching", async () => {
    const root = await makeTempRoot();
    const sourceCreds = "{\"account\":\"carol\"}";
    await writeProfile(root, "carol", sourceCreds);

    const targetOAuthPath = path.join(root, "home", ".gemini", "oauth_creds.json");
    await mkdir(path.dirname(targetOAuthPath), { recursive: true });
    await writeFile(`${targetOAuthPath}.tmp`, "pre-existing temp", "utf8");

    await switchProfile({ profilesRoot: root, profileName: "carol", targetOAuthPath });

    await expect(readFile(`${targetOAuthPath}.tmp`, "utf8")).resolves.toBe("pre-existing temp");
    const targetDirEntries = await readdir(path.dirname(targetOAuthPath));
    expect(targetDirEntries.filter((entry) => entry.endsWith(".tmp"))).toEqual(["oauth_creds.json.tmp"]);
  });

  it("reports a clear error when the target Gemini path is a file", async () => {
    const root = await makeTempRoot();
    await writeProfile(root, "carol", "{\"account\":\"carol\"}");
    const targetOAuthPath = path.join(root, "home", ".gemini", "oauth_creds.json");
    await mkdir(path.dirname(path.dirname(targetOAuthPath)), { recursive: true });
    await writeFile(path.dirname(targetOAuthPath), "not a directory", "utf8");

    await expect(switchProfile({ profilesRoot: root, profileName: "carol", targetOAuthPath })).rejects.toThrow(
      /Target Gemini directory is not a directory/
    );
  });

  it("rejects profile names that are not direct child directories", async () => {
    const root = await makeTempRoot();
    const targetOAuthPath = path.join(root, "home", ".gemini", "oauth_creds.json");

    await expect(switchProfile({ profilesRoot: root, profileName: "..", targetOAuthPath })).rejects.toThrow(
      /Invalid profile name/
    );
  });

  it("rejects Windows-invalid profile names", () => {
    for (const profileName of ["bad:name", "bad*name", "bad?name", "bad\"name", "bad<name", "bad>name", "bad|name", "name.", "name ", "CON", "nul.txt"]) {
      expect(() => validateProfileName(profileName)).toThrow(/Invalid profile name/);
    }
  });

  it("deletes a non-current direct child profile directory", async () => {
    const root = await makeTempRoot();
    await writeProfile(root, "old-account", "{\"account\":\"old\"}");
    const targetOAuthPath = path.join(root, "home", ".gemini", "oauth_creds.json");

    const result = await deleteProfile({ profilesRoot: root, profileName: "old-account", targetOAuthPath });

    expect(result.profileName).toBe("old-account");
    expect(result.profilePath).toBe(path.join(root, "old-account"));
    await expect(stat(path.join(root, "old-account"))).rejects.toThrow();
  });

  it("does not delete a directory that is not a Gemini OAuth profile", async () => {
    const root = await makeTempRoot();
    await mkdir(path.join(root, "ordinary-folder"), { recursive: true });
    const targetOAuthPath = path.join(root, "home", ".gemini", "oauth_creds.json");

    await expect(deleteProfile({ profilesRoot: root, profileName: "ordinary-folder", targetOAuthPath })).rejects.toThrow(
      /OAuth file does not exist/
    );
    await expect(stat(path.join(root, "ordinary-folder"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("rejects profile paths that resolve outside profilesRoot", async () => {
    const root = await makeTempRoot();
    const externalRoot = await makeTempRoot();
    await writeProfile(externalRoot, "external", "{\"account\":\"external\"}");
    const linkPath = path.join(root, "linked-profile");
    await symlink(path.join(externalRoot, "external"), linkPath, "junction");
    await expect(lstat(linkPath)).resolves.toMatchObject({ isSymbolicLink: expect.any(Function) });
    const targetOAuthPath = path.join(root, "home", ".gemini", "oauth_creds.json");

    await expect(switchProfile({ profilesRoot: root, profileName: "linked-profile", targetOAuthPath })).rejects.toThrow(
      /outside profilesRoot|symbolic link|junction/
    );
    await expect(deleteProfile({ profilesRoot: root, profileName: "linked-profile", targetOAuthPath })).rejects.toThrow(
      /outside profilesRoot|symbolic link|junction/
    );
  });

  it("does not delete the profile that matches the current target account", async () => {
    const root = await makeTempRoot();
    const currentCreds = "{\"account\":\"current\"}";
    await writeProfile(root, "current-account", currentCreds);

    const targetOAuthPath = path.join(root, "home", ".gemini", "oauth_creds.json");
    await mkdir(path.dirname(targetOAuthPath), { recursive: true });
    await writeFile(targetOAuthPath, currentCreds, "utf8");

    await expect(deleteProfile({ profilesRoot: root, profileName: "current-account", targetOAuthPath })).rejects.toThrow(
      /Cannot delete the current profile/
    );
    await expect(stat(path.join(root, "current-account"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });
});
