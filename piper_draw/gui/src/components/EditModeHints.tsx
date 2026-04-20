import { useBlockStore } from "../stores/blockStore";
import { bindingToLabel, useKeybindStore } from "../stores/keybindStore";
import { HintBar, CustomizeLink } from "./HintBar";
import { altKey } from "./keyLabels";

export function EditModeHints({ onCustomize }: { onCustomize: () => void }) {
  const mode = useBlockStore((s) => s.mode);
  const armedTool = useBlockStore((s) => s.armedTool);
  const xHeld = useBlockStore((s) => s.xHeld);
  const viewMode = useBlockStore((s) => s.viewMode);
  const hasSelection = useBlockStore((s) => s.selectedKeys.size > 0);
  const b = useKeybindStore((s) => s.bindings.edit);
  const navStyle = useKeybindStore((s) => s.navStyle);
  if (mode !== "edit") return null;

  const isIso = viewMode.kind === "iso";
  const dragRotates = !isIso && navStyle === "rotate";

  // X-held overrides the normal hint set — show the delete affordances.
  if (xHeld) {
    const hints: Array<readonly [string, string]> = [
      ["Click block", "Delete"],
      [`Release ${bindingToLabel(b.holdToDelete)}`, "Exit delete"],
      [bindingToLabel(b.undo), "Undo"],
    ];
    return <HintBar hints={hints} trailing={<CustomizeLink onClick={onCustomize} />} />;
  }

  const hints: Array<readonly [string, string]> = [];

  if (armedTool === "pointer") {
    hints.push(
      ["Click", "Select"],
      ["Drag", "Box select / Move selection"],
      ["Shift+Click", "Add/remove"],
      ["Shift+Drag", "Add to selection"],
      ...(isIso ? [] : [[`${altKey}Drag`, "Orbit"] as const]),
      ["Right Drag", "Pan"],
      ["Scroll", "Zoom"],
      [bindingToLabel(b.selectAll), "Select all"],
      [bindingToLabel(b.flipColors), "Flip colors"],
      [`Hold ${bindingToLabel(b.holdToDelete)}`, "Click-to-delete"],
      [bindingToLabel(b.undo), "Undo"],
      [bindingToLabel(b.redo), "Redo"],
      [bindingToLabel(b.deleteSelection), "Delete selected"],
      [bindingToLabel(b.clearSelection), "Clear selection"],
    );
    if (hasSelection) {
      hints.push(["↑/↓", "Nudge z ±3"]);
    } else if (isIso) {
      hints.push([
        `${bindingToLabel(b.stepForward)}/${bindingToLabel(b.stepBack)}`,
        `Step in ${viewMode.axis.toUpperCase()} direction`,
      ]);
    }
  } else {
    const placeLabel =
      armedTool === "port" ? "Place port"
        : armedTool === "pipe" ? "Place pipe"
          : "Place block";
    hints.push(
      ["Click", placeLabel],
      ["Drag", dragRotates ? "Rotate" : "Pan"],
      ...(isIso ? [] : [["Shift+Drag", dragRotates ? "Pan" : "Rotate"] as const]),
      ["Scroll", "Zoom"],
      [`Hold ${bindingToLabel(b.holdToDelete)}`, "Click-to-delete"],
      [bindingToLabel(b.clearSelection), "Disarm (→ pointer)"],
      [bindingToLabel(b.undo), "Undo"],
      [bindingToLabel(b.redo), "Redo"],
    );
    if (isIso) {
      hints.push([
        `${bindingToLabel(b.stepForward)}/${bindingToLabel(b.stepBack)}`,
        `Step in ${viewMode.axis.toUpperCase()} direction`,
      ]);
    }
  }

  return <HintBar hints={hints} trailing={<CustomizeLink onClick={onCustomize} />} />;
}
