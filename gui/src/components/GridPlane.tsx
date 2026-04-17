import { useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import { snapGroundPos, hasBlockOverlap, hasCubeColorConflict, hasPipeColorConflict, hasYCubePipeAxisConflict, isValidPos, isPipeType, resolvePipeType, posKey } from "../types";
import type { CubeType } from "../types";
import { cameraGroundPoint } from "../utils/groundPlane";

const PLANE_SIZE = 1000;

export function GridPlane() {
  const addBlock = useBlockStore((s) => s.addBlock);
  const mode = useBlockStore((s) => s.mode);
  const setHoveredGridPos = useBlockStore((s) => s.setHoveredGridPos);
  const meshRef = useRef<THREE.Mesh>(null!);
  const target = useRef(new THREE.Vector3());

  // Keep the invisible raycast plane centered under the camera's look point
  useFrame(({ camera }) => {
    if (!meshRef.current) return;
    if (cameraGroundPoint(camera, target.current)) {
      meshRef.current.position.x = Math.round(target.current.x);
      meshRef.current.position.z = Math.round(target.current.z);
    }
  });

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (mode !== "place") { setHoveredGridPos(null); return; }

    const store = useBlockStore.getState();
    const forPipe = store.pipeVariant !== null;
    // e.point is in Three.js coords; convert to TQEC X/Y (ground plane z=0)
    const pos = snapGroundPos(e.point.x, -e.point.z, forPipe);

    // Determine actual block type for this position
    let blockType = store.cubeType;
    if (store.pipeVariant) {
      const resolved = resolvePipeType(store.pipeVariant, pos);
      if (!resolved) { setHoveredGridPos(pos, undefined, true); return; }
      blockType = resolved;
    }

    const existing = store.blocks.get(posKey(pos));
    const existingKey = existing ? posKey(pos) : undefined;
    const isReplace = !!(existing && existing.type !== blockType);
    if (!isValidPos(pos, blockType) || hasBlockOverlap(pos, blockType, store.blocks, store.spatialIndex, existingKey)) {
      setHoveredGridPos(pos, blockType, true, undefined, isReplace);
    } else if (existing && existing.type === blockType) {
      setHoveredGridPos(null);
    } else if (!store.freeBuild && isPipeType(blockType) && hasPipeColorConflict(blockType, pos, store.blocks)) {
      setHoveredGridPos(pos, blockType, true, "Pipe colors don't match the adjacent cube", isReplace);
    } else if (!store.freeBuild && !isPipeType(blockType) && blockType !== "Y" && hasCubeColorConflict(blockType as CubeType, pos, store.blocks)) {
      setHoveredGridPos(pos, blockType, true, "Cube colors don't match the adjacent pipe", isReplace);
    } else if (!store.freeBuild && hasYCubePipeAxisConflict(blockType, pos, store.blocks)) {
      setHoveredGridPos(pos, blockType, true, "Y cube cannot be next to an X-open or Y-open pipe", isReplace);
    } else {
      setHoveredGridPos(pos, blockType, false, undefined, isReplace);
    }
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 2) return; // ignore drags
    if (mode === "select") {
      useBlockStore.getState().clearSelection();
      return;
    }
    if (mode !== "place") return;

    const store = useBlockStore.getState();
    const forPipe = store.pipeVariant !== null;
    const pos = snapGroundPos(e.point.x, -e.point.z, forPipe);
    addBlock(pos);
  };

  const handlePointerLeave = () => {
    setHoveredGridPos(null);
  };

  if (mode === "delete") return null;
  if (mode === "build") {
    return (
      <mesh
        ref={meshRef}
        rotation-x={-Math.PI / 2}
        position={[0, 0, 0]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.delta > 2) return;
          const pos = snapGroundPos(e.point.x, -e.point.z, false);
          useBlockStore.getState().moveBuildCursor(pos);
        }}
        onPointerLeave={handlePointerLeave}
      >
        <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
        <meshBasicMaterial visible={false} side={THREE.FrontSide} />
      </mesh>
    );
  }
  if (mode === "select") {
    return (
      <mesh
        ref={meshRef}
        rotation-x={-Math.PI / 2}
        position={[0, 0, 0]}
        onClick={handleClick}
        onPointerLeave={handlePointerLeave}
      >
        <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
        <meshBasicMaterial visible={false} side={THREE.FrontSide} />
      </mesh>
    );
  }

  return (
    <mesh
      ref={meshRef}
      rotation-x={-Math.PI / 2}
      position={[0, 0, 0]}
      onPointerMove={handlePointerMove}
      onClick={handleClick}
      onPointerLeave={handlePointerLeave}
    >
      <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
      <meshBasicMaterial visible={false} side={THREE.FrontSide} />
    </mesh>
  );
}
