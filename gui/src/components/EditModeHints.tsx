import { useBlockStore } from "../stores/blockStore";
import { bindingToLabel, useKeybindStore } from "../stores/keybindStore";
import { HintBar, CustomizeLink } from "./HintBar";

export function EditModeHints({ onCustomize }: { onCustomize: () => void }) {
  const mode = useBlockStore((s) => s.mode);
  const armedTool = useBlockStore((s) => s.armedTool);
  const xHeld = useBlockStore((s) => s.xHeld);
  const viewMode = useBlockStore((s) => s.viewMode);
  const hasSelection = useBlockStore((s) => s.selectedKeys.size > 0);
  const b = useKeybindStore((s) => s.bindings.edit);
  if (mode !== "edit") return null;

  const isIso = viewMode.kind === "iso";

  // X-held overrides the normal hint set — show the delete affordances.
  if (xHeld) {
    const hints: Array<readonly [string, string]> = [
      ["Click block", "Delete"],
      [`Release ${bindingToLabel(b.holdToDelete)}`, "Exit delete"],
    ];
    return <HintBar hints={hints} trailing={<CustomizeLink onClick={onCustomize} />} />;
  }

  // Placing-paste mode: minimal hint set — commit, cancel, undo.
  if (armedTool === "paste") {
    const hints: Array<readonly [string, string]> = [
      ["Click", "Paste here"],
      [bindingToLabel(b.paste), "Paste here"],
      [bindingToLabel(b.clearSelection), "Cancel"],
      [bindingToLabel(b.undo), "Undo"],
    ];
    return <HintBar hints={hints} trailing={<CustomizeLink onClick={onCustomize} />} />;
  }

  const hints: Array<readonly [string, string]> = [];

  if (armedTool === "pointer") {
    hints.push(
      ["Click", "Select"],
      ["Shift+Click", "Add/remove"],
      ["Ctrl+Shift+Drag", "Marquee select"],
      [bindingToLabel(b.selectAll), "Select all"],
      [bindingToLabel(b.flipColors), "Flip colors"],
    );
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
    // Group hint surfaces only when a selection exists — that's the only
    // moment the action is meaningful, which is also the moment users
    // discover it.
    if (hasSelection) {
      hints.push([bindingToLabel(b.groupToggle), "Group / ungroup"]);
    }
    if (hasSelection) {
      hints.push([
        `${bindingToLabel(b.nudgeUp)}/${bindingToLabel(b.nudgeDown)}`,
        "Nudge z ±1",
      ]);
    }
    if (isIso && !hasSelection) {
      hints.push([
        `${bindingToLabel(b.stepForward)}/${bindingToLabel(b.stepBack)}`,
        `Step in ${viewMode.axis.toUpperCase()} direction`,
      ]);
    }
  } else if (armedTool === "paint") {
    hints.push(
      ["Click face", "Paint with selected color"],
      [`Hold ${bindingToLabel(b.holdToDelete)}`, "Click-to-delete"],
    );
  } else if (armedTool === "corr-surface") {
    hints.push(
      ["Click face", "Mark/unmark correlation surface"],
      [`Hold ${bindingToLabel(b.holdToDelete)}`, "Click-to-delete"],
    );
  } else {
    const placeLabel =
      armedTool === "port" ? "Place port"
        : armedTool === "pipe" ? "Place pipe"
          : "Place block";
    hints.push(
      ["Click", placeLabel],
      [`Hold ${bindingToLabel(b.holdToDelete)}`, "Click-to-delete"],
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
