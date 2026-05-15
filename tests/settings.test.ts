import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDefaultProfilesRoot } from "../src/main/paths";
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

  it("stores the last switch receipt without credential hashes", async () => {
    const root = await makeTempRoot();
    const settingsPath = path.join(root, "settings.json");
    const patch = {
      lastSwitch: {
        profileName: "ultra",
        switchedAt: 1778715600000,
        verified: true
      },
      sourceHash: "should-not-be-kept",
      targetHash: "should-not-be-kept"
    } as Partial<AppSettings> & Record<string, unknown>;

    await saveSettings(settingsPath, patch);

    const settings = await readSettings(settingsPath);

    expect(settings.lastSwitch).toEqual({
      profileName: "ultra",
      switchedAt: 1778715600000,
      verified: true
    });
    expect(settings).not.toHaveProperty("sourceHash");
    expect(settings).not.toHaveProperty("targetHash");
  });
});
