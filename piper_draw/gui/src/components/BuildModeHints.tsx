import { useBlockStore } from "../stores/blockStore";
import { bindingToLabel, useKeybindStore } from "../stores/keybindStore";
import { HintBar, CustomizeLink } from "./HintBar";

export function BuildModeHints({ onCustomize }: { onCustomize: () => void }) {
  const mode = useBlockStore((s) => s.mode);
  const viewMode = useBlockStore((s) => s.viewMode);
  const b = useKeybindStore((s) => s.bindings.build);
  const axisAbsoluteWasd = useKeybindStore((s) => s.axisAbsoluteWasd);
  const navStyle = useKeybindStore((s) => s.navStyle);
  if (mode !== "build") return null;

  const isIso = viewMode.kind === "iso";
  const moveLabel = axisAbsoluteWasd ? "Move ±X / ±Y" : "Move XY";
  const dragRotates = !isIso && navStyle === "rotate";
  const hints: Array<readonly [string, string]> = [
    ["Click cube", "Move cursor here"],
    ["Drag", dragRotates ? "Rotate" : "Pan"],
    ...(isIso ? [] : [["Shift+Drag", dragRotates ? "Pan" : "Rotate"] as const]),
    ["Scroll", "Zoom"],
    [
      `${bindingToLabel(b.moveForward)}/${bindingToLabel(b.moveLeft)}/${bindingToLabel(b.moveBack)}/${bindingToLabel(b.moveRight)}`,
      moveLabel,
    ],
    [`${bindingToLabel(b.moveUp)}/${bindingToLabel(b.moveDown)}`, "Move Z"],
    [bindingToLabel(b.undo), "Undo step"],
    [bindingToLabel(b.cycleBlock), "Cycle block"],
    [bindingToLabel(b.cyclePipe), "Cycle pipe"],
    [bindingToLabel(b.exitBuild), "Exit build"],
  ];

  return <HintBar hints={hints} trailing={<CustomizeLink onClick={onCustomize} />} />;
}
