import { useBlockStore } from "../stores/blockStore";
import { bindingToLabel, useKeybindStore } from "../stores/keybindStore";
import { HintBar, CustomizeLink } from "./HintBar";

export function BuildModeHints({ onCustomize }: { onCustomize: () => void }) {
  const mode = useBlockStore((s) => s.mode);
  const b = useKeybindStore((s) => s.bindings.build);
  const axisAbsoluteWasd = useKeybindStore((s) => s.axisAbsoluteWasd);
  if (mode !== "build") return null;

  const moveLabel = axisAbsoluteWasd ? "Move ±X / ±Y" : "Move XY";
  const hints: Array<readonly [string, string]> = [
    ["Click cube", "Move cursor here"],
    [
      `${bindingToLabel(b.moveForward)}/${bindingToLabel(b.moveLeft)}/${bindingToLabel(b.moveBack)}/${bindingToLabel(b.moveRight)}`,
      moveLabel,
    ],
    [`${bindingToLabel(b.moveUp)}/${bindingToLabel(b.moveDown)}`, "Move Z"],
    [bindingToLabel(b.cycleBlock), "Cycle block"],
    [bindingToLabel(b.cyclePipe), "Cycle pipe"],
    [bindingToLabel(b.exitBuild), "Exit build"],
  ];

  return <HintBar hints={hints} trailing={<CustomizeLink onClick={onCustomize} />} />;
}
