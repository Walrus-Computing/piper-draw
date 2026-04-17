import { useBlockStore } from "../stores/blockStore";
import { bindingToLabel, useKeybindStore } from "../stores/keybindStore";
import { HintBar, CustomizeLink } from "./HintBar";
import { altKey } from "./keyLabels";

export function SelectModeHints({ onCustomize }: { onCustomize: () => void }) {
  const mode = useBlockStore((s) => s.mode);
  const viewMode = useBlockStore((s) => s.viewMode);
  const b = useKeybindStore((s) => s.bindings.select);
  if (mode !== "select") return null;

  const isIso = viewMode.kind === "iso";
  const hints: Array<readonly [string, string]> = [
    ["Click", "Select"],
    ["Drag", "Box select"],
    ["Shift+Click", "Add/remove"],
    ["Shift+Drag", "Add to selection"],
    ...(isIso ? [] : [[`${altKey}Drag`, "Orbit"] as const]),
    ["Right Drag", "Pan"],
    ["Scroll", "Zoom"],
    [bindingToLabel(b.selectAll), "Select all"],
    [bindingToLabel(b.undo), "Undo"],
    [bindingToLabel(b.redo), "Redo"],
    [bindingToLabel(b.deleteSelection), "Delete selected"],
    [bindingToLabel(b.clearSelection), "Clear selection"],
  ];
  if (isIso) {
    hints.push([
      `${bindingToLabel(b.stepForward)}/${bindingToLabel(b.stepBack)}`,
      `Step in ${viewMode.axis.toUpperCase()} direction`,
    ]);
  }

  return <HintBar hints={hints} trailing={<CustomizeLink onClick={onCustomize} />} />;
}
