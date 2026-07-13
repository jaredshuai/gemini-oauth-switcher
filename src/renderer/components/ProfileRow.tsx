import { Clock, Copy, FolderKey, KeyRound, Pencil, RefreshCw, Shuffle, Trash2 } from "lucide-react";
import type { ProfileInfo, ProfileUsageResult, TargetTool, UsageDisplayMode, UsageGroup, UsageTier } from "../../shared/types";
import { TOOL_LABELS } from "../constants";
import {
  describeUsageFailure,
  formatRelativeTime,
  formatResetTime,
  formatUsageAriaLabel,
  formatUsageTierLabel,
  toDisplayUsagePercentage,
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
  usageDisplayMode = "used",
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
  usageDisplayMode?: UsageDisplayMode;
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
    <div className={`profile-row relative grid grid-cols-[minmax(260px,1fr)_320px_152px] items-center gap-3 px-5 py-4 text-sm ${profile.isCurrent ? "profile-row-current" : "bg-transparent"}`}>
      <div className="flex min-w-0 items-start gap-3.5">
        <div
          className={`account-slot mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center ${profile.isCurrent ? "account-slot-current text-emerald-700" : "text-neutral-500"}`}
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
            {profile.isCurrent ? <span className="current-seal ml-1">当前</span> : null}
            {!profile.exists ? <span className="status-pill bg-amber-100 text-amber-800">{toolLabels.missingLabel}</span> : null}
          </div>
          {hasAlternateDisplayName ? (
            <div className="mt-1 truncate font-mono text-[10px] tracking-[0.04em] text-neutral-500" title={profile.name}>
              {profile.name}
            </div>
          ) : null}
          {isGeminiTool && profile.oauthPath ? (
            <div className="mt-1 flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-[10px] text-neutral-500" title={profile.oauthPath}>
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
      <UsageCell
        selectedTool={selectedTool}
        profile={profile}
        usage={usage}
        usageDisplayMode={usageDisplayMode}
        isRefreshing={isRefreshingUsage}
        onRefresh={onRefreshUsage}
      />
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
  selectedTool,
  profile,
  usage,
  usageDisplayMode,
  isRefreshing,
  onRefresh
}: {
  selectedTool: TargetTool;
  profile: ProfileInfo;
  usage?: ProfileUsageResult;
  usageDisplayMode: UsageDisplayMode;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const isAntigravity = selectedTool === "antigravity-cli";
  if (!profile.exists) {
    return <div className="text-xs text-neutral-500">{isAntigravity ? "无登录凭据" : "无 OAuth 文件"}</div>;
  }

  const isPending = isRefreshing || (isAntigravity && !usage);

  if (isPending) {
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
        <UsageSummary selectedTool={selectedTool} usage={usage} usageDisplayMode={usageDisplayMode} onRefresh={onRefresh} />
      ) : (
        <div className="flex items-center justify-start gap-3">
          <UsageRefreshButton label="查询用量" onRefresh={onRefresh} />
          <span className="text-xs text-neutral-500">未查询</span>
        </div>
      )}
    </div>
  );
}

function UsageSummary({
  selectedTool,
  usage,
  usageDisplayMode,
  onRefresh
}: {
  selectedTool: TargetTool;
  usage: ProfileUsageResult;
  usageDisplayMode: UsageDisplayMode;
  onRefresh: () => void;
}) {
  if (!usage.success) {
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-semibold text-red-600" title={usage.error}>
          {describeUsageFailure(usage, selectedTool)}
        </div>
        <UsageRefreshButton label="重试" onRefresh={onRefresh} />
      </div>
    );
  }

  const groups = usage.groups ?? [];
  if (usage.tiers.length === 0 && groups.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-500">暂无用量数据</span>
        <UsageRefreshButton label="重新查询" onRefresh={onRefresh} />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {groups.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          {groups.map((group) => (
            <UsageGroupBlock key={group.name} group={group} usageDisplayMode={usageDisplayMode} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {usage.tiers.map((tier) => (
            <UsageTierBar key={tier.name} tier={tier} usageDisplayMode={usageDisplayMode} />
          ))}
        </div>
      )}
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

function UsageGroupBlock({ group, usageDisplayMode }: { group: UsageGroup; usageDisplayMode: UsageDisplayMode }) {
  return (
    <div className="min-w-0" title={group.description}>
      <div className="mb-1.5 truncate font-mono text-[10px] font-semibold text-neutral-700">{group.label}</div>
      <div className="space-y-1.5">
        {group.tiers.map((tier) => (
          <CompactUsageTierBar key={tier.name} tier={tier} groupLabel={group.label} usageDisplayMode={usageDisplayMode} />
        ))}
      </div>
    </div>
  );
}

function CompactUsageTierBar({
  tier,
  groupLabel,
  usageDisplayMode
}: {
  tier: UsageTier;
  groupLabel: string;
  usageDisplayMode: UsageDisplayMode;
}) {
  const percentage = toDisplayUsagePercentage(tier.utilization, usageDisplayMode);
  const displayLabel = formatUsageTierLabel(tier.label, usageDisplayMode);
  const resetText = formatResetTime(tier.resetsAt);
  const ariaLabel = formatUsageAriaLabel([groupLabel, displayLabel], percentage, usageDisplayMode);
  const title = resetText ? `${groupLabel} ${displayLabel} · ${percentage}% · ${resetText}` : `${groupLabel} ${displayLabel} · ${percentage}%`;

  return (
    <div className="grid min-w-0 grid-cols-[20px_minmax(44px,1fr)_32px] items-center gap-1.5 font-mono text-[10px] leading-none text-neutral-700" title={title}>
      {/* Narrow column keeps short bucket keys; full mode wording lives in title/aria. */}
      <span title={displayLabel}>{tier.label}</span>
      <div className="quota-track">
        <div
          className={`quota-fill ${usageBarClass(tier.utilization)}`}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
        />
      </div>
      <span className="text-right font-semibold text-neutral-800">{percentage}%</span>
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

function UsageTierBar({ tier, usageDisplayMode }: { tier: UsageTier; usageDisplayMode: UsageDisplayMode }) {
  const percentage = toDisplayUsagePercentage(tier.utilization, usageDisplayMode);
  const displayLabel = formatUsageTierLabel(tier.label, usageDisplayMode);
  const resetText = formatResetTime(tier.resetsAt);
  const ariaLabel = formatUsageAriaLabel([displayLabel], percentage, usageDisplayMode);

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-[78px_minmax(96px,1fr)_36px] items-center gap-2 font-mono text-[11px] leading-none text-neutral-700">
        <span className="whitespace-nowrap" title={displayLabel}>
          {displayLabel}
        </span>
        <div className="quota-track">
          <div
            className={`quota-fill ${usageBarClass(tier.utilization)}`}
            style={{ width: `${percentage}%` }}
            role="progressbar"
            aria-label={ariaLabel}
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
