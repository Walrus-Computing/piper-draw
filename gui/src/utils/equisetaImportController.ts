/**
 * Imperative dispatcher for "Import" / "Insert" actions in EquisetaJsonPanel.
 *
 * Lives in a separate module so the panel and the action-row component can
 * satisfy `react-refresh/only-export-components`. Calls `equisetaToBlocks`
 * (pure translator) and routes the result through `blockStore.loadBlocks`
 * (Import — replaces scene + replaces port state) or
 * `blockStore.insertBlocks` (Insert — appends at +X offset, silently drops
 * port markers in v1). Toasts honestly about success, error, and silent
 * drops.
 */

import { useBlockStore } from "../stores/blockStore";
import type { PortMeta } from "../types";
import type { FtqcGraph } from "./equisetaJsonSchema";
import {
  equisetaToBlocks,
  summarizeError,
  summarizeSuccess,
} from "./equisetaImport";
import { toastBus } from "./toastBus";

function buildDefaultPortMeta(positions: Set<string>): Map<string, PortMeta> {
  const out = new Map<string, PortMeta>();
  let i = 1;
  for (const key of positions) {
    out.set(key, { label: `p${i++}`, io: "in" });
  }
  return out;
}

export function runEquisetaImport(
  graph: FtqcGraph,
  sourceLabel: string,
  mode: "replace" | "append",
): void {
  const result = equisetaToBlocks(graph);
  if (!result.ok) {
    toastBus.error.emit(summarizeError(result));
    return;
  }
  if (result.empty) {
    toastBus.info.emit("Empty Equiseta graph — nothing to import");
    return;
  }
  const store = useBlockStore.getState();
  if (mode === "replace") {
    // Always pass a ports object so loadBlocks clears stale portMeta from any
    // prior scene — even when this import has no ports. Omitting `ports` would
    // preserve the previous scene's labels/io/rank and silently re-attach them
    // to any future port at the same key.
    const portMeta = buildDefaultPortMeta(result.portPositions);
    store.loadBlocks(result.blocks, {
      portMeta,
      portPositions: result.portPositions,
    });
    toastBus.info.emit(summarizeSuccess(result, sourceLabel));
    return;
  }
  // mode === "append" (Insert). insertBlocks doesn't carry ports in v1.
  // It also silently drops blocks that collide with the existing scene after
  // the +X offset. Track both so the toast is honest about what landed.
  const blocksBefore = store.blocks.size;
  store.insertBlocks(result.blocks);
  const blocksAfter = useBlockStore.getState().blocks.size;
  const blocksLanded = blocksAfter - blocksBefore;
  const blocksDropped = result.blocks.size - blocksLanded;

  if (result.blocks.size === 0) {
    toastBus.info.emit(
      "Insert can't carry port-only imports — use Import instead",
    );
    return;
  }
  if (blocksLanded === 0) {
    toastBus.error.emit(
      `Insert: all ${result.blocks.size} block(s) collided with the existing scene — nothing inserted. Try Import (replace) instead.`,
    );
    return;
  }

  const base = summarizeSuccess(result, sourceLabel, "Inserted");
  const notes: string[] = [];
  if (blocksDropped > 0) {
    notes.push(
      `${blocksDropped} block${blocksDropped === 1 ? "" : "s"} dropped (position collision)`,
    );
  }
  if (result.portCount > 0) {
    notes.push(
      `${result.portCount} port marker${result.portCount === 1 ? "" : "s"} dropped — use Import to keep them`,
    );
  }
  toastBus.info.emit(notes.length > 0 ? `${base} (${notes.join("; ")})` : base);
}
