import { Clock, Copy, Pencil, RefreshCw, Shuffle, Trash2 } from "lucide-react";
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
  const displayName = nickname || profile.name;
  const isGeminiTool = selectedTool === "gemini";
  const toolLabels = TOOL_LABELS[selectedTool];

  return (
    <div className="grid grid-cols-[minmax(260px,1fr)_320px_156px] items-center gap-3 px-5 py-4 text-sm">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${profile.isCurrent ? "bg-emerald-500" : "bg-neutral-300"}`}
          title={profile.isCurrent ? "当前账号" : "可切换账号"}
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate font-semibold text-neutral-950" title={profile.oauthPath}>
              {displayName}
            </span>
            <button className="copy-icon-button" onClick={onCopyName} aria-label={`复制 ${profile.name}`} title="复制完整 profile 名称">
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button className="copy-icon-button" onClick={onSetNickname} aria-label={`设置 ${profile.name} 的昵称`} title="设置昵称">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {profile.isCurrent ? <span className="status-pill bg-emerald-100 text-emerald-800">当前</span> : null}
            {!profile.exists ? <span className="status-pill bg-amber-100 text-amber-800">{toolLabels.missingLabel}</span> : null}
          </div>
          {nickname ? (
            <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-500" title={profile.name}>
              {profile.name}
            </div>
          ) : null}
          {profile.oauthPath ? (
            <div className="mt-1 flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-[11px] text-neutral-400" title={profile.oauthPath}>
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
        {isGeminiTool ? (
          <button
            className="danger-icon-button"
            onClick={onDelete}
            disabled={profile.isCurrent || isDeleteDisabled}
            aria-label={`删除 ${profile.name}`}
            title={profile.isCurrent ? "当前账号不能删除，请先切换到其他账号" : "删除 profile 到回收站"}
          >
            <Trash2 className={isDeleting ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
          </button>
        ) : null}
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
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        登录凭据已就绪
      </div>
      {profile.updatedAtMs ? (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-neutral-500">
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
