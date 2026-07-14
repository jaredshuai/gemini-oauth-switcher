import { RefreshCw, X } from "lucide-react";
import type { ProfileInfo } from "../../shared/types";
import { useModalBehavior } from "./useModalBehavior";

export function NicknameDialog({
  profile,
  value,
  isSaving,
  onChange,
  onSave,
  onClose
}: {
  profile: ProfileInfo;
  value: string;
  isSaving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const dialogRef = useModalBehavior({ onClose, closeDisabled: isSaving });

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-950/35 px-4 py-10" role="dialog" aria-modal="true" aria-labelledby="nickname-dialog-title">
      <section className="parchment-dialog w-full max-w-lg rounded-md p-5">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-300 pb-4">
          <h2 id="nickname-dialog-title" className="text-lg font-semibold text-neutral-950">设置昵称</h2>
          <button className="copy-icon-button" onClick={onClose} disabled={isSaving} aria-label="关闭昵称设置" title="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          className="pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isSaving) {
              onSave();
            }
          }}
        >
          <label className="text-sm font-semibold text-neutral-800" htmlFor="profile-nickname">
            昵称
          </label>
          <input
            id="profile-nickname"
            autoFocus
            className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-800 focus:ring-2 focus:ring-neutral-800/10"
            placeholder="例如 Work、Personal、公司账号"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <div className="mt-2 truncate font-mono text-xs text-neutral-500" title={profile.name}>
            {profile.name}
          </div>
          <p className="mt-3 text-sm leading-6 text-neutral-600">昵称只影响界面显示。留空保存会恢复为原始 profile 目录名。</p>

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="tool-button" onClick={onClose} disabled={isSaving}>
              取消
            </button>
            <button type="submit" className="primary-button" disabled={isSaving}>
              <RefreshCw className={isSaving ? "h-4 w-4 animate-spin" : "hidden"} />
              {isSaving ? "保存中..." : value.trim() ? "保存昵称" : "恢复目录名"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
