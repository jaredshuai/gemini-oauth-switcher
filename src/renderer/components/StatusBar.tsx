import type { StatusMessage, StatusVisibility } from "../types";

function statusToneClass(tone: StatusMessage["tone"], idleClass: string): string {
  return tone === "error"
    ? "border-red-200 bg-red-50 text-red-800"
    : tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : idleClass;
}

export function StatusBar({ status, visibility }: { status: StatusMessage; visibility: StatusVisibility }) {
  const className = statusToneClass(status.tone, "parchment-status text-neutral-700");
  const visibilityClass =
    visibility === "visible"
      ? "max-h-20 py-3 opacity-100"
      : visibility === "fading"
        ? "max-h-20 py-3 opacity-0"
        : "max-h-0 border-transparent py-0 opacity-0";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`overflow-hidden rounded-md border px-4 text-sm transition-[opacity,max-height,padding,border-color] duration-700 ease-in-out ${className} ${visibilityClass}`}
    >
      {status.text}
    </div>
  );
}

export function SettingsStatusBar({ status }: { status: StatusMessage }) {
  const className = statusToneClass(status.tone, "parchment-status text-neutral-700");

  return <div role="status" aria-live="polite" aria-atomic="true" className={`mt-3 rounded-md border px-3 py-2 text-sm ${className}`}>{status.text}</div>;
}

export function PathLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 flex flex-col gap-1 text-xs text-neutral-600">
      <span className="font-semibold uppercase">{label}</span>
      <span className="break-all font-mono text-neutral-700">{value}</span>
    </div>
  );
}
