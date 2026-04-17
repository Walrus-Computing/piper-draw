import { useBlockStore } from "../stores/blockStore";
import { useKeybindStore } from "../stores/keybindStore";
import { HintBar } from "./HintBar";

export function BuildModeHints({ onCustomize }: { onCustomize: () => void }) {
  const mode = useBlockStore((s) => s.mode);
  const viewMode = useBlockStore((s) => s.viewMode);
  const bindings = useKeybindStore((s) => s.bindings);
  const axisAbsoluteWasd = useKeybindStore((s) => s.axisAbsoluteWasd);
  if (mode !== "build") return null;

  const isIso = viewMode.kind === "iso";
  const moveLabel = axisAbsoluteWasd ? "Move ±X / ±Y" : "Move XY";
  const hints: Array<readonly [string, string]> = [
    ["Click cube", "Move cursor here"],
    ["Drag", "Pan"],
    ...(isIso ? [] : [["Shift+Drag", "Rotate"] as const]),
    ["Scroll", "Zoom"],
    [
      `${bindings.moveForward.displayLabel}/${bindings.moveLeft.displayLabel}/${bindings.moveBack.displayLabel}/${bindings.moveRight.displayLabel}`,
      moveLabel,
    ],
    [`${bindings.moveUp.displayLabel}/${bindings.moveDown.displayLabel}`, "Move Z"],
    [bindings.undo.displayLabel, "Undo step"],
    [bindings.cycleBlock.displayLabel, "Cycle block"],
    [bindings.cyclePipe.displayLabel, "Cycle pipe"],
    [bindings.exitBuild.displayLabel, "Exit build"],
  ];

  const customize = (
    <span
      onClick={onCustomize}
      style={{
        color: "rgba(255,255,255,0.5)",
        cursor: "pointer",
        pointerEvents: "auto",
        textDecoration: "underline",
        fontSize: "11px",
      }}
    >
      Customize
    </span>
  );

  return <HintBar hints={hints} trailing={customize} />;
}
