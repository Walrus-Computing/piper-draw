import { useBlockStore } from "../stores/blockStore";
import { bindingToLabel, useKeybindStore } from "../stores/keybindStore";
import { HintBar, CustomizeLink } from "./HintBar";

type Hint = readonly [string, string];
type EditBindings = ReturnType<typeof useKeybindStore.getState>["bindings"]["edit"];
type ViewMode = ReturnType<typeof useBlockStore.getState>["viewMode"];

function pointerHints(b: EditBindings, hasSelection: boolean, isIso: boolean, viewMode: ViewMode): Hint[] {
  const hints: Hint[] = [
    ["Click", "Select"],
    ["Shift+Click", "Add/remove"],
    ["Ctrl+Shift+Drag", "Marquee select"],
    [bindingToLabel(b.selectAll), "Select all"],
    [bindingToLabel(b.flipColors), "Flip colors"],
  ];
  if (hasSelection) {
    const rotateKeys = `${bindingToLabel(b.rotateCcw)}/${bindingToLabel(b.rotateXCcw)}/${bindingToLabel(b.rotateYCcw)}`;
    const flipKeys = `${bindingToLabel(b.flipX)}/${bindingToLabel(b.flipY)}/${bindingToLabel(b.flipZ)}`;
    hints.push([rotateKeys, "Rotate"], [flipKeys, "Flip"]);
  } else {
    hints.push([bindingToLabel(b.rotateCcw), "Rotate"]);
  }
  hints.push(
    [`Hold ${bindingToLabel(b.holdToDelete)}`, "Click-to-delete"],
    [bindingToLabel(b.deleteSelection), "Delete selected"],
    [bindingToLabel(b.clearSelection), "Clear selection"],
    [`${bindingToLabel(b.copy)}/${bindingToLabel(b.paste)}`, "Copy / paste"],
  );
  if (hasSelection) {
    hints.push([bindingToLabel(b.groupToggle), "Group / ungroup"]);
    hints.push([
      `${bindingToLabel(b.nudgeUp)}/${bindingToLabel(b.nudgeDown)}`,
      "Nudge z ±1",
    ]);
  }
  if (isIso && !hasSelection) {
    hints.push([
      `${bindingToLabel(b.stepForward)}/${bindingToLabel(b.stepBack)}`,
      `Step in ${viewMode.kind === "iso" ? viewMode.axis.toUpperCase() : ""} direction`,
    ]);
  }
  return hints;
}

function placementHints(armedTool: string, b: EditBindings, isIso: boolean, viewMode: ViewMode): Hint[] {
  const placeLabel =
    armedTool === "port" ? "Place port"
      : armedTool === "pipe" ? "Place pipe"
        : "Place block";
  const hints: Hint[] = [
    ["Click", placeLabel],
    [`Hold ${bindingToLabel(b.holdToDelete)}`, "Click-to-delete"],
  ];
  if (isIso) {
    hints.push([
      `${bindingToLabel(b.stepForward)}/${bindingToLabel(b.stepBack)}`,
      `Step in ${viewMode.kind === "iso" ? viewMode.axis.toUpperCase() : ""} direction`,
    ]);
  }
  return hints;
}

export function EditModeHints({ onCustomize }: { onCustomize: () => void }) {
  const mode = useBlockStore((s) => s.mode);
  const armedTool = useBlockStore((s) => s.armedTool);
  const xHeld = useBlockStore((s) => s.xHeld);
  const viewMode = useBlockStore((s) => s.viewMode);
  const hasSelection = useBlockStore((s) => s.selectedKeys.size > 0);
  const b = useKeybindStore((s) => s.bindings.edit);
  if (mode !== "edit") return null;

  const isIso = viewMode.kind === "iso";
  const trailing = <CustomizeLink onClick={onCustomize} />;

  if (xHeld) {
    return <HintBar hints={[
      ["Click block", "Delete"],
      [`Release ${bindingToLabel(b.holdToDelete)}`, "Exit delete"],
    ]} trailing={trailing} />;
  }

  if (armedTool === "paste") {
    return <HintBar hints={[
      ["Click", "Paste here"],
      [bindingToLabel(b.paste), "Paste here"],
      [bindingToLabel(b.clearSelection), "Cancel"],
      [bindingToLabel(b.undo), "Undo"],
    ]} trailing={trailing} />;
  }

  const hints: Hint[] =
    armedTool === "pointer" ? pointerHints(b, hasSelection, isIso, viewMode)
      : armedTool === "paint" ? [
          ["Click face", "Paint with selected color"],
          [`Hold ${bindingToLabel(b.holdToDelete)}`, "Click-to-delete"],
        ]
      : placementHints(armedTool, b, isIso, viewMode);

  return <HintBar hints={hints} trailing={trailing} />;
}
