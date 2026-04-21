import { useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { usePulseScale } from "../hooks/usePulseScale";
import { tqecToThree } from "../types";

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

// Default cube geometry for cursor (1x1x1 in Three.js)
const defaultBox = new THREE.BoxGeometry(1, 1, 1);
const defaultEdges = new THREE.EdgesGeometry(defaultBox);

const noRaycast = () => {};

/** Pulsing cursor at the build position */
function CursorBox({ position }: { position: [number, number, number] }) {
  const groupRef = usePulseScale();

  return (
    <group ref={groupRef} position={position}>
      <mesh
        geometry={defaultBox}
        material={cursorMaterial}
        raycast={noRaycast}
      />
      <lineSegments
        geometry={defaultEdges}
        material={cursorLineMaterial}
        raycast={noRaycast}
      />
    </group>
  );
}

export function BuildCursor() {
  const mode = useBlockStore((s) => s.mode);
  const buildCursor = useBlockStore((s) => s.buildCursor);

  const cursorThree = useMemo(() => {
    if (!buildCursor) return null;
    return tqecToThree(buildCursor, "XZZ") as [number, number, number];
  }, [buildCursor]);

  if (mode !== "build" || !cursorThree) return null;

  // Only renders the pulsing cursor; undetermined cubes are rendered by OpenPipeGhosts
  return <CursorBox position={cursorThree} />;
}
