import { useBlockStore } from "../stores/blockStore";
import { tqecToThree } from "../types";

export function GhostBlock() {
  const hoveredGridPos = useBlockStore((s) => s.hoveredGridPos);
  const mode = useBlockStore((s) => s.mode);

  if (!hoveredGridPos) return null;

  const [x, y, z] = tqecToThree(hoveredGridPos);
  const isDelete = mode === "delete";

  const scale = isDelete ? 1.01 : 1;

  return (
    <mesh position={[x, y, z]} scale={scale}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={isDelete ? "#ff4444" : "#4a9eff"}
        transparent
        opacity={isDelete ? 0.5 : 0.3}
        depthWrite={false}
      />
    </mesh>
  );
}
