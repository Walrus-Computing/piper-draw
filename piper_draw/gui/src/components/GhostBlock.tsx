import { useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, createCubeGeometry } from "../types";

export function GhostBlock() {
  const hoveredGridPos = useBlockStore((s) => s.hoveredGridPos);
  const mode = useBlockStore((s) => s.mode);
  const cubeType = useBlockStore((s) => s.cubeType);

  const ghostGeometry = useMemo(() => createCubeGeometry(cubeType), [cubeType]);
  const ghostMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    [],
  );

  if (!hoveredGridPos) return null;

  const [x, y, z] = tqecToThree(hoveredGridPos);
  const isDelete = mode === "delete";

  return (
    <mesh position={[x, y, z]} scale={isDelete ? 1.01 : 1}>
      {isDelete ? (
        <>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color="#ff4444"
            transparent
            opacity={0.5}
            depthWrite={false}
          />
        </>
      ) : (
        <primitive object={ghostGeometry} attach="geometry" />
      )}
      {!isDelete && <primitive object={ghostMaterial} attach="material" />}
    </mesh>
  );
}
