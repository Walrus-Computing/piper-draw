import { useRef, useLayoutEffect, useMemo, useCallback } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, threeToTqecCell } from "../types";

const MAX_INITIAL = 1024;
const BLOCK_COLOR = new THREE.Color("#4a9eff");

export function BlockInstances() {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const blocks = useBlockStore((s) => s.blocks);
  const mode = useBlockStore((s) => s.mode);
  const addBlock = useBlockStore((s) => s.addBlock);
  const removeBlock = useBlockStore((s) => s.removeBlock);
  const setHoveredGridPos = useBlockStore((s) => s.setHoveredGridPos);

  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: BLOCK_COLOR }),
    [],
  );

  const dummy = useMemo(() => new THREE.Matrix4(), []);

  // Ensure count=0 on first mount before any raycasts
  const initRef = useCallback((mesh: THREE.InstancedMesh | null) => {
    if (mesh) {
      mesh.count = 0;
      meshRef.current = mesh;
    }
  }, []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    let i = 0;
    for (const pos of blocks.values()) {
      const [tx, ty, tz] = tqecToThree(pos);
      dummy.makeTranslation(tx, ty, tz);
      mesh.setMatrixAt(i, dummy);
      i++;
    }
    mesh.count = blocks.size;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [blocks, dummy]);

  const getBlockAtInstance = (instanceId: number): THREE.Vector3 | null => {
    const entries = Array.from(blocks.values());
    const pos = entries[instanceId];
    if (!pos) return null;
    const [tx, ty, tz] = tqecToThree(pos);
    return new THREE.Vector3(tx, ty, tz);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (mode === "delete") {
      // Highlight the block itself
      if (e.instanceId == null) return;
      const entries = Array.from(blocks.values());
      const pos = entries[e.instanceId];
      if (pos) setHoveredGridPos(pos);
    } else {
      // Highlight adjacent cell for placement
      if (!e.face) return;
      const n = e.face.normal;
      // Transform normal from object space to world space
      const blockCenter = getBlockAtInstance(e.instanceId!);
      if (!blockCenter) return;
      setHoveredGridPos(
        threeToTqecCell(
          blockCenter.x + n.x,
          blockCenter.y + n.y,
          blockCenter.z + n.z,
        ),
      );
    }
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (mode === "delete") {
      if (e.instanceId == null) return;
      const entries = Array.from(blocks.values());
      const pos = entries[e.instanceId];
      if (pos) removeBlock(pos);
    } else {
      if (!e.face || e.instanceId == null) return;
      const n = e.face.normal;
      const blockCenter = getBlockAtInstance(e.instanceId);
      if (!blockCenter) return;
      addBlock(
        threeToTqecCell(
          blockCenter.x + n.x,
          blockCenter.y + n.y,
          blockCenter.z + n.z,
        ),
      );
    }
  };

  return (
    <instancedMesh
      ref={initRef}
      args={[geometry, material, Math.max(MAX_INITIAL, blocks.size)]}
      onPointerMove={handlePointerMove}
      onClick={handleClick}
    />
  );
}
