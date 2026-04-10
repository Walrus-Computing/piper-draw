import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import { threeToTqecCell } from "../types";

const GRID_SIZE = 200;

export function GridPlane() {
  const addBlock = useBlockStore((s) => s.addBlock);
  const mode = useBlockStore((s) => s.mode);
  const setHoveredGridPos = useBlockStore((s) => s.setHoveredGridPos);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (mode === "place") {
      setHoveredGridPos(threeToTqecCell(e.point.x, 0, e.point.z));
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

  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[0, 0, 0]}
      onPointerMove={handlePointerMove}
      onClick={handleClick}
      onPointerLeave={handlePointerLeave}
    >
      <planeGeometry args={[GRID_SIZE, GRID_SIZE]} />
      <meshBasicMaterial visible={false} side={THREE.FrontSide} />
    </mesh>
  );
}
