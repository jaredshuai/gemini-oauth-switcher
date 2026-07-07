import type { ProfileInfo, ProfileUsageResult, TargetTool } from "../shared/types";

export function formatRelativeTime(value: number): string {
  const diffMs = Math.max(0, Date.now() - value);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return "刚刚查询";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前查询`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前查询`;
  }

  return `${Math.floor(hours / 24)} 天前查询`;
}

export function formatProfileUpdatedTime(value: number): string {
  const diffMs = Math.max(0, Date.now() - value);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }

  return `${Math.floor(hours / 24)} 天前`;
}

export function formatSwitchRelativeTime(value: number): string {
  const diffMs = Math.max(0, Date.now() - value);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }

  return `${Math.floor(hours / 24)} 天前`;
}

export function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
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

export function usageBarClass(utilization: number): string {
  if (utilization >= 90) {
    return "bg-red-500";
  }
  if (utilization >= 70) {
    return "bg-amber-500";
  }

  return "bg-emerald-500";
}

export function getProfileDisplayName(profile: ProfileInfo, nicknames: Record<string, string>): string {
  return nicknames[profile.name] || profile.name;
}

export function describeUsageFailure(usage: ProfileUsageResult): string {
  if (usage.credentialStatus === "not_found") {
    return "无 OAuth 文件";
  }
  if (usage.credentialStatus === "parse_error") {
    return "OAuth 文件无法读取";
  }
  if (usage.credentialStatus === "expired") {
    return "登录已失效";
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
