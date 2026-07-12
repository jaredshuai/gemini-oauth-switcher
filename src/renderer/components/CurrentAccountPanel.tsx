import { Shuffle, TriangleAlert, UserPlus } from "lucide-react";
import type { LastSwitchResult, LocalDiagnosticsResult, ProfileInfo, TargetTool } from "../../shared/types";
import { TOOL_LABELS } from "../constants";
import { formatSwitchRelativeTime } from "../utils";

export function CurrentAccountPanel({
  selectedTool,
  currentProfile,
  displayName,
  hasUnmatchedTarget,
  hasTargetOAuth,
  lastSwitch,
  localDiagnostics,
  isRegisteringCurrent,
  onRegisterCurrent
}: {
  selectedTool: TargetTool;
  currentProfile?: ProfileInfo;
  displayName?: string;
  hasUnmatchedTarget: boolean;
  hasTargetOAuth: boolean;
  lastSwitch?: LastSwitchResult;
  localDiagnostics?: LocalDiagnosticsResult;
  isRegisteringCurrent: boolean;
  onRegisterCurrent: () => void;
}) {
  const toolLabels = TOOL_LABELS[selectedTool];
  const validationText = currentProfile
    ? `${toolLabels.targetLabel} 已与该 profile 匹配`
    : hasUnmatchedTarget
      ? `${toolLabels.targetLabel} 存在，但不属于账号列表`
      : `${toolLabels.targetLabel} 未设置`;
  const nextStepText = currentProfile
    ? `新开 PowerShell 后运行 ${toolLabels.command} 即使用该${toolLabels.fileLabel}`
    : selectedTool === "antigravity-cli" && hasUnmatchedTarget
      ? "点击登记当前账号，或通过新增登录添加其他账号"
      : "从下方列表选择账号并点击切换";

  return (
    <section className="py-3.5">
      <aside className="rounded-md border border-neutral-900/80 bg-neutral-950 px-6 py-4 text-sm text-neutral-100 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[minmax(360px,0.62fr)_minmax(420px,1fr)] md:items-center">
          <div className="min-w-0 md:py-1">
            {currentProfile ? (
              <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                当前生效
              </div>
            ) : (
              <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
                <TriangleAlert className="h-4 w-4" />
                当前生效
              </div>
            )}
            {currentProfile ? (
              <>
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    className="min-w-0 truncate font-mono text-[28px] font-semibold leading-tight text-white"
                    title={displayName ?? currentProfile.name}
                  >
                    {displayName ?? currentProfile.name}
                  </span>
                  <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                    已生效
                  </span>
                </div>
                {displayName !== currentProfile.name ? (
                  <div className="mt-1 truncate font-mono text-xs text-neutral-400" title={currentProfile.name}>
                    {selectedTool === "gemini" ? "目录名" : "账号名称"}：{currentProfile.name}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="mt-3 font-mono text-[24px] font-semibold leading-tight text-amber-100">
                {hasUnmatchedTarget ? "未匹配到账号" : "未设置账号"}
              </div>
            )}
            <div className="mt-3.5 flex items-center gap-2 text-sm font-semibold text-neutral-200">
              <span className={currentProfile ? "text-emerald-400" : "text-amber-300"}>{currentProfile ? "✓" : "!"}</span>
              {validationText}
            </div>
            <div className="mt-2 flex items-center gap-2 font-mono text-xs text-neutral-500">
              <span>&gt;_</span>
              <span>{nextStepText}</span>
            </div>
            {selectedTool === "antigravity-cli" && hasUnmatchedTarget ? (
              <button
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={onRegisterCurrent}
                disabled={isRegisteringCurrent}
              >
                <UserPlus className={isRegisteringCurrent ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
                {isRegisteringCurrent ? "正在登记" : "登记当前账号"}
              </button>
            ) : null}
          </div>

          <SwitchReceiptPanel
            selectedTool={selectedTool}
            currentProfile={currentProfile}
            displayName={displayName}
            hasTargetOAuth={hasTargetOAuth}
            lastSwitch={lastSwitch}
            localDiagnostics={localDiagnostics}
          />
        </div>
      </aside>
    </section>
  );
}

function SwitchReceiptPanel({
  selectedTool,
  currentProfile,
  displayName,
  hasTargetOAuth,
  lastSwitch,
  localDiagnostics
}: {
  selectedTool: TargetTool;
  currentProfile?: ProfileInfo;
  displayName?: string;
  hasTargetOAuth: boolean;
  lastSwitch?: LastSwitchResult;
  localDiagnostics?: LocalDiagnosticsResult;
}) {
  const toolLabels = TOOL_LABELS[selectedTool];
  const lastSwitchName = lastSwitch
    ? lastSwitch.profileName === currentProfile?.name
      ? displayName ?? currentProfile.name
      : lastSwitch.profileName
    : undefined;
  const targetStatus = currentProfile
    ? `${toolLabels.targetLabel} 属于账号列表`
    : hasTargetOAuth
      ? `${toolLabels.targetLabel} 不属于账号列表`
      : `${toolLabels.targetLabel} 不存在`;
  const envRisks = localDiagnostics?.envRisks ?? [];

  return (
    <div className="min-w-0 border-neutral-800/70 md:border-l md:py-1 md:pl-6">
      <div className="flex items-center gap-2 font-mono text-[13px] font-semibold text-neutral-200">
        <Shuffle className="h-3.5 w-3.5 text-neutral-500" />
        切换回执
      </div>

      <div className="mt-2.5 rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2">
        <div className="text-xs font-semibold text-emerald-200">
          {lastSwitch && lastSwitchName ? `${formatSwitchRelativeTime(lastSwitch.switchedAt)}切换到 ${lastSwitchName}` : "暂无切换记录"}
        </div>
      </div>

      <div className="mt-2.5 space-y-1.5 border-b border-neutral-800/80 pb-2.5">
        <ReceiptLine
          tone={lastSwitch?.verified ? "success" : "muted"}
          text={
            lastSwitch?.verified
              ? selectedTool === "antigravity-cli"
                ? "源凭据与目标凭据 hash 一致"
                : "源文件与目标文件 hash 一致"
              : "尚无切换校验记录"
          }
        />
        <ReceiptLine tone={currentProfile ? "success" : "warning"} text={targetStatus} />
      </div>

      <div className="mt-2.5">
        <div className="text-[11px] font-semibold text-amber-200">本机风险</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {localDiagnostics ? (
            <>
              {envRisks.length > 0 ? (
                envRisks.map((risk) => <RiskChip key={risk} tone="warning" label={risk} />)
              ) : (
                <RiskChip tone="success" label="无环境变量风险" />
              )}
              {selectedTool === "gemini" ? (
                <RiskChip tone={localDiagnostics.geminiCommand.available ? "success" : "warning"} label={localDiagnostics.geminiCommand.available ? "gemini 可用" : "gemini 不可用"} />
              ) : null}
            </>
          ) : (
            <RiskChip tone="muted" label="本机检查中" />
          )}
        </div>
      </div>
    </div>
  );
}

function ReceiptLine({ tone, text }: { tone: "success" | "warning" | "muted"; text: string }) {
  const toneClass =
    tone === "success" ? "text-emerald-300" : tone === "warning" ? "text-amber-300" : "text-neutral-500";
  return (
    <div className="flex items-center gap-2 text-[11px] text-neutral-300">
      <span className={toneClass}>{tone === "success" ? "✓" : tone === "warning" ? "!" : "·"}</span>
      <span>{text}</span>
    </div>
  );
}

function RiskChip({ tone, label }: { tone: "success" | "warning" | "muted"; label: string }) {
  const className =
    tone === "success"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : tone === "warning"
        ? "border-amber-400/35 bg-amber-400/10 text-amber-200"
        : "border-neutral-700 bg-white/[0.04] text-neutral-400";

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${className}`}>
      {label}
    </span>
  );
}
