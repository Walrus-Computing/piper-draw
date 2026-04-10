import { useRef, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import {
  tqecToThree,
  threeToTqecCell,
  createCubeGeometry,
  CUBE_TYPES,
} from "../types";
import type { CubeType, Block } from "../types";

const MAX_INITIAL = 1024;

function TypedInstances({
  cubeType,
  blocks,
}: {
  cubeType: CubeType;
  blocks: Block[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const geometry = useMemo(() => createCubeGeometry(cubeType), [cubeType]);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true }),
    [],
  );
  const dummy = useMemo(() => new THREE.Matrix4(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    for (let i = 0; i < blocks.length; i++) {
      const [tx, ty, tz] = tqecToThree(blocks[i].pos);
      dummy.makeTranslation(tx, ty, tz);
      mesh.setMatrixAt(i, dummy);
    }
    mesh.count = blocks.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [blocks, dummy]);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const b = blocksRef.current;
    if (e.instanceId == null || e.instanceId >= b.length) return;
    const mode = useBlockStore.getState().mode;
    if (mode === "delete") {
      useBlockStore.getState().setHoveredGridPos(b[e.instanceId].pos);
    } else {
      if (!e.face) return;
      const n = e.face.normal;
      const [tx, ty, tz] = tqecToThree(b[e.instanceId].pos);
      useBlockStore
        .getState()
        .setHoveredGridPos(threeToTqecCell(tx + n.x, ty + n.y, tz + n.z));
    }
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 2) return;
    const b = blocksRef.current;
    if (e.instanceId == null || e.instanceId >= b.length) return;
    const { mode, addBlock, removeBlock } = useBlockStore.getState();
    if (mode === "delete") {
      removeBlock(b[e.instanceId].pos);
    } else {
      if (!e.face) return;
      const n = e.face.normal;
      const [tx, ty, tz] = tqecToThree(b[e.instanceId].pos);
      addBlock(threeToTqecCell(tx + n.x, ty + n.y, tz + n.z));
    }
  };

  if (blocks.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, Math.max(MAX_INITIAL, blocks.length)]}
      onPointerMove={handlePointerMove}
      onClick={handleClick}
    />
  );
}

export function BlockInstances() {
  const blocks = useBlockStore((s) => s.blocks);

  const grouped = useMemo(() => {
    const map = new Map<CubeType, Block[]>();
    for (const ct of CUBE_TYPES) map.set(ct, []);
    for (const block of blocks.values()) {
      map.get(block.type)!.push(block);
    }
    return map;
  }, [blocks]);

  return (
    <>
      {CUBE_TYPES.map((ct) => (
        <TypedInstances
          key={ct}
          cubeType={ct}
          blocks={grouped.get(ct)!}
        />
      ))}
    </>
  );
}
