import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAntigravityLoginRoot, getDefaultProfilesRoot, getDefaultTargetAntigravityCliSettingsPath } from "../src/main/paths";
import { readSettings, saveSettings } from "../src/main/settings";
import type { AppSettings } from "../src/shared/types";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gemini-oauth-switcher-settings-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("settings defaults", () => {
  it("derives the default profilesRoot from the current user home directory", () => {
    expect(getDefaultProfilesRoot()).toBe(path.join(homedir(), ".gemini-homes"));
  });

  it("derives the default Antigravity CLI settings path from the current user home directory", () => {
    expect(getDefaultTargetAntigravityCliSettingsPath()).toBe(
      path.join(homedir(), ".gemini", "antigravity-cli", "settings.json")
    );
  });

  it("keeps Antigravity login workspaces outside the Gemini profiles root", () => {
    const loginRoot = getAntigravityLoginRoot(path.join("C:\\Temp", "app-temp"));

    expect(loginRoot).toBe(path.join("C:\\Temp", "app-temp", "gemini-oauth-switcher", "antigravity-login"));
    expect(loginRoot).not.toContain(".gemini-homes");
  });

  it("uses the default profilesRoot when no settings file exists", async () => {
    const root = await makeTempRoot();

    await expect(readSettings(path.join(root, "settings.json"))).resolves.toMatchObject({
      profilesRoot: getDefaultProfilesRoot()
    });
  });

  it("stores profile nicknames as non-sensitive settings", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");

    await saveSettings(settingsPath, {
      profileNicknames: {
        "work-profile": "Work",
        empty: "   "
      }
    });

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      profileNicknames: {
        "work-profile": "Work"
      }
    });
  });

  it("bounds profile nickname keys and values", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");
    const maximumKey = "k".repeat(255);
    const oversizedKey = "k".repeat(256);

    await saveSettings(settingsPath, {
      profileNicknames: {
        [maximumKey]: "Allowed",
        [oversizedKey]: "Ignored",
        work: "N".repeat(161)
      }
    });

    const settings = await readSettings(settingsPath);
    expect(settings.profileNicknames?.[maximumKey]).toBe("Allowed");
    expect(settings.profileNicknames).not.toHaveProperty(oversizedKey);
    expect(settings.profileNicknames?.work).toBe("N".repeat(160));
  });

  it("keeps the latest 256 profile nicknames in deterministic input order", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");
    const profileNicknames = Object.fromEntries(
      Array.from({ length: 260 }, (_, index) => [
        `profile-${String(index).padStart(3, "0")}`,
        `Nickname ${index}`
      ])
    );

    await saveSettings(settingsPath, { profileNicknames });

    const settings = await readSettings(settingsPath);
    expect(Object.keys(settings.profileNicknames ?? {})).toHaveLength(256);
    expect(settings.profileNicknames).not.toHaveProperty("profile-003");
    expect(settings.profileNicknames?.["profile-004"]).toBe("Nickname 4");
    expect(settings.profileNicknames?.["profile-259"]).toBe("Nickname 259");
  });

  it("stores only sanitized Antigravity account metadata", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");

    await saveSettings(settingsPath, {
      antigravityProfiles: [
        {
          id: "agy-alice",
          name: " Alice ",
          accountEmail: "ALICE@EXAMPLE.COM",
          createdAt: 100,
          updatedAt: 200
        },
        {
          id: "bad id",
          name: "Ignored",
          createdAt: 100,
          updatedAt: 200
        }
      ]
    } as Partial<AppSettings>);

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      antigravityProfiles: [
        {
          id: "agy-alice",
          name: "Alice",
          accountEmail: "alice@example.com",
          createdAt: 100,
          updatedAt: 200
        }
      ]
    });
  });

  it("stores the tray close behavior as a non-sensitive setting", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");

    await saveSettings(settingsPath, {
      trayBehavior: "minimize_to_tray"
    });

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      trayBehavior: "minimize_to_tray"
    });

    await saveSettings(settingsPath, {
      trayBehavior: "unknown"
    } as unknown as Partial<AppSettings> & Record<string, unknown>);

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      trayBehavior: "exit"
    });
  });

  it("stores auto update preference and defaults to enabled", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      autoUpdateEnabled: true
    });

    await saveSettings(settingsPath, {
      autoUpdateEnabled: false
    });

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      autoUpdateEnabled: false
    });

    await saveSettings(settingsPath, {
      autoUpdateEnabled: "unknown"
    } as unknown as Partial<AppSettings> & Record<string, unknown>);

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      autoUpdateEnabled: true
    });
  });

  it("stores usage display mode and defaults to used percentage", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      usageDisplayMode: "used"
    });

    await saveSettings(settingsPath, {
      usageDisplayMode: "remaining"
    });

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      usageDisplayMode: "remaining"
    });

    await saveSettings(settingsPath, {
      usageDisplayMode: "unknown"
    } as unknown as Partial<AppSettings> & Record<string, unknown>);

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      usageDisplayMode: "used"
    });
  });

  it("stores the built-in UI theme and defaults unknown values to classic", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      uiTheme: "classic"
    });

    await saveSettings(settingsPath, {
      uiTheme: "rpg-parchment"
    });

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      uiTheme: "rpg-parchment"
    });

    await saveSettings(settingsPath, {
      uiTheme: "unknown"
    } as unknown as Partial<AppSettings> & Record<string, unknown>);

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      uiTheme: "classic"
    });
  });

  it("stores the selected target tool and falls back to Gemini for unknown values", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");

    await saveSettings(settingsPath, {
      selectedTool: "antigravity-cli"
    } as Partial<AppSettings> & Record<string, unknown>);

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      selectedTool: "antigravity-cli"
    });

    await saveSettings(settingsPath, {
      selectedTool: "unknown"
    } as unknown as Partial<AppSettings> & Record<string, unknown>);

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      selectedTool: "gemini"
    });
  });

  it("serializes concurrent settings saves so patches are merged", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");

    await Promise.all([
      saveSettings(settingsPath, { trayBehavior: "minimize_to_tray" }),
      saveSettings(settingsPath, { lastSelectedProfile: "work" }),
      saveSettings(settingsPath, { profileNicknames: { work: "Work" } }),
      saveSettings(settingsPath, { windowBounds: { width: 900, height: 700 } })
    ]);

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      trayBehavior: "minimize_to_tray",
      lastSelectedProfile: "work",
      profileNicknames: { work: "Work" },
      windowBounds: { width: 900, height: 700 }
    });
  });

  it("recovers the last valid settings when the primary file is corrupted", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");

    await saveSettings(settingsPath, {
      selectedTool: "antigravity-cli",
      antigravityProfiles: [{
        id: "agy-recoverable",
        name: "recoverable@example.com",
        accountEmail: "recoverable@example.com",
        createdAt: 100,
        updatedAt: 200
      }]
    });
    await saveSettings(settingsPath, { trayBehavior: "minimize_to_tray" });
    await writeFile(settingsPath, "{broken", "utf8");

    await expect(readSettings(settingsPath)).resolves.toMatchObject({
      selectedTool: "antigravity-cli",
      antigravityProfiles: [{ id: "agy-recoverable" }]
    });
    await expect(readFile(`${settingsPath}.bak`, "utf8")).resolves.toContain("agy-recoverable");
  });

  it("stores the last switch receipt without credential hashes", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");
    const patch = {
      lastSwitch: {
        profileName: "ultra",
        switchedAt: 1778715600000,
        verified: true,
        targetTool: "antigravity-cli"
      },
      sourceHash: "should-not-be-kept",
      targetHash: "should-not-be-kept"
    } as Partial<AppSettings> & Record<string, unknown>;

    await saveSettings(settingsPath, patch);

    const settings = await readSettings(settingsPath);

    expect(settings.lastSwitch).toEqual({
      profileName: "ultra",
      switchedAt: 1778715600000,
      verified: true,
      targetTool: "antigravity-cli"
    });
    expect(settings).not.toHaveProperty("sourceHash");
    expect(settings).not.toHaveProperty("targetHash");
  });
});
