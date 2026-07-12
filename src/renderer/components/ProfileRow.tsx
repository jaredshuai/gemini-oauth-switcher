import { Clock, Copy, FolderKey, KeyRound, Pencil, RefreshCw, Shuffle, Trash2 } from "lucide-react";
import type { ProfileInfo, ProfileUsageResult, TargetTool, UsageTier } from "../../shared/types";
import { TOOL_LABELS } from "../constants";
import {
  clampPercentage,
  describeUsageFailure,
  formatProfileUpdatedTime,
  formatRelativeTime,
  formatResetTime,
  usageBarClass
} from "../utils";

export function ProfileRow({
  selectedTool,
  profile,
  nickname,
  isSwitching,
  isDeleting,
  isSwitchDisabled,
  isDeleteDisabled,
  usage,
  isRefreshingUsage,
  onSwitch,
  onDelete,
  onCopyName,
  onCopyPath,
  onSetNickname,
  onRefreshUsage
}: {
  selectedTool: TargetTool;
  profile: ProfileInfo;
  nickname?: string;
  isSwitching: boolean;
  isDeleting: boolean;
  isSwitchDisabled: boolean;
  isDeleteDisabled: boolean;
  usage?: ProfileUsageResult;
  isRefreshingUsage: boolean;
  onSwitch: () => void;
  onDelete: () => void;
  onCopyName: () => void;
  onCopyPath: () => void;
  onSetNickname: () => void;
  onRefreshUsage: () => void;
}) {
  const displayName = nickname || profile.accountEmail || profile.name;
  const hasAlternateDisplayName = displayName !== profile.name;
  const isGeminiTool = selectedTool === "gemini";
  const toolLabels = TOOL_LABELS[selectedTool];
  const AccountIcon = isGeminiTool ? FolderKey : KeyRound;

  return (
    <div className={`profile-row relative grid grid-cols-[minmax(260px,1fr)_320px_152px] items-center gap-3 px-5 py-4 text-sm ${profile.isCurrent ? "profile-row-current bg-emerald-50/35 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-emerald-500" : "bg-transparent"}`}>
      <div className="flex min-w-0 items-start gap-3.5">
        <div
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${profile.isCurrent ? "border-emerald-300 bg-emerald-100/70 text-emerald-700" : "border-[#d8cbb4] bg-[#fbf6e9] text-neutral-400"}`}
          title={profile.isCurrent ? "当前账号" : "可切换账号"}
        >
          <AccountIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate text-[15px] font-semibold text-neutral-950" title={isGeminiTool ? profile.oauthPath : profile.name}>
              {displayName}
            </span>
            <button className="copy-icon-button" onClick={onCopyName} aria-label={`复制 ${profile.name}`} title="复制完整 profile 名称">
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button className="copy-icon-button" onClick={onSetNickname} aria-label={`设置 ${profile.name} 的昵称`} title="设置昵称">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {profile.isCurrent ? <span className="status-pill ml-1 bg-emerald-100 text-emerald-800">当前</span> : null}
            {!profile.exists ? <span className="status-pill bg-amber-100 text-amber-800">{toolLabels.missingLabel}</span> : null}
          </div>
          {hasAlternateDisplayName ? (
            <div className="mt-1 truncate font-mono text-[10px] tracking-[0.04em] text-neutral-500" title={profile.name}>
              {profile.name}
            </div>
          ) : null}
          {isGeminiTool && profile.oauthPath ? (
            <div className="mt-1 flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-[10px] text-neutral-400" title={profile.oauthPath}>
                {profile.oauthPath}
              </span>
              <button
                className="copy-icon-button shrink-0"
                aria-label="复制路径"
                title={`复制路径：${profile.oauthPath}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyPath();
                }}
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {isGeminiTool ? (
        <UsageCell profile={profile} usage={usage} isRefreshing={isRefreshingUsage} onRefresh={onRefreshUsage} />
      ) : (
        <ProfileFileCell profile={profile} />
      )}
      <div className="flex justify-start gap-2">
        <button className="switch-button" onClick={onSwitch} disabled={!profile.exists || profile.isCurrent || isSwitchDisabled}>
          <Shuffle className={isSwitching ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
          {profile.isCurrent ? "已使用" : isSwitching ? "切换中" : "切换"}
        </button>
        <button
          className="danger-icon-button"
          onClick={onDelete}
          disabled={profile.isCurrent || isDeleteDisabled}
          aria-label={`删除 ${profile.name}`}
          title={profile.isCurrent ? "当前账号不能删除，请先切换到其他账号" : isGeminiTool ? "删除 profile 到回收站" : "删除 Antigravity 账号"}
        >
          <Trash2 className={isDeleting ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
        </button>
      </div>
    </div>
  );
}

function UsageCell({
  profile,
  usage,
  isRefreshing,
  onRefresh
}: {
  profile: ProfileInfo;
  usage?: ProfileUsageResult;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  if (!profile.exists) {
    return <div className="text-xs text-neutral-500">无 OAuth 文件</div>;
  }

  if (isRefreshing) {
    return (
      <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        查询中
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {usage ? (
        <UsageSummary usage={usage} onRefresh={onRefresh} />
      ) : (
        <div className="flex items-center justify-start gap-3">
          <UsageRefreshButton label="查询用量" onRefresh={onRefresh} />
          <span className="text-xs text-neutral-500">未查询</span>
        </div>
      )}
    </div>
  );
}

function ProfileFileCell({ profile }: { profile: ProfileInfo }) {
  if (!profile.exists) {
    return <div className="text-xs text-neutral-500">无登录凭据</div>;
  }

  return (
    <div className="min-w-0 border-l border-neutral-200 pl-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-neutral-800">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-100 text-emerald-700">
          <KeyRound className="h-3 w-3" />
        </span>
        凭据已就绪
      </div>
      {profile.updatedAtMs ? (
        <div className="mt-1.5 flex items-center gap-1 font-mono text-[10px] text-neutral-500">
          <Clock className="h-3 w-3" />
          更新于 {formatProfileUpdatedTime(profile.updatedAtMs)}
        </div>
      ) : null}
    </div>
  );
}

function UsageSummary({ usage, onRefresh }: { usage: ProfileUsageResult; onRefresh: () => void }) {
  if (!usage.success) {
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-semibold text-red-600" title={usage.error}>
          {describeUsageFailure(usage)}
        </div>
        <UsageRefreshButton label="重试" onRefresh={onRefresh} />
      </div>
    );
  }

  if (usage.tiers.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-500">暂无用量数据</span>
        <UsageRefreshButton label="重新查询" onRefresh={onRefresh} />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="space-y-2">
        {usage.tiers.map((tier) => (
          <UsageTierBar key={tier.name} tier={tier} />
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 whitespace-nowrap">
        <UsageRefreshButton label="重新查询" onRefresh={onRefresh} />
        {usage.queriedAt ? (
          <div className="flex items-center gap-1 text-[11px] text-neutral-500">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(usage.queriedAt)}
          </div>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

function UsageRefreshButton({ label, onRefresh }: { label: string; onRefresh: () => void }) {
  return (
    <button className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-600 hover:text-neutral-950" onClick={onRefresh}>
      <RefreshCw className="h-3 w-3" />
      {label}
    </button>
  );
}

function UsageTierBar({ tier }: { tier: UsageTier }) {
  const percentage = clampPercentage(tier.utilization);
  const resetText = formatResetTime(tier.resetsAt);

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-[78px_minmax(96px,1fr)_36px] items-center gap-2 font-mono text-[11px] leading-none text-neutral-700">
        <span className="whitespace-nowrap" title={tier.label}>
          {tier.label}
        </span>
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200">
          <div
            className={`h-full rounded-full ${usageBarClass(tier.utilization)}`}
            style={{ width: `${percentage}%` }}
            role="progressbar"
            aria-label={`${tier.label} ${percentage}%`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
          />
        </div>
        <span className="text-right text-neutral-500" title={resetText ? `${percentage}% · ${resetText}` : `${percentage}%`}>
          <span className="font-semibold text-neutral-800">{percentage}%</span>
        </span>
      </div>
    </div>
  );
}
