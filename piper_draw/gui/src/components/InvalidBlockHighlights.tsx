import { useMemo } from "react";
import * as THREE from "three";
import { useValidationStore } from "../stores/validationStore";
import { useBlockStore } from "../stores/blockStore";
import { usePulseScale } from "../hooks/usePulseScale";
import { tqecToThree, yBlockZOffset, blockThreeSize, posKey } from "../types";
import type { BlockType, Position3D } from "../types";

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

const pulsingMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  side: THREE.DoubleSide,
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

const noRaycast = () => {};

function parseKey(key: string): Position3D | null {
  const parts = key.split(",");
  if (parts.length !== 3) return null;
  const [x, y, z] = parts.map(Number);
  if (isNaN(x) || isNaN(y) || isNaN(z)) return null;
  return { x, y, z };
}

/** Pulsing red ghost cube for the currently selected error */
function PulsingErrorBlock({ position, blockType }: { position: [number, number, number]; blockType: BlockType }) {
  const groupRef = usePulseScale();
  const { box } = getHighlightGeo(blockType);

  return (
    <group ref={groupRef} position={position}>
      <mesh geometry={box} material={pulsingMaterial} raycast={noRaycast} />
    </group>
  );
}

export function InvalidBlockHighlights() {
  const invalidKeys = useValidationStore((s) => s.invalidKeys);
  const selectedErrorKey = useValidationStore((s) => s.selectedErrorKey);
  const blocks = useBlockStore((s) => s.blocks);

  const { withBlock, withoutBlock } = useMemo(() => {
    if (invalidKeys.size === 0) return { withBlock: [], withoutBlock: [] };
    const matched: { key: string; blockType: BlockType; pos: Position3D }[] = [];
    const matchedKeys = new Set<string>();
    for (const block of blocks.values()) {
      if (invalidKeys.has(posKey(block.pos))) {
        matched.push({ key: posKey(block.pos), blockType: block.type, pos: block.pos });
        matchedKeys.add(posKey(block.pos));
        if (matched.length >= 200) break;
      }
    }
    // Errors at positions with no block (e.g. missing pipes)
    const unmatched: { key: string; pos: Position3D }[] = [];
    for (const key of invalidKeys) {
      if (!matchedKeys.has(key)) {
        const parsed = parseKey(key);
        if (parsed) unmatched.push({ key, pos: parsed });
      }
    }
    return { withBlock: matched, withoutBlock: unmatched };
  }, [invalidKeys, blocks]);

  if (withBlock.length === 0 && withoutBlock.length === 0) return null;

  return (
    <>
      {withBlock.map(({ key, blockType, pos }) => {
        const zo = blockType === "Y" ? yBlockZOffset(pos, blocks) : 0;
        const [tx, ty, tz] = tqecToThree(pos, blockType, zo);

        if (key === selectedErrorKey) {
          return (
            <PulsingErrorBlock
              key={key}
              position={[tx, ty, tz]}
              blockType={blockType}
            />
          );
        }

        const { box, edges } = getHighlightGeo(blockType);
        return (
          <group key={key} position={[tx, ty, tz]}>
            <mesh geometry={box} material={highlightMaterial} raycast={noRaycast} />
            <lineSegments geometry={edges} material={outlineMaterial} raycast={noRaycast} />
          </group>
        );
      })}
      {withoutBlock.map(({ key, pos }) => {
        const [tx, ty, tz] = tqecToThree(pos, "XZZ");

        if (key === selectedErrorKey) {
          return (
            <PulsingErrorBlock
              key={key}
              position={[tx, ty, tz]}
              blockType="XZZ"
            />
          );
        }

        const { box, edges } = getHighlightGeo("XZZ");
        return (
          <group key={key} position={[tx, ty, tz]}>
            <mesh geometry={box} material={highlightMaterial} raycast={noRaycast} />
            <lineSegments geometry={edges} material={outlineMaterial} raycast={noRaycast} />
          </group>
        );
      })}
    </>
  );
}
