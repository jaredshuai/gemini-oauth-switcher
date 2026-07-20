import { CircleAlert, KeyRound, ListChecks, ShieldCheck, SquareTerminal, TriangleAlert, UserPlus } from "lucide-react";
import type { LastSwitchResult, LocalDiagnosticsResult, ProfileInfo, TargetTool } from "../../shared/types";
import { TOOL_LABELS } from "../constants";
import { formatSwitchRelativeTime, shouldCompactAccountStatus } from "../utils";

export function CurrentAccountPanel({
  selectedTool,
  currentProfile,
  displayName,
  hasUnmatchedTarget,
  lastSwitch,
  localDiagnostics,
  isRegisteringCurrent,
  onRegisterCurrent
}: {
  selectedTool: TargetTool;
  currentProfile?: ProfileInfo;
  displayName?: string;
  hasUnmatchedTarget: boolean;
  lastSwitch?: LastSwitchResult;
  localDiagnostics?: LocalDiagnosticsResult;
  isRegisteringCurrent: boolean;
  onRegisterCurrent: () => void;
}) {
  const toolLabels = TOOL_LABELS[selectedTool];
  const accountName = displayName ?? currentProfile?.name;
  const validationText = currentProfile
    ? `${toolLabels.targetLabel} 已与该账号匹配`
    : hasUnmatchedTarget
      ? `${toolLabels.targetLabel} 存在，但尚未登记`
      : `${toolLabels.targetLabel} 尚未设置`;
  const nextStepText = currentProfile
    ? `新开 PowerShell，运行 ${toolLabels.command}`
    : hasUnmatchedTarget
      ? selectedTool === "antigravity-cli" ? "登记当前账号，或新增其他登录" : "登记当前账号，或切换到列表账号"
      : "从账号列表中选择并切换";
  const compactStatus = shouldCompactAccountStatus(selectedTool, Boolean(currentProfile), localDiagnostics);

  return (
    <section className="py-3.5">
      <aside className="credential-console overflow-hidden rounded-md bg-neutral-950 text-sm text-neutral-100">
        <div className={`grid lg:grid-cols-[minmax(340px,0.82fr)_minmax(520px,1.18fr)] ${compactStatus ? "min-h-[172px]" : "min-h-[212px]"}`}>
          <div className={`relative flex min-w-0 flex-col justify-between px-7 lg:border-r lg:border-neutral-800/80 ${compactStatus ? "py-4" : "py-5"}`}>
            <div>
              <div className={`flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] ${currentProfile ? "text-emerald-400" : "text-amber-300"}`}>
                {currentProfile ? <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.10)]" /> : <TriangleAlert className="h-4 w-4" />}
                当前身份
              </div>

              <div className="mt-3 flex min-w-0 items-end gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md border ${currentProfile ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-amber-300/30 bg-amber-300/10 text-amber-200"}`}
                >
                  <KeyRound className="h-5 w-5" />
                </div>
                <div className="min-w-0 pb-0.5">
                  <div className={`max-h-[58px] overflow-hidden break-all font-mono text-[23px] font-semibold leading-[1.12] ${currentProfile ? "text-white" : "text-amber-100"}`} title={accountName}>
                    {accountName || (hasUnmatchedTarget ? "未登记账号" : "未选择账号")}
                  </div>
                  {currentProfile && displayName !== currentProfile.name ? (
                    <div className="mt-1.5 truncate font-mono text-[11px] text-neutral-400" title={currentProfile.name}>
                      {selectedTool === "gemini" ? "目录" : "账号"} / {currentProfile.name}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={`${compactStatus ? "mt-3" : "mt-5"} flex items-start gap-2 text-sm font-semibold text-neutral-200`}>
                {currentProfile ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />}
                <span>{validationText}</span>
              </div>
            </div>

            <div className={`${compactStatus ? "mt-3" : "mt-5"} flex flex-wrap items-center gap-3`}>
              <div className="flex items-center gap-2 font-mono text-xs text-neutral-400">
                <SquareTerminal className="h-3.5 w-3.5" />
                <span>{nextStepText}</span>
              </div>
              {hasUnmatchedTarget ? (
                <button
                  className="console-action-button"
                  onClick={onRegisterCurrent}
                  disabled={isRegisteringCurrent}
                >
                  <UserPlus className={isRegisteringCurrent ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
                  {isRegisteringCurrent ? "正在登记" : "登记当前账号"}
                </button>
              ) : null}
            </div>
          </div>

          <AccountStatusPanel
            selectedTool={selectedTool}
            currentProfile={currentProfile}
            displayName={displayName}
            lastSwitch={lastSwitch}
            localDiagnostics={localDiagnostics}
            compact={compactStatus}
          />
        </div>
      </aside>
    </section>
  );
}

function AccountStatusPanel({
  selectedTool,
  currentProfile,
  displayName,
  lastSwitch,
  localDiagnostics,
  compact
}: {
  selectedTool: TargetTool;
  currentProfile?: ProfileInfo;
  displayName?: string;
  lastSwitch?: LastSwitchResult;
  localDiagnostics?: LocalDiagnosticsResult;
  compact: boolean;
}) {
  const lastSwitchName = lastSwitch
    ? lastSwitch.profileName === currentProfile?.name
      ? displayName ?? currentProfile.name
      : lastSwitch.profileName
    : undefined;
  const envRisks = localDiagnostics?.envRisks ?? [];

  if (compact) {
    return (
      <div className="flex min-w-0 flex-col justify-center border-t border-neutral-800/80 px-7 py-4 lg:border-t-0">
        {lastSwitch && lastSwitchName ? (
          <InfoBlock
            label="最近切换"
            value={`${formatSwitchRelativeTime(lastSwitch.switchedAt)} / ${lastSwitchName}`}
            tone="normal"
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col border-t border-neutral-800/80 px-7 py-5 lg:border-t-0">
      <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
        <ListChecks className="h-3.5 w-3.5" />
        状态检查
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-4 border-y border-neutral-800/80 py-4 sm:grid-cols-2">
        <InfoBlock
          label="最近切换"
          value={lastSwitch && lastSwitchName ? `${formatSwitchRelativeTime(lastSwitch.switchedAt)} / ${lastSwitchName}` : "暂无记录"}
          tone={lastSwitch ? "normal" : "muted"}
        />
        <InfoBlock
          label="切换结果"
          value={lastSwitch?.verified ? "切换校验通过" : currentProfile ? "当前账号已匹配" : "尚未完成切换"}
          tone={lastSwitch?.verified ? "success" : "muted"}
        />
      </div>

      <div className="mt-4">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">本机环境</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {localDiagnostics ? (
            <>
              {envRisks.length > 0 ? envRisks.map((risk) => <RiskChip key={risk} tone="warning" label={risk} />) : <RiskChip tone="success" label="无环境变量风险" />}
              {selectedTool === "gemini" ? (
                <RiskChip tone={localDiagnostics.geminiCommand.available ? "success" : "warning"} label={localDiagnostics.geminiCommand.available ? "Gemini CLI 可用" : "Gemini CLI 不可用"} />
              ) : null}
            </>
          ) : (
            <RiskChip tone="muted" label="检查中" />
          )}
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ label, value, tone }: { label: string; value: string; tone: "success" | "normal" | "muted" }) {
  const valueClass = tone === "success" ? "text-emerald-300" : tone === "normal" ? "text-neutral-300" : "text-neutral-400";
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">{label}</div>
      <div className={`mt-1 truncate text-xs font-semibold ${valueClass}`} title={value}>{value}</div>
    </div>
  );
}

function RiskChip({ tone, label }: { tone: "success" | "warning" | "muted"; label: string }) {
  const className =
    tone === "success"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
      : tone === "warning"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
        : "border-neutral-800 bg-white/[0.03] text-neutral-400";

  return <span className={`inline-flex items-center rounded border px-2 py-1 font-mono text-[10px] font-semibold ${className}`}>{label}</span>;
}
