import { useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, posKey, isPipeType } from "../types";
import type { Position3D, Block } from "../types";

const ghostMaterial = new THREE.MeshBasicMaterial({
  color: 0xdddddd,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const ghostLineMaterial = new THREE.LineBasicMaterial({
  color: 0x000000,
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
 * Renders white semi-transparent ghost cubes at open pipe endpoints
 * and at undetermined cube positions. These are visualization-only —
 * not interactive, not exported.
 */
export function OpenPipeGhosts() {
  const blocks = useBlockStore((s) => s.blocks);
  const undeterminedCubes = useBlockStore((s) => s.undeterminedCubes);
  const mode = useBlockStore((s) => s.mode);
  const buildCursor = useBlockStore((s) => s.buildCursor);

  const positions = useMemo(() => {
    const result: Array<{ key: string; threePos: [number, number, number] }> = [];
    const seen = new Set<string>();

    // Ghost cubes at open pipe endpoints (positions with no block)
    // In build mode, skip the cursor position — BuildCursor renders it with a pulse.
    const cursorKey = buildCursor ? posKey(buildCursor) : null;
    for (const pos of getOpenPipeEndpoints(blocks)) {
      const key = posKey(pos);
      if (mode === "build" && key === cursorKey) continue;
      seen.add(key);
      result.push({
        key,
        threePos: tqecToThree(pos, "XZZ") as [number, number, number],
      });
    }

    // Ghost cubes at undetermined cube positions (always visible).
    // In build mode, skip the cursor position — BuildCursor renders it with a pulse.
    for (const [key] of undeterminedCubes) {
      if (seen.has(key)) continue;
      if (mode === "build" && key === cursorKey) continue;
      const block = blocks.get(key);
      if (!block) continue;
      result.push({
        key,
        threePos: tqecToThree(block.pos, block.type) as [number, number, number],
      });
    }

    return result;
  }, [blocks, undeterminedCubes, mode, buildCursor]);

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
