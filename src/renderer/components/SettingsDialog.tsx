import { FolderOpen, RefreshCw, X } from "lucide-react";
import type { RevealTarget, TargetTool, TrayBehavior, UiTheme, UsageDisplayMode } from "../../shared/types";
import { TOOL_LABELS } from "../constants";
import type { StatusMessage } from "../types";
import { PathLine, SettingsStatusBar } from "./StatusBar";

export function SettingsDialog({
  profilesRootDraft,
  selectedTool,
  targetOAuthPath,
  targetGeminiDir,
  profilesRoot,
  trayBehavior,
  autoUpdateEnabled,
  usageDisplayMode,
  uiTheme,
  isSaving,
  isSavingTrayBehavior,
  isSavingAutoUpdate,
  isSavingUsageDisplayMode,
  isSavingUiTheme,
  status,
  onProfilesRootChange,
  onTrayBehaviorChange,
  onAutoUpdateEnabledChange,
  onUsageDisplayModeChange,
  onUiThemeChange,
  onSelectProfilesRoot,
  onSave,
  onReveal,
  onClose
}: {
  profilesRootDraft: string;
  selectedTool: TargetTool;
  targetOAuthPath: string;
  targetGeminiDir: string;
  profilesRoot: string;
  trayBehavior: TrayBehavior;
  autoUpdateEnabled: boolean;
  usageDisplayMode: UsageDisplayMode;
  uiTheme: UiTheme;
  isSaving: boolean;
  isSavingTrayBehavior: boolean;
  isSavingAutoUpdate: boolean;
  isSavingUsageDisplayMode: boolean;
  isSavingUiTheme: boolean;
  status?: StatusMessage;
  onProfilesRootChange: (value: string) => void;
  onTrayBehaviorChange: (value: TrayBehavior) => void | Promise<void>;
  onAutoUpdateEnabledChange: (enabled: boolean) => void | Promise<void>;
  onUsageDisplayModeChange: (mode: UsageDisplayMode) => void | Promise<void>;
  onUiThemeChange: (theme: UiTheme) => void | Promise<void>;
  onSelectProfilesRoot: () => void;
  onSave: () => void;
  onReveal: (target: RevealTarget) => void;
  onClose: () => void;
}) {
  const toolLabels = TOOL_LABELS[selectedTool];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-950/35 px-4 py-10" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
      <section className="parchment-dialog max-h-[calc(100vh-2.5rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-md p-5">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-300 pb-4">
          <h2 id="settings-dialog-title" className="text-lg font-semibold text-neutral-950">设置</h2>
          <button className="copy-icon-button" onClick={onClose} aria-label="关闭设置" title="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pt-4">
          {selectedTool === "gemini" ? (
            <>
              <label className="text-sm font-semibold text-neutral-800" htmlFor="profiles-root">
                Gemini 账号目录
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="profiles-root"
                  className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none transition focus:border-neutral-800 focus:ring-2 focus:ring-neutral-800/10"
                  placeholder="默认 C:\\Users\\<current-user>\\.gemini-homes"
                  value={profilesRootDraft}
                  onChange={(event) => onProfilesRootChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !isSaving) {
                      onSave();
                    }
                    if (event.key === "Escape") {
                      onClose();
                    }
                  }}
                />
                <button className="tool-button" onClick={onSelectProfilesRoot} disabled={isSaving} title="选择账号目录">
                  <FolderOpen className="h-4 w-4" />
                  选择目录
                </button>
                <button className="primary-button" onClick={onSave} disabled={isSaving}>
                  <RefreshCw className={isSaving ? "h-4 w-4 animate-spin" : "hidden"} />
                  {isSaving ? "保存中..." : "保存并扫描"}
                </button>
              </div>
            </>
          ) : null}

          <div className="mt-5">
            <div className="text-sm font-semibold text-neutral-800">界面皮肤</div>
            <p className="mt-1 text-xs text-neutral-500">只改变外观，不影响账号、凭据和用量数据。</p>
            <div className="mt-2 inline-flex overflow-hidden rounded-md border border-neutral-300 bg-white/70 p-1">
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  uiTheme === "classic" ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"
                }`}
                onClick={() => void onUiThemeChange("classic")}
                disabled={isSaving || isSavingUiTheme}
              >
                经典简洁
              </button>
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  uiTheme === "rpg-parchment" ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"
                }`}
                onClick={() => void onUiThemeChange("rpg-parchment")}
                disabled={isSaving || isSavingUiTheme}
              >
                冒险者手记
              </button>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-sm font-semibold text-neutral-800">关闭窗口时</div>
            <div className="mt-2 inline-flex overflow-hidden rounded-md border border-neutral-300 bg-white/70 p-1">
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  trayBehavior === "exit" ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"
                }`}
                onClick={() => void onTrayBehaviorChange("exit")}
                disabled={isSaving || isSavingTrayBehavior}
              >
                直接退出
              </button>
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  trayBehavior === "minimize_to_tray" ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"
                }`}
                onClick={() => void onTrayBehaviorChange("minimize_to_tray")}
                disabled={isSaving || isSavingTrayBehavior}
              >
                隐藏到托盘
              </button>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-sm font-semibold text-neutral-800">自动更新</div>
            <div className="mt-2 inline-flex overflow-hidden rounded-md border border-neutral-300 bg-white/70 p-1">
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  autoUpdateEnabled ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"
                }`}
                onClick={() => void onAutoUpdateEnabledChange(true)}
                disabled={isSaving || isSavingAutoUpdate}
              >
                开启
              </button>
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  !autoUpdateEnabled ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"
                }`}
                onClick={() => void onAutoUpdateEnabledChange(false)}
                disabled={isSaving || isSavingAutoUpdate}
              >
                关闭
              </button>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-sm font-semibold text-neutral-800">用量百分比显示</div>
            <p className="mt-1 text-xs text-neutral-500">Gemini 与 Antigravity 共用；切换后立即作用于已查询的用量。</p>
            <div className="mt-2 inline-flex overflow-hidden rounded-md border border-neutral-300 bg-white/70 p-1">
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  usageDisplayMode === "used" ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"
                }`}
                onClick={() => void onUsageDisplayModeChange("used")}
                disabled={isSaving || isSavingUsageDisplayMode}
              >
                已用百分比
              </button>
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  usageDisplayMode === "remaining" ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"
                }`}
                onClick={() => void onUsageDisplayModeChange("remaining")}
                disabled={isSaving || isSavingUsageDisplayMode}
              >
                剩余百分比
              </button>
            </div>
          </div>

          {status ? <SettingsStatusBar status={status} /> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {selectedTool === "gemini" ? (
              <button className="tool-button" onClick={() => onReveal("profilesRoot")} disabled={!profilesRoot} title="打开 Gemini 账号目录">
                <FolderOpen className="h-4 w-4" />
                打开 Gemini 账号目录
              </button>
            ) : null}
            <button className="tool-button" onClick={() => onReveal(toolLabels.targetReveal)} disabled={!targetGeminiDir} title={`打开 ${toolLabels.name} 目标目录`}>
              <FolderOpen className="h-4 w-4" />
              打开 {toolLabels.shortName} 目录
            </button>
          </div>

          <PathLine label={toolLabels.targetLabel} value={targetOAuthPath} />
        </div>
      </section>
    </div>
  );
}
