import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, yBlockZOffset, blockThreeSize, posKey } from "../types";
import type { Block, BlockType } from "../types";

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

const boxCache = new Map<BlockType, THREE.BoxGeometry>();
const edgesCache = new Map<BlockType, THREE.EdgesGeometry>();

function getHighlightGeo(blockType: BlockType) {
  let box = boxCache.get(blockType);
  if (!box) {
    const [sx, sy, sz] = blockThreeSize(blockType);
    box = new THREE.BoxGeometry(sx * 1.04, sy * 1.04, sz * 1.04);
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

function PulsingHighlight({
  block,
  zo,
}: {
  block: Block;
  zo: number;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const [tx, ty, tz] = tqecToThree(block.pos, block.type, zo);
  const { box, edges } = getHighlightGeo(block.type);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const pulse = 1.0 + 0.02 * Math.sin(clock.getElapsedTime() * 4);
    groupRef.current.scale.setScalar(pulse);
  });

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
