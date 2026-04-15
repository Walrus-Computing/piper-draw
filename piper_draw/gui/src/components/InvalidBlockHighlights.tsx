import { useMemo } from "react";
import * as THREE from "three";
import { useValidationStore } from "../stores/validationStore";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, yBlockZOffset, blockThreeSize, posKey } from "../types";
import type { BlockType } from "../types";

const highlightMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.25,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const outlineMaterial = new THREE.LineBasicMaterial({
  color: 0xff0000,
  linewidth: 2,
});

const boxCache = new Map<BlockType, THREE.BoxGeometry>();
const edgesCache = new Map<BlockType, THREE.EdgesGeometry>();

function getHighlightGeo(blockType: BlockType) {
  let box = boxCache.get(blockType);
  if (!box) {
    const [sx, sy, sz] = blockThreeSize(blockType);
    box = new THREE.BoxGeometry(sx * 1.05, sy * 1.05, sz * 1.05);
    boxCache.set(blockType, box);
  }
  let edges = edgesCache.get(blockType);
  if (!edges) {
    edges = new THREE.EdgesGeometry(box);
    edgesCache.set(blockType, edges);
  }
  return { box, edges };
}

export function InvalidBlockHighlights() {
  const invalidKeys = useValidationStore((s) => s.invalidKeys);
  const blocks = useBlockStore((s) => s.blocks);

  const invalidBlocks = useMemo(() => {
    if (invalidKeys.size === 0) return [];
    const result = [];
    for (const block of blocks.values()) {
      if (invalidKeys.has(posKey(block.pos))) {
        result.push(block);
        if (result.length >= 200) break;
      }
    }
    return result;
  }, [invalidKeys, blocks]);

  if (invalidBlocks.length === 0) return null;

  return (
    <>
      {invalidBlocks.map((block) => {
        const zo = block.type === "Y" ? yBlockZOffset(block.pos, blocks) : 0;
        const [tx, ty, tz] = tqecToThree(block.pos, block.type, zo);
        const { box, edges } = getHighlightGeo(block.type);
        return (
          <group key={posKey(block.pos)} position={[tx, ty, tz]}>
            <mesh geometry={box} material={highlightMaterial} />
            <lineSegments geometry={edges} material={outlineMaterial} />
          </group>
        );
      })}
    </>
  );
}
