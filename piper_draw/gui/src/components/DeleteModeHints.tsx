import { useBlockStore } from "../stores/blockStore";
import { bindingToLabel, useKeybindStore } from "../stores/keybindStore";
import { HintBar, CustomizeLink } from "./HintBar";

export function DeleteModeHints({ onCustomize }: { onCustomize: () => void }) {
  const mode = useBlockStore((s) => s.mode);
  const viewMode = useBlockStore((s) => s.viewMode);
  const b = useKeybindStore((s) => s.bindings.delete);
  const navStyle = useKeybindStore((s) => s.navStyle);
  if (mode !== "delete") return null;

  const isIso = viewMode.kind === "iso";
  const dragRotates = !isIso && navStyle === "rotate";
  const hints: Array<readonly [string, string]> = [
    ["Click block", "Delete"],
    ["Drag", dragRotates ? "Rotate" : "Pan"],
    ...(isIso ? [] : [["Shift+Drag", dragRotates ? "Pan" : "Rotate"] as const]),
    ["Scroll", "Zoom"],
    [bindingToLabel(b.undo), "Undo"],
    [bindingToLabel(b.redo), "Redo"],
  ];
  if (isIso) {
    hints.push([
      `${bindingToLabel(b.stepForward)}/${bindingToLabel(b.stepBack)}`,
      `Step in ${viewMode.axis.toUpperCase()} direction`,
    ]);
  }

  return <HintBar hints={hints} trailing={<CustomizeLink onClick={onCustomize} />} />;
}
