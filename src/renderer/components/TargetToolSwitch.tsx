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
    <div className="flex items-center gap-1" aria-label="切换目标工具">
      <div className="flex flex-col">
        <button
          className="copy-icon-button h-4"
          onClick={() => void onChange(prevTool)}
          disabled={disabled}
          aria-label={`切换到 ${TOOL_LABELS[prevTool].name}`}
          title={`切换到 ${TOOL_LABELS[prevTool].name}`}
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          className="copy-icon-button h-4"
          onClick={() => void onChange(nextTool)}
          disabled={disabled}
          aria-label={`切换到 ${TOOL_LABELS[nextTool].name}`}
          title={`切换到 ${TOOL_LABELS[nextTool].name}`}
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
      <span>{TOOL_LABELS[selectedTool].shortName}</span>
    </div>
  );
}
