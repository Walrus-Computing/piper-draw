import { useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import { threeToTqecCell, hasBlockOverlap } from "../types";
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
    if (mode === "place") {
      const pos = threeToTqecCell(e.point.x, 0, e.point.z);
      const store = useBlockStore.getState();
      if (hasBlockOverlap(pos, store.cubeType, store.blocks)) {
        setHoveredGridPos(pos, undefined, true);
      } else {
        setHoveredGridPos(pos);
      }
    } else {
      setHoveredGridPos(null);
    }
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 2) return; // ignore drags
    if (mode === "place") {
      addBlock(threeToTqecCell(e.point.x, 0, e.point.z));
    }
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
