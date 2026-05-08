import { useMemo } from "react";
import { useBlockStore } from "../stores/blockStore";
import { yBlockZOffset } from "../types";
import type { Block, Position3D } from "../types";
import { GroundShadowAbsolute } from "./GroundShadowAbsolute";

export const MAX_SHADOWS = 200;

export function DragShadow() {
  const dragDelta = useBlockStore((s) => s.dragDelta);
  const dragValid = useBlockStore((s) => s.dragValid);
  const selectedKeys = useBlockStore((s) => s.selectedKeys);
  const blocks = useBlockStore((s) => s.blocks);

  // Stable list keyed on selectedKeys/blocks (same pattern as DragGhost) so
  // rAF-driven dragDelta/dragValid only re-render leaves.
  const shadows = useMemo(() => {
    const result: Array<{ key: string; block: Block }> = [];
    for (const key of selectedKeys) {
      const block = blocks.get(key);
      if (!block) continue;
      result.push({ key, block });
      if (result.length >= MAX_SHADOWS) break;
    }
    return result;
  }, [selectedKeys, blocks]);

  if (shadows.length === 0) return null;

  // {0,0,0} delta = at-rest mode (treated as null). Drag commits a non-zero
  // delta the moment the pointer crosses the drag threshold.
  const liveDelta =
    dragDelta && (dragDelta.x !== 0 || dragDelta.y !== 0 || dragDelta.z !== 0)
      ? dragDelta
      : null;
  const valid = liveDelta ? dragValid : true;

  return (
    <>
      {shadows.map(({ key, block }) => {
        let pos: Position3D;
        if (liveDelta) {
          // Drag mode: shifted logical position, no Y-cube lift (matches
          // DragGhost which renders the dragged ghost at the logical destination).
          pos = {
            x: block.pos.x + liveDelta.x,
            y: block.pos.y + liveDelta.y,
            z: block.pos.z + liveDelta.z,
          };
        } else {
          // At-rest mode: committed block is rendered by BlockInstances with
          // yBlockZOffset applied to Y-cubes that have a pipe above. Mirror
          // that lift here so the shadow reflects what the user actually SEES,
          // not the bare logical z.
          const lift = block.type === "Y" ? yBlockZOffset(block.pos, blocks) : 0;
          pos = { ...block.pos, z: block.pos.z + lift };
        }
        return (
          <GroundShadowAbsolute
            key={key}
            pos={pos}
            blockType={block.type}
            valid={valid}
          />
        );
      })}
    </>
  );
}
