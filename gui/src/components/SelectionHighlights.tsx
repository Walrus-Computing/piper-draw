import { useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { usePulseScale } from "../hooks/usePulseScale";
import { tqecToThree, yBlockZOffset, posKey } from "../types";
import type { Block } from "../types";
import { getHighlightGeo } from "./highlightGeo";

const SELECTION_SCALE = 1.04;

const highlightMaterial = new THREE.MeshBasicMaterial({
  color: 0x4a9eff,
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const outlineMaterial = new THREE.LineBasicMaterial({
  color: 0x4a9eff,
  linewidth: 2,
});

const noRaycast = () => {};

function PulsingHighlight({
  block,
  zo,
}: {
  block: Block;
  zo: number;
}) {
  const groupRef = usePulseScale();
  const [tx, ty, tz] = tqecToThree(block.pos, block.type, zo);
  const { box, edges } = getHighlightGeo(block.type, SELECTION_SCALE);

  return (
    <group ref={groupRef} position={[tx, ty, tz]}>
      <mesh geometry={box} material={highlightMaterial} raycast={noRaycast} />
      <lineSegments geometry={edges} material={outlineMaterial} raycast={noRaycast} />
    </group>
  );
}

export function SelectionHighlights() {
  const selectedKeys = useBlockStore((s) => s.selectedKeys);
  const blocks = useBlockStore((s) => s.blocks);
  const isDragging = useBlockStore((s) => s.isDraggingSelection);

  const selectedBlocks = useMemo(() => {
    if (selectedKeys.size === 0) return [];
    const result = [];
    for (const block of blocks.values()) {
      if (selectedKeys.has(posKey(block.pos))) {
        result.push(block);
        if (result.length >= 200) break;
      }
    }
    return result;
  }, [selectedKeys, blocks]);

  if (isDragging) return null;
  if (selectedBlocks.length === 0) return null;

  return (
    <>
      {selectedBlocks.map((block) => {
        const zo = block.type === "Y" ? yBlockZOffset(block.pos, blocks) : 0;
        return (
          <PulsingHighlight
            key={posKey(block.pos)}
            block={block}
            zo={zo}
          />
        );
      })}
    </>
  );
}
