import { RefreshCw, X } from "lucide-react";
import type { MouseEvent } from "react";
import type { OAuthLoginInspectResult, OAuthLoginSession, TargetTool } from "../../shared/types";
import { TOOL_LABELS } from "../constants";
import type { StatusMessage } from "../types";
import { buildProfileLoginPreview } from "../utils";
import { PathLine, SettingsStatusBar } from "./StatusBar";

export function OAuthLoginDialog({
  selectedTool,
  profilesRoot,
  session,
  inspection,
  existingProfileNames,
  status,
  profileNameDraft,
  nicknameDraft,
  isStarting,
  isInspecting,
  isSaving,
  isCancelling,
  onStart,
  onInspect,
  onProfileNameChange,
  onNicknameChange,
  onSave,
  onClose,
  onBackdropClick
}: {
  selectedTool: TargetTool;
  profilesRoot: string;
  session?: OAuthLoginSession;
  inspection?: OAuthLoginInspectResult;
  existingProfileNames: string[];
  status: StatusMessage;
  profileNameDraft: string;
  nicknameDraft: string;
  isStarting: boolean;
  isInspecting: boolean;
  isSaving: boolean;
  isCancelling: boolean;
  onStart: () => void;
  onInspect: () => void;
  onProfileNameChange: (value: string) => void;
  onNicknameChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
  onBackdropClick: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const isBusy = isStarting || isInspecting || isSaving || isCancelling;
  const toolLabels = TOOL_LABELS[selectedTool];
  const credentialLabel = selectedTool === "antigravity-cli" ? "登录凭据" : "OAuth 文件";
  const trimmedProfileName = profileNameDraft.trim();
  const hasExistingProfileName = Boolean(trimmedProfileName && existingProfileNames.includes(trimmedProfileName));
  const hasOriginalConflict = Boolean(inspection?.conflictProfileName && trimmedProfileName === inspection.conflictProfileName);
  const duplicateProfileName = hasExistingProfileName ? trimmedProfileName : hasOriginalConflict ? inspection?.conflictProfileName : undefined;
  const canSave = Boolean(session && inspection?.oauthExists && trimmedProfileName && !duplicateProfileName) && !isBusy;
  const savePathPreview = buildProfileLoginPreview(profilesRoot, trimmedProfileName, selectedTool);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/35 px-4 py-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="oauth-login-dialog-title"
      onMouseDown={onBackdropClick}
    >
      <section className="parchment-dialog flex max-h-[calc(100vh-2.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-md">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-300 px-5 py-4">
          <div>
            <h2 id="oauth-login-dialog-title" className="text-lg font-semibold text-neutral-950">新增 {toolLabels.shortName} 登录</h2>
            <p className="mt-1 text-sm text-neutral-600">先隔离登录，成功后检测 {credentialLabel} 并保存为 profile。</p>
          </div>
          <button className="copy-icon-button" onClick={onClose} disabled={isBusy} aria-label="关闭登录新账号" title="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          <section className="rounded-md border border-neutral-300 bg-white/75 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-neutral-900">开始登录</div>
                <p className="mt-1 text-sm leading-6 text-neutral-600">
                  会先创建临时登录目录，登录成功后再保存到账号列表。
                </p>
              </div>
              <button className="primary-button" onClick={onStart} disabled={isBusy || Boolean(session)}>
                <RefreshCw className={isStarting ? "h-4 w-4 animate-spin" : "hidden"} />
                {session ? "登录窗口已打开" : isStarting ? "打开中..." : "打开登录窗口"}
              </button>
            </div>
          </section>

          <section className="rounded-md border border-neutral-900/80 bg-neutral-950 px-4 py-3 font-mono text-sm text-neutral-100">
            <div className="text-emerald-400">&gt; 登录状态</div>
            <TerminalLine label="窗口" value={session ? "已打开" : "等待开始"} />
            <TerminalLine label="凭据" value={inspection?.oauthExists ? `已检测到 ${credentialLabel}` : "等待检测"} />
            <TerminalLine
              label="识别"
              value={inspection?.accountEmail ? inspection.accountEmail : inspection?.oauthExists ? "未识别邮箱" : `等待 ${credentialLabel}`}
              valueClassName={inspection?.accountEmail ? "text-emerald-300" : "text-neutral-100"}
            />
          </section>

          <SettingsStatusBar status={status} />

          {inspection?.oauthExists ? (
            <section className="rounded-md border border-neutral-300 bg-white/75 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-neutral-800" htmlFor="oauth-profile-name">
                    保存名称
                  </label>
                  <input
                    id="oauth-profile-name"
                    className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none transition focus:border-neutral-800 focus:ring-2 focus:ring-neutral-800/10"
                    value={profileNameDraft}
                    onChange={(event) => onProfileNameChange(event.target.value)}
                    disabled={isSaving}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-neutral-800" htmlFor="oauth-nickname">
                    昵称
                  </label>
                  <input
                    id="oauth-nickname"
                    className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-800 focus:ring-2 focus:ring-neutral-800/10"
                    value={nicknameDraft}
                    onChange={(event) => onNicknameChange(event.target.value)}
                    disabled={isSaving}
                    placeholder="可选"
                  />
                </div>
              </div>
              {inspection.accountEmail ? (
                <div className="mt-3 text-sm text-neutral-700">
                  识别到账号：<span className="font-mono font-semibold text-neutral-950">{inspection.accountEmail}</span>
                </div>
              ) : null}
              {duplicateProfileName ? (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  已存在同名账号目录：{duplicateProfileName}
                </div>
              ) : null}
              <PathLine label="保存到" value={savePathPreview || inspection.targetProfilePath || ""} />
            </section>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-300 px-5 py-4">
          <button className="tool-button" onClick={onClose} disabled={isBusy}>
            {isCancelling ? "清理中..." : "取消"}
          </button>
          <button className="tool-button" onClick={onInspect} disabled={!session || isBusy}>
            <RefreshCw className={isInspecting ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            重新检测
          </button>
          <button className="primary-button" onClick={onSave} disabled={!canSave}>
            <RefreshCw className={isSaving ? "h-4 w-4 animate-spin" : "hidden"} />
            {isSaving ? "保存中..." : "保存到账号列表"}
          </button>
        </div>
      </section>
    </div>
  );
}

function TerminalLine({ label, value, valueClassName = "text-neutral-100" }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="mt-2 flex min-w-0 items-baseline gap-2">
      <span className="w-16 shrink-0 text-neutral-400">{label}</span>
      <span className="text-neutral-500">:</span>
      <span className={`min-w-0 truncate ${valueClassName}`} title={value}>
        {value}
      </span>
    </div>
  );
}
