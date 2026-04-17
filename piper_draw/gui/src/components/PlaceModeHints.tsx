import { useBlockStore } from "../stores/blockStore";
import { HintBar } from "./HintBar";
import { modKey } from "./keyLabels";

export function PlaceModeHints() {
  const mode = useBlockStore((s) => s.mode);
  const viewMode = useBlockStore((s) => s.viewMode);
  if (mode !== "place") return null;

  const isIso = viewMode.kind === "iso";
  const hints: Array<readonly [string, string]> = [
    ["Click", "Place block"],
    ["Drag", "Pan"],
    ...(isIso ? [] : [["Shift+Drag", "Rotate"] as const]),
    ["Scroll", "Zoom"],
    [`${modKey}Z`, "Undo"],
    [`${modKey}\u21E7Z`, "Redo"],
  ];
  if (isIso) hints.push(["[ / ]", "Step slice"]);

  return <HintBar hints={hints} />;
}
