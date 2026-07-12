import { ChevronDown, ChevronUp } from "lucide-react";
import type { TargetTool } from "../../shared/types";
import { TOOL_LABELS } from "../constants";

export function TargetToolSwitch({
  selectedTool,
  disabled,
  onChange
}: {
  selectedTool: TargetTool;
  disabled: boolean;
  onChange: (targetTool: TargetTool) => void | Promise<void>;
}) {
  const tools: TargetTool[] = ["gemini", "antigravity-cli"];
  const currentIndex = tools.indexOf(selectedTool);
  const prevTool = tools[(currentIndex - 1 + tools.length) % tools.length];
  const nextTool = tools[(currentIndex + 1) % tools.length];

  return (
    <div className="flex items-center gap-2" aria-label="切换目标工具">
      <div className="flex h-9 w-6 flex-col overflow-hidden rounded border border-neutral-300 bg-white/70 shadow-sm">
        <button
          className="flex flex-1 items-center justify-center border-b border-neutral-200 text-neutral-400 transition-colors duration-150 hover:bg-white hover:text-neutral-950 disabled:opacity-40"
          onClick={() => void onChange(prevTool)}
          disabled={disabled}
          aria-label={`切换到 ${TOOL_LABELS[prevTool].name}`}
          title={`切换到 ${TOOL_LABELS[prevTool].name}`}
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          className="flex flex-1 items-center justify-center text-neutral-400 transition-colors duration-150 hover:bg-white hover:text-neutral-950 disabled:opacity-40"
          onClick={() => void onChange(nextTool)}
          disabled={disabled}
          aria-label={`切换到 ${TOOL_LABELS[nextTool].name}`}
          title={`切换到 ${TOOL_LABELS[nextTool].name}`}
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
      <div className="leading-none">
        <span className="block text-xl font-semibold text-neutral-950">{TOOL_LABELS[selectedTool].shortName}</span>
        <span className="mt-1 block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-neutral-400">account route</span>
      </div>
    </div>
  );
}
