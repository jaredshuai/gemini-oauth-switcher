import type { AppRuntimeInfo, AppUpdateStatus, LastSwitchResult, LocalDiagnosticsResult, ProfileInfo, ProfileUsageResult, TargetTool, UsageDisplayMode } from "../shared/types";

interface ElapsedSuffixes {
  now: string;
  minutes: string;
  hours: string;
  days: string;
}

function formatElapsed(value: number, suffixes: ElapsedSuffixes): string {
  const diffMs = Math.max(0, Date.now() - value);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return suffixes.now;
  }
  if (minutes < 60) {
    return `${minutes} ${suffixes.minutes}`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${suffixes.hours}`;
  }

  return `${Math.floor(hours / 24)} ${suffixes.days}`;
}

export function formatRelativeTime(value: number): string {
  return formatElapsed(value, {
    now: "刚刚查询",
    minutes: "分钟前查询",
    hours: "小时前查询",
    days: "天前查询"
  });
}

export function formatProfileUpdatedTime(value: number): string {
  return formatElapsed(value, {
    now: "刚刚",
    minutes: "分钟前",
    hours: "小时前",
    days: "天前"
  });
}

export const formatSwitchRelativeTime = formatProfileUpdatedTime;

export function shouldShowAutoUpdateSetting(runtime: Pick<AppRuntimeInfo, "isPortable">): boolean {
  return !runtime.isPortable;
}

export function formatAppVersion(version: string): string {
  const normalized = version.trim();
  if (!normalized) {
    return "未知";
  }
  return normalized.toLowerCase().startsWith("v") ? normalized : `v${normalized}`;
}

export function describeAppUpdate(
  status: AppUpdateStatus,
  runtime: Pick<AppRuntimeInfo, "isPackaged" | "isPortable">,
  autoUpdateEnabled: boolean
): { text: string; tone: "muted" | "active" | "ready" } {
  if (!runtime.isPackaged) {
    return { text: "开发环境", tone: "muted" };
  }
  if (runtime.isPortable) {
    return { text: "便携版需手动更新", tone: "muted" };
  }
  if (!autoUpdateEnabled || status.phase === "disabled") {
    return { text: "自动更新已关闭", tone: "muted" };
  }

  const latestVersion = status.latestVersion ? formatAppVersion(status.latestVersion) : undefined;
  switch (status.phase) {
    case "checking":
      return { text: "正在检查更新", tone: "active" };
    case "up-to-date":
      return { text: "已是最新版本", tone: "ready" };
    case "downloading":
      return { text: latestVersion ? `新版本 ${latestVersion} · 下载中` : "新版本下载中", tone: "active" };
    case "downloaded":
      return { text: latestVersion ? `新版本 ${latestVersion} · 等待安装` : "新版本等待安装", tone: "ready" };
    case "error":
      return { text: "暂时无法检查更新", tone: "muted" };
    default:
      return { text: "自动检查更新已开启", tone: "muted" };
  }
}

export function shouldCompactAccountStatus(
  selectedTool: TargetTool,
  hasCurrentProfile: boolean,
  diagnostics?: LocalDiagnosticsResult
): boolean {
  return Boolean(
    hasCurrentProfile &&
    diagnostics &&
    diagnostics.envRisks.length === 0 &&
    (selectedTool !== "gemini" || diagnostics.geminiCommand.available)
  );
}

export function getVisibleLastSwitch(
  lastSwitch: LastSwitchResult | undefined,
  selectedTool: TargetTool,
  profiles: ProfileInfo[]
): LastSwitchResult | undefined {
  if (!lastSwitch || (lastSwitch.targetTool ?? "gemini") !== selectedTool) {
    return undefined;
  }
  return profiles.some((profile) => profile.isCurrent && profile.name === lastSwitch.profileName)
    ? lastSwitch
    : undefined;
}

export function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** API data is always used/utilization percentage; remaining is derived as 100 - used. */
export function toDisplayUsagePercentage(utilization: number, mode: UsageDisplayMode = "used"): number {
  const used = clampPercentage(utilization);
  return mode === "remaining" ? clampPercentage(100 - used) : used;
}

/**
 * Color severity always tracks quota pressure (used %).
 * High used / low remaining → red; comfortable remaining → green.
 */
export function usageBarClass(utilization: number): string {
  const used = clampPercentage(utilization);
  if (used >= 90) {
    return "bg-red-500";
  }
  if (used >= 70) {
    return "bg-amber-500";
  }

  return "bg-emerald-500";
}

/**
 * Mode-aware tier labels for remaining mode.
 * Only recognized time-window quota labels are rewritten (周 / 5h).
 * Gemini model tiers (Pro, Flash, Flash Lite, etc.) stay unchanged to fit the 78px column.
 */
export function formatUsageTierLabel(label: string, mode: UsageDisplayMode = "used"): string {
  if (mode !== "remaining") {
    return label;
  }

  if (label === "周" || label === "周限额" || label === "周限额剩余") {
    return "周限额剩余";
  }
  if (label === "5h" || label === "5 小时" || label === "5 小时剩余") {
    return "5 小时剩余";
  }

  return label;
}

export function formatUsageAriaLabel(
  parts: Array<string | undefined>,
  percentage: number,
  mode: UsageDisplayMode = "used"
): string {
  const base = parts.filter((part): part is string => Boolean(part && part.trim())).join(" ");
  if (mode === "remaining") {
    if (base.includes("剩余")) {
      return `${base} ${percentage}%`.replace(/\s+/g, " ").trim();
    }
    return `${base} 剩余 ${percentage}%`.replace(/\s+/g, " ").trim();
  }
  return `${base} 已用 ${percentage}%`.replace(/\s+/g, " ").trim();
}

export function formatResetTime(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function buildProfileLoginPreview(profilesRoot: string, profileName: string, selectedTool: TargetTool): string {
  if (!profilesRoot || !profileName) {
    return "";
  }

  if (selectedTool === "antigravity-cli") {
    return `Windows Credential Manager：${profileName} 的 Antigravity 登录凭据`;
  }

  const relativePath = ".gemini\\oauth_creds.json";
  return `${profilesRoot.replace(/[\\/]+$/, "")}\\${profileName}\\${relativePath}`;
}

export function getProfileDisplayName(profile: ProfileInfo, nicknames: Record<string, string>): string {
  return nicknames[getProfileKey(profile)] || profile.accountEmail || profile.name;
}

export function getProfileKey(profile: ProfileInfo): string {
  return profile.id || profile.name;
}

export function describeUsageFailure(usage: ProfileUsageResult, targetTool: TargetTool = "gemini"): string {
  const isAntigravity = targetTool === "antigravity-cli";
  if (usage.credentialStatus === "not_found") {
    return isAntigravity ? "无登录凭据" : "无 OAuth 文件";
  }
  if (usage.credentialStatus === "parse_error") {
    return isAntigravity ? "登录凭据无法读取" : "OAuth 文件无法读取";
  }
  if (usage.credentialStatus === "expired") {
    return isAntigravity ? "登录凭据已过期" : "登录已失效";
  }
  if (usage.error?.includes("HTTP 403")) {
    return "权限不足或账号不可用";
  }
  if (usage.error?.includes("HTTP 401")) {
    return "登录已失效";
  }
  if (usage.error?.startsWith("Network error")) {
    return "网络请求失败";
  }

  return "查询失败";
}

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("复制失败");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getApi() {
  if (!window.geminiSwitcher) {
    throw new Error("Electron preload API 不可用，请通过 pnpm dev 启动 Electron 窗口。");
  }

  return window.geminiSwitcher;
}
