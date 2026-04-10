import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import { threeToTqecCell, blockTqecSize } from "../types";
import type { Position3D, BlockType, Block } from "../types";

const GRID_SIZE = 200;

function overlapsAny(pos: Position3D, type: BlockType, blocks: Map<string, Block>): boolean {
  const sz = blockTqecSize(type);
  for (const block of blocks.values()) {
    const bs = blockTqecSize(block.type);
    if (
      pos.x < block.pos.x + bs[0] && pos.x + sz[0] > block.pos.x &&
      pos.y < block.pos.y + bs[1] && pos.y + sz[1] > block.pos.y &&
      pos.z < block.pos.z + bs[2] && pos.z + sz[2] > block.pos.z
    ) {
      return true;
    }
  }
  return false;
}

export function GridPlane() {
  const addBlock = useBlockStore((s) => s.addBlock);
  const mode = useBlockStore((s) => s.mode);
  const setHoveredGridPos = useBlockStore((s) => s.setHoveredGridPos);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (mode === "place") {
      const pos = threeToTqecCell(e.point.x, 0, e.point.z);
      const store = useBlockStore.getState();
      if (overlapsAny(pos, store.cubeType, store.blocks)) {
        setHoveredGridPos(null);
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
