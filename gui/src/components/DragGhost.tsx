import { useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree } from "../types";
import type { Block, Position3D } from "../types";
import { getCachedGeometry, getCachedEdges } from "./BlockInstances";

const noRaycast = () => {};

const validMeshMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const validLineMaterial = new THREE.LineBasicMaterial({
  color: "#000000",
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});
const invalidMeshMaterial = new THREE.MeshBasicMaterial({
  color: 0xff5555,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const invalidLineMaterial = new THREE.LineBasicMaterial({
  color: "#ff0000",
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
});

const MAX_GHOSTS = 200;

function GhostInstance({ block, delta, valid }: { block: Block; delta: Position3D; valid: boolean }) {
  const shiftedPos: Position3D = {
    x: block.pos.x + delta.x,
    y: block.pos.y + delta.y,
    z: block.pos.z + delta.z,
  };
  const [tx, ty, tz] = tqecToThree(shiftedPos, block.type, 0);
  const geometry = getCachedGeometry(block.type, 0);
  const edges = getCachedEdges(block.type, 0);
  const meshMat = valid ? validMeshMaterial : invalidMeshMaterial;
  const lineMat = valid ? validLineMaterial : invalidLineMaterial;
  return (
    <group position={[tx, ty, tz]}>
      <mesh geometry={geometry} material={meshMat} raycast={noRaycast} />
      <lineSegments geometry={edges} material={lineMat} raycast={noRaycast} />
    </group>
  );
}

export function DragGhost() {
  const dragDelta = useBlockStore((s) => s.dragDelta);
  const dragValid = useBlockStore((s) => s.dragValid);
  const selectedKeys = useBlockStore((s) => s.selectedKeys);
  const blocks = useBlockStore((s) => s.blocks);

  // Keys-only dep so the ghost list is stable across the rAF-driven dragDelta
  // updates — child GhostInstances just get new delta props instead of re-mounting.
  const ghosts = useMemo(() => {
    const result: Array<{ key: string; block: Block }> = [];
    for (const key of selectedKeys) {
      const block = blocks.get(key);
      if (!block) continue;
      result.push({ key, block });
      if (result.length >= MAX_GHOSTS) break;
    }
    return result;
  }, [selectedKeys, blocks]);

  if (!dragDelta) return null;
  if (dragDelta.x === 0 && dragDelta.y === 0 && dragDelta.z === 0) return null;
  if (ghosts.length === 0) return null;

  return (
    <>
      {ghosts.map(({ key, block }) => (
        <GhostInstance key={key} block={block} delta={dragDelta} valid={dragValid} />
      ))}
    </>
  );
}
