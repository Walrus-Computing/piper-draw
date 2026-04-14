import { useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import { snapGroundPos, hasBlockOverlap, hasCubeColorConflict, hasPipeColorConflict, isValidPos, isPipeType, resolvePipeType } from "../types";
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

    if (!isValidPos(pos, blockType) || hasBlockOverlap(pos, blockType, store.blocks, store.spatialIndex)) {
      setHoveredGridPos(pos, blockType, true);
    } else if (isPipeType(blockType) && hasPipeColorConflict(blockType, pos, store.blocks)) {
      setHoveredGridPos(pos, blockType, true, "Pipe colors don't match the adjacent cube");
    } else if (!isPipeType(blockType) && blockType !== "Y" && hasCubeColorConflict(blockType as CubeType, pos, store.blocks)) {
      setHoveredGridPos(pos, blockType, true, "Cube colors don't match the adjacent pipe");
    } else {
      setHoveredGridPos(pos, blockType);
    }
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 2) return; // ignore drags
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
