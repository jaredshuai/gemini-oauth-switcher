import { Swords } from "lucide-react";
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
    <button
      className="mode-loadout"
      onClick={() => void onChange(nextTool)}
      disabled={disabled}
      aria-label={`切换到 ${TOOL_LABELS[nextTool].name}`}
      title={`切换到 ${TOOL_LABELS[nextTool].name}`}
    >
      <span key={selectedTool} className="mode-loadout-track" aria-hidden="true">
        <span className="mode-loadout-slot mode-loadout-active">
          <span className="mode-loadout-sigil">I</span>
          <span className="mode-loadout-name">
            {TOOL_LABELS[selectedTool].shortName}
          </span>
        </span>
        <span className="mode-loadout-swap">
          <Swords className="h-[18px] w-[18px]" />
        </span>
        <span className="mode-loadout-slot mode-loadout-secondary">
          <span className="mode-loadout-sigil">II</span>
          <span className="mode-loadout-name">
            {TOOL_LABELS[nextTool].shortName}
          </span>
        </span>
      </span>
    </button>
  );
}
