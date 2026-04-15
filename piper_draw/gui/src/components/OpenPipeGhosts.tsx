import { useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, posKey, isPipeType } from "../types";
import type { Position3D, Block } from "../types";

const ghostMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const ghostLineMaterial = new THREE.LineBasicMaterial({
  color: 0x999999,
  linewidth: 1,
});

const defaultBox = new THREE.BoxGeometry(1, 1, 1);
const defaultEdges = new THREE.EdgesGeometry(defaultBox);

const noRaycast = () => {};

/**
 * Find positions at open pipe endpoints where no cube exists.
 * Returns an array of TQEC positions where ghost cubes should appear.
 */
function getOpenPipeEndpoints(blocks: Map<string, Block>): Position3D[] {
  const endpoints: Position3D[] = [];
  const seen = new Set<string>();

  for (const block of blocks.values()) {
    if (!isPipeType(block.type)) continue;

    const base = block.type.replace("H", "");
    const openAxis = base.indexOf("O"); // 0, 1, or 2
    const coords: [number, number, number] = [block.pos.x, block.pos.y, block.pos.z];

    for (const offset of [-1, 2]) {
      const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
      nCoords[openAxis] += offset;
      const pos: Position3D = { x: nCoords[0], y: nCoords[1], z: nCoords[2] };
      const key = posKey(pos);

      // Only add if there's no real block there and we haven't already added it
      if (!blocks.has(key) && !seen.has(key)) {
        seen.add(key);
        endpoints.push(pos);
      }
    }
  }

  return endpoints;
}

/**
 * Renders white semi-transparent ghost cubes at open pipe endpoints.
 * These are visualization-only — not interactive, not exported.
 */
export function OpenPipeGhosts() {
  const blocks = useBlockStore((s) => s.blocks);

  const positions = useMemo(() => {
    const endpoints = getOpenPipeEndpoints(blocks);
    return endpoints.map((pos) => ({
      key: posKey(pos),
      threePos: tqecToThree(pos, "XZZ") as [number, number, number],
    }));
  }, [blocks]);

  if (positions.length === 0) return null;

  return (
    <>
      {positions.map(({ key, threePos }) => (
        <group key={key} position={threePos}>
          <mesh
            geometry={defaultBox}
            material={ghostMaterial}
            raycast={noRaycast}
          />
          <lineSegments
            geometry={defaultEdges}
            material={ghostLineMaterial}
            raycast={noRaycast}
          />
        </group>
      ))}
    </>
  );
}
