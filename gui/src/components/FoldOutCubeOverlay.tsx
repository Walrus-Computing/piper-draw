import { useMemo } from "react";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, posKey, CUBE_TYPES } from "../types";
import { isoTopThreeAxis } from "../utils/isoFoldOut";
import { posInActiveSlice } from "../utils/isoView";
import { FoldOutCubeFaces } from "./FoldOutCube";

/**
 * In iso mode, splay each placed cube's 4 side faces outward so the cube's
 * type stays readable from the camera angle. Mirrors the ghost preview's
 * fold-out so placement feels continuous: the splayed faces shown before
 * placing stay visible after. Skips splayed sides where a neighbor block
 * occupies the adjacent cell (per `hiddenFaces`) to avoid the splayed face
 * overlapping the neighbor; off-slice cubes are skipped entirely (the dimmed
 * cube body alone is enough context).
 */
export function FoldOutCubeOverlay() {
  const blocks = useBlockStore((s) => s.blocks);
  const hiddenFaces = useBlockStore((s) => s.hiddenFaces);
  const undeterminedCubes = useBlockStore((s) => s.undeterminedCubes);
  const viewMode = useBlockStore((s) => s.viewMode);

  const entries = useMemo(() => {
    if (viewMode.kind !== "iso") return [];
    const out: Array<{
      key: string;
      pos: [number, number, number];
      type: string;
      hf: number;
    }> = [];
    for (const block of blocks.values()) {
      if (typeof block.type !== "string") continue;  // skip FB blocks (objects)
      if (!(CUBE_TYPES as readonly string[]).includes(block.type)) continue;
      const k = posKey(block.pos);
      if (undeterminedCubes.has(k)) continue;
      if (!posInActiveSlice(viewMode, block.pos)) continue;
      out.push({
        key: k,
        pos: tqecToThree(block.pos, block.type),
        type: block.type,
        hf: hiddenFaces.get(k) ?? 0,
      });
    }
    return out;
  }, [blocks, hiddenFaces, undeterminedCubes, viewMode]);

  if (viewMode.kind !== "iso" || entries.length === 0) return null;
  const topAxis = isoTopThreeAxis(viewMode.axis);

  return (
    <>
      {entries.map((it) => (
        <group key={it.key} position={it.pos}>
          <FoldOutCubeFaces
            blockType={it.type}
            topAxis={topAxis}
            includeTop={false}
            hiddenFaces={it.hf}
          />
        </group>
      ))}
    </>
  );
}
