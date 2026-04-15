import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, posKey } from "../types";

const cursorMaterial = new THREE.MeshBasicMaterial({
  color: 0xcccccc,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const cursorLineMaterial = new THREE.LineBasicMaterial({
  color: 0x333333,
  linewidth: 2,
});

const undeterminedMaterial = new THREE.MeshBasicMaterial({
  color: 0xbbbbbb,
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const undeterminedLineMaterial = new THREE.LineBasicMaterial({
  color: 0x555555,
  linewidth: 1,
});

// Default cube geometry for cursor/undetermined cubes (1x1x1 in Three.js)
const defaultBox = new THREE.BoxGeometry(1, 1, 1);
const defaultEdges = new THREE.EdgesGeometry(defaultBox);

const noRaycast = () => {};

/** Pulsing cursor at the build position */
function CursorBox({ position, isCursor }: { position: [number, number, number]; isCursor: boolean }) {
  const groupRef = useRef<THREE.Group>(null!);

  useFrame(({ clock }) => {
    if (!isCursor || !groupRef.current) return;
    // Pulsing scale for cursor (1.03 to 1.09) — never smaller than the block
    const pulse = 1.06 + 0.03 * Math.sin(clock.getElapsedTime() * 4);
    groupRef.current.scale.setScalar(pulse);
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh
        geometry={defaultBox}
        material={isCursor ? cursorMaterial : undeterminedMaterial}
        raycast={noRaycast}
      />
      <lineSegments
        geometry={defaultEdges}
        material={isCursor ? cursorLineMaterial : undeterminedLineMaterial}
        raycast={noRaycast}
      />
    </group>
  );
}

export function BuildCursor() {
  const mode = useBlockStore((s) => s.mode);
  const buildCursor = useBlockStore((s) => s.buildCursor);
  const undeterminedCubes = useBlockStore((s) => s.undeterminedCubes);
  const blocks = useBlockStore((s) => s.blocks);

  const positions = useMemo(() => {
    if (!buildCursor) return { cursor: null, undetermined: [] };

    const cursorKey = posKey(buildCursor);
    // Cursor position in Three.js coords (use default cube size)
    const cursorThree = tqecToThree(buildCursor, "XZZ") as [number, number, number];

    // Collect undetermined cube positions (excluding cursor if it's also undetermined)
    const undetermined: Array<{ key: string; pos: [number, number, number] }> = [];
    for (const [key] of undeterminedCubes) {
      if (key === cursorKey) continue;
      const block = blocks.get(key);
      if (!block) continue;
      undetermined.push({
        key,
        pos: tqecToThree(block.pos, block.type) as [number, number, number],
      });
    }

    return { cursor: cursorThree, undetermined };
  }, [buildCursor, undeterminedCubes, blocks]);

  if (mode !== "build" || !positions.cursor) return null;

  return (
    <>
      <CursorBox position={positions.cursor} isCursor={true} />
      {positions.undetermined.map(({ key, pos }) => (
        <CursorBox key={key} position={pos} isCursor={false} />
      ))}
    </>
  );
}
