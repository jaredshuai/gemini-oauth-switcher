import { Trash2, X } from "lucide-react";
import { useModalBehavior } from "./useModalBehavior";

export function ConfirmDialog({
  title,
  bodyLines,
  confirmLabel,
  onConfirm,
  onClose
}: {
  title: string;
  bodyLines: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useModalBehavior({ onClose });

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-950/35 px-4 py-10" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <section className="parchment-dialog w-full max-w-lg rounded-md p-5">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-300 pb-4">
          <h2 id="confirm-dialog-title" className="text-lg font-semibold text-neutral-950">{title}</h2>
          <button className="copy-icon-button" onClick={onClose} aria-label="关闭确认对话框" title="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pt-4">
          {bodyLines.map((line) => (
            <p key={line} className="mt-2 break-all text-sm leading-6 text-neutral-600 first:mt-0">{line}</p>
          ))}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="tool-button" onClick={onClose} data-dialog-autofocus>
              取消
            </button>
            <button type="button" className="danger-button" onClick={onConfirm}>
              <Trash2 className="h-4 w-4" />
              {confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
