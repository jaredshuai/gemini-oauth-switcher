import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AntigravityProfileRecord,
  AppSettings,
  LastSwitchResult,
  TargetTool,
  TrayBehavior,
  UiTheme,
  UsageDisplayMode,
  WindowBounds
} from "../shared/types";
import { getDefaultProfilesRoot } from "./paths";

const DEFAULT_SETTINGS: AppSettings = {
  profilesRoot: getDefaultProfilesRoot(),
  selectedTool: "gemini",
  autoUpdateEnabled: true,
  usageDisplayMode: "used",
  uiTheme: "classic"
};
const saveQueues = new Map<string, Promise<AppSettings>>();

export async function readSettings(settingsPath: string): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsPath, "utf8");
    return sanitizeSettings(JSON.parse(raw));
  } catch (error) {
    if (isNotFoundError(error)) {
      return { ...DEFAULT_SETTINGS };
    }
    if (error instanceof SyntaxError) {
      return { ...DEFAULT_SETTINGS };
    }
    throw error;
  }
}

export async function saveSettings(settingsPath: string, patch: Partial<AppSettings>): Promise<AppSettings> {
  const previousSave = saveQueues.get(settingsPath) ?? Promise.resolve(undefined as unknown as AppSettings);
  const nextSave = previousSave.catch(() => undefined).then(() => saveSettingsUnlocked(settingsPath, patch));
  saveQueues.set(settingsPath, nextSave);
  try {
    return await nextSave;
  } finally {
    if (saveQueues.get(settingsPath) === nextSave) {
      saveQueues.delete(settingsPath);
    }
  }
}

async function saveSettingsUnlocked(settingsPath: string, patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await readSettings(settingsPath);
  const next = sanitizeSettings({ ...current, ...patch });
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function sanitizeSettings(value: unknown): AppSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_SETTINGS };
  }

  const input = value as Partial<AppSettings>;
  const profilesRoot =
    typeof input.profilesRoot === "string" && input.profilesRoot.trim()
      ? input.profilesRoot
      : getDefaultProfilesRoot();
  const lastSelectedProfile =
    typeof input.lastSelectedProfile === "string" && input.lastSelectedProfile.trim()
      ? input.lastSelectedProfile
      : undefined;

  const settings: AppSettings = {
    profilesRoot,
    selectedTool: sanitizeTargetTool(input.selectedTool),
    autoUpdateEnabled: input.autoUpdateEnabled !== false,
    usageDisplayMode: sanitizeUsageDisplayMode(input.usageDisplayMode),
    uiTheme: sanitizeUiTheme(input.uiTheme)
  };

  settings.trayBehavior = sanitizeTrayBehavior(input.trayBehavior);

  const windowBounds = sanitizeWindowBounds(input.windowBounds);
  if (windowBounds) {
    settings.windowBounds = windowBounds;
  }

  if (lastSelectedProfile) {
    settings.lastSelectedProfile = lastSelectedProfile;
  }

  const lastSwitch = sanitizeLastSwitch(input.lastSwitch);
  if (lastSwitch) {
    settings.lastSwitch = lastSwitch;
  }

  const profileNicknames = sanitizeProfileNicknames(input.profileNicknames);
  if (profileNicknames) {
    settings.profileNicknames = profileNicknames;
  }

  const antigravityProfiles = sanitizeAntigravityProfiles(input.antigravityProfiles);
  if (antigravityProfiles.length > 0) {
    settings.antigravityProfiles = antigravityProfiles;
  }

  return settings;
}

function sanitizeTrayBehavior(value: unknown): TrayBehavior {
  return value === "minimize_to_tray" ? "minimize_to_tray" : "exit";
}

function sanitizeTargetTool(value: unknown): TargetTool {
  return value === "antigravity-cli" ? "antigravity-cli" : "gemini";
}

function sanitizeUsageDisplayMode(value: unknown): UsageDisplayMode {
  return value === "remaining" ? "remaining" : "used";
}

function sanitizeUiTheme(value: unknown): UiTheme {
  return value === "rpg-parchment" ? "rpg-parchment" : "classic";
}

function sanitizeLastSwitch(value: unknown): LastSwitchResult | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const input = value as Partial<LastSwitchResult>;
  if (typeof input.profileName !== "string" || !input.profileName.trim()) {
    return undefined;
  }
  if (!isFiniteNumber(input.switchedAt) || input.switchedAt <= 0) {
    return undefined;
  }

  return {
    profileName: input.profileName.trim(),
    switchedAt: Math.round(input.switchedAt),
    verified: input.verified === true,
    targetTool: sanitizeTargetTool(input.targetTool)
  };
}

function sanitizeProfileNicknames(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .map(([key, nickname]) => [key.trim(), typeof nickname === "string" ? nickname.trim() : ""] as const)
    .filter(([key, nickname]) => key && nickname);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function sanitizeAntigravityProfiles(value: unknown): AntigravityProfileRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const profiles: AntigravityProfileRecord[] = [];
  const seenIds = new Set<string>();
  for (const candidate of value.slice(0, 200)) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const input = candidate as Partial<AntigravityProfileRecord>;
    const id = typeof input.id === "string" ? input.id.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(id) || !name || name.length > 160 || seenIds.has(id)) {
      continue;
    }
    if (!isFiniteNumber(input.createdAt) || input.createdAt <= 0 || !isFiniteNumber(input.updatedAt) || input.updatedAt <= 0) {
      continue;
    }

    const accountEmail = typeof input.accountEmail === "string" ? input.accountEmail.trim().toLowerCase() : "";
    profiles.push({
      id,
      name,
      ...(accountEmail ? { accountEmail } : {}),
      createdAt: Math.round(input.createdAt),
      updatedAt: Math.round(input.updatedAt)
    });
    seenIds.add(id);
  }

  return profiles;
}

function sanitizeWindowBounds(value: unknown): WindowBounds | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const bounds = value as Partial<WindowBounds>;
  if (!isFiniteNumber(bounds.width) || !isFiniteNumber(bounds.height)) {
    return undefined;
  }

  const sanitized: WindowBounds = {
    width: Math.max(760, Math.round(bounds.width)),
    height: Math.max(520, Math.round(bounds.height))
  };

  if (isFiniteNumber(bounds.x)) {
    sanitized.x = Math.round(bounds.x);
  }
  if (isFiniteNumber(bounds.y)) {
    sanitized.y = Math.round(bounds.y);
  }

  return sanitized;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
