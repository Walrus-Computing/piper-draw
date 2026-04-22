import { useBlockStore } from "../stores/blockStore";
import { bindingToLabel, useKeybindStore } from "../stores/keybindStore";
import { HintBar, CustomizeLink } from "./HintBar";

export function BuildModeHints({ onCustomize }: { onCustomize: () => void }) {
  const mode = useBlockStore((s) => s.mode);
  const viewMode = useBlockStore((s) => s.viewMode);
  const b = useKeybindStore((s) => s.bindings.build);
  const axisAbsoluteWasd = useKeybindStore((s) => s.axisAbsoluteWasd);
  if (mode !== "build") return null;

  // Iso mode uses axis-absolute WASD per the active slice plane; persp mode
  // follows the axisAbsoluteWasd toggle (camera-relative vs world-aligned).
  let moveLabel: string;
  let depthLabel: string;
  if (viewMode.kind === "iso") {
    if (viewMode.axis === "x") { moveLabel = "Move YZ"; depthLabel = "Move X"; }
    else if (viewMode.axis === "y") { moveLabel = "Move XZ"; depthLabel = "Move Y"; }
    else { moveLabel = "Move XY"; depthLabel = "Move Z"; }
  } else {
    moveLabel = axisAbsoluteWasd ? "Move ±X / ±Y" : "Move XY";
    depthLabel = "Move Z";
  }
  const hints: Array<readonly [string, string]> = [
    ["Click cube", "Move cursor here"],
    [
      `${bindingToLabel(b.moveForward)}/${bindingToLabel(b.moveLeft)}/${bindingToLabel(b.moveBack)}/${bindingToLabel(b.moveRight)}`,
      moveLabel,
    ],
    [`${bindingToLabel(b.moveUp)}/${bindingToLabel(b.moveDown)}`, depthLabel],
    [bindingToLabel(b.cycleBlock), "Cycle block"],
    [bindingToLabel(b.cyclePipe), "Cycle pipe"],
    [bindingToLabel(b.exitBuild), "Exit build"],
  ];

  return <HintBar hints={hints} trailing={<CustomizeLink onClick={onCustomize} />} />;
}
