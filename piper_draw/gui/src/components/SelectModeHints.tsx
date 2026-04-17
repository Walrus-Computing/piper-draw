import { useBlockStore } from "../stores/blockStore";
import { HintBar } from "./HintBar";
import { altKey, modKey } from "./keyLabels";

export function SelectModeHints() {
  const mode = useBlockStore((s) => s.mode);
  const viewMode = useBlockStore((s) => s.viewMode);
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
    [`${modKey}A`, "Select all"],
    [`${modKey}Z`, "Undo"],
    ["Delete", "Delete selected"],
    ["Esc", "Clear selection"],
  ];
  if (isIso) hints.push(["[ / ]", "Step slice"]);

  return <HintBar hints={hints} />;
}
