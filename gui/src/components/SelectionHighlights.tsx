import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { usePulseScale } from "../hooks/usePulseScale";
import { tqecToThree, yBlockZOffset, posKey } from "../types";
import type { Block, BlockType } from "../types";
import { getHighlightGeo } from "./highlightGeo";

const SELECTION_SCALE = 1.04;

/**
 * Above this many selected blocks, drop the per-block pulsing meshes (two
 * scene objects each) for one static InstancedMesh per block type. Selecting
 * a whole imported scene previously showed only the first 200 highlights —
 * 2% of a 10k-block selection, clustered in one corner — which read as
 * "select all did nothing".
 */
const MAX_PULSING_HIGHLIGHTS = 200;

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

function InstancedTypeHighlights({
  type,
  typeBlocks,
  allBlocks,
}: {
  type: BlockType;
  typeBlocks: Block[];
  allBlocks: Map<string, Block>;
}) {
  const { box } = getHighlightGeo(type, SELECTION_SCALE);
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(box, highlightMaterial, typeBlocks.length);
    const mat = new THREE.Matrix4();
    typeBlocks.forEach((block, i) => {
      const zo = block.type === "Y" ? yBlockZOffset(block.pos, allBlocks) : 0;
      const [tx, ty, tz] = tqecToThree(block.pos, block.type, zo);
      mat.makeTranslation(tx, ty, tz);
      m.setMatrixAt(i, mat);
    });
    m.instanceMatrix.needsUpdate = true;
    m.raycast = noRaycast;
    return m;
  }, [box, typeBlocks, allBlocks]);
  // Dispose only the instance buffers — geometry and material are shared caches.
  useEffect(() => () => mesh.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

export function SelectionHighlights() {
  const selectedKeys = useBlockStore((s) => s.selectedKeys);
  const blocks = useBlockStore((s) => s.blocks);
  const isDragging = useBlockStore((s) => s.isDraggingSelection);

  const selectedBlocks = useMemo(() => {
    if (selectedKeys.size === 0) return [];
    const result: Block[] = [];
    for (const block of blocks.values()) {
      if (selectedKeys.has(posKey(block.pos))) result.push(block);
    }
    return result;
  }, [selectedKeys, blocks]);

  const blocksByType = useMemo(() => {
    if (selectedBlocks.length <= MAX_PULSING_HIGHLIGHTS) return null;
    const byType = new Map<BlockType, Block[]>();
    for (const block of selectedBlocks) {
      const list = byType.get(block.type);
      if (list) list.push(block);
      else byType.set(block.type, [block]);
    }
    return byType;
  }, [selectedBlocks]);

  if (isDragging) return null;
  if (selectedBlocks.length === 0) return null;

  if (blocksByType) {
    return (
      <>
        {[...blocksByType.entries()].map(([type, typeBlocks]) => (
          <InstancedTypeHighlights
            key={type}
            type={type}
            typeBlocks={typeBlocks}
            allBlocks={blocks}
          />
        ))}
      </>
    );
  }

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
