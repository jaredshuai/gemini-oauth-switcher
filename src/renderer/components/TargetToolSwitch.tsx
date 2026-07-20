import { ArrowLeftRight } from "lucide-react";
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
  const nextTool = tools[(currentIndex + 1) % tools.length];

  return (
    <div className="mode-loadout" role="group" aria-label={`目标工具,当前为 ${TOOL_LABELS[selectedTool].name}`}>
      <span key={selectedTool} className="mode-loadout-track">
        <button
          type="button"
          className="mode-loadout-slot mode-loadout-active"
          aria-current="true"
          disabled={disabled}
          onClick={() => void onChange(selectedTool)}
          title={`当前工具:${TOOL_LABELS[selectedTool].name}`}
        >
          <span className="mode-loadout-sigil" aria-hidden="true">I</span>
          <span className="mode-loadout-name">
            {TOOL_LABELS[selectedTool].shortName}
          </span>
        </button>
        <span className="mode-loadout-swap" aria-hidden="true">
          <ArrowLeftRight className="h-[18px] w-[18px]" />
        </span>
        <button
          type="button"
          className="mode-loadout-slot mode-loadout-secondary"
          disabled={disabled}
          onClick={() => void onChange(nextTool)}
          aria-label={`切换到 ${TOOL_LABELS[nextTool].name}`}
          title={`切换到 ${TOOL_LABELS[nextTool].name}`}
        >
          <span className="mode-loadout-sigil" aria-hidden="true">II</span>
          <span className="mode-loadout-name">
            {TOOL_LABELS[nextTool].shortName}
          </span>
        </button>
      </span>
    </div>
  );
}
