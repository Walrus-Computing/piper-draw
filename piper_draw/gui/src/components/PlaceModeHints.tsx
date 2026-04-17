import { useBlockStore } from "../stores/blockStore";
import { bindingToLabel, useKeybindStore } from "../stores/keybindStore";
import { HintBar, CustomizeLink } from "./HintBar";

export function PlaceModeHints({ onCustomize }: { onCustomize: () => void }) {
  const mode = useBlockStore((s) => s.mode);
  const viewMode = useBlockStore((s) => s.viewMode);
  const b = useKeybindStore((s) => s.bindings.place);
  if (mode !== "place") return null;

  const isIso = viewMode.kind === "iso";
  const hints: Array<readonly [string, string]> = [
    ["Click", "Place block"],
    ["Drag", "Pan"],
    ...(isIso ? [] : [["Shift+Drag", "Rotate"] as const]),
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
