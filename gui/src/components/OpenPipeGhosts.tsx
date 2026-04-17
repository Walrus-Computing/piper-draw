import { useMemo, useCallback } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import {
  tqecToThree,
  posKey,
  isPipeType,
  isValidPos,
  hasBlockOverlap,
  hasPipeColorConflict,
  hasCubeColorConflict,
  hasYCubePipeAxisConflict,
  resolvePipeType,
} from "../types";
import type { Position3D, Block, BlockType, CubeType } from "../types";

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
 * Interactive ghost cube at an open pipe endpoint.
 * In place mode, hovering shows the placement preview and clicking places the block.
 */
function InteractiveGhost({ pos, threePos }: { pos: Position3D; threePos: [number, number, number] }) {
  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const store = useBlockStore.getState();
    if (store.mode !== "place") return;

    let blockType: BlockType = store.cubeType;
    if (store.pipeVariant) {
      const resolved = resolvePipeType(store.pipeVariant, pos);
      if (!resolved) { store.setHoveredGridPos(pos, undefined, true); return; }
      blockType = resolved;
    }

    if (!isValidPos(pos, blockType) || hasBlockOverlap(pos, blockType, store.blocks, store.spatialIndex)) {
      store.setHoveredGridPos(pos, blockType, true);
    } else if (isPipeType(blockType) && hasPipeColorConflict(blockType, pos, store.blocks)) {
      store.setHoveredGridPos(pos, blockType, true, "Pipe colors don't match the adjacent cube");
    } else if (!isPipeType(blockType) && blockType !== "Y" && hasCubeColorConflict(blockType as CubeType, pos, store.blocks)) {
      store.setHoveredGridPos(pos, blockType, true, "Cube colors don't match the adjacent pipe");
    } else if (hasYCubePipeAxisConflict(blockType, pos, store.blocks)) {
      store.setHoveredGridPos(pos, blockType, true, "Y cube cannot be next to an X-open or Y-open pipe");
    } else {
      store.setHoveredGridPos(pos, blockType);
    }
  }, [pos]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 2) return;
    const store = useBlockStore.getState();
    if (store.mode !== "place") return;
    store.addBlock(pos);
  }, [pos]);

  const handlePointerLeave = useCallback(() => {
    useBlockStore.getState().setHoveredGridPos(null);
  }, []);

  return (
    <group position={threePos}>
      <mesh
        geometry={defaultBox}
        material={ghostMaterial}
        onPointerMove={handlePointerMove}
        onClick={handleClick}
        onPointerLeave={handlePointerLeave}
      />
      <lineSegments
        geometry={defaultEdges}
        material={ghostLineMaterial}
        raycast={noRaycast}
      />
    </group>
  );
}

/**
 * Non-interactive ghost cube (for delete/select/build modes).
 */
function StaticGhost({ threePos }: { threePos: [number, number, number] }) {
  return (
    <group position={threePos}>
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
  );
}

/**
 * Renders white semi-transparent ghost cubes at open pipe endpoints
 * and at undetermined cube positions. In place mode, ghosts at open
 * pipe endpoints are interactive — hovering shows the placement preview
 * and clicking places the block.
 */
export function OpenPipeGhosts() {
  const blocks = useBlockStore((s) => s.blocks);
  const undeterminedCubes = useBlockStore((s) => s.undeterminedCubes);
  const mode = useBlockStore((s) => s.mode);
  const buildCursor = useBlockStore((s) => s.buildCursor);

  const isPlaceMode = mode === "place";

  const { pipeEndpoints, undetermined } = useMemo(() => {
    const pipeEndpoints: Array<{ key: string; pos: Position3D; threePos: [number, number, number] }> = [];
    const undetermined: Array<{ key: string; threePos: [number, number, number] }> = [];
    const seen = new Set<string>();

    // Ghost cubes at open pipe endpoints (positions with no block)
    // In build mode, skip the cursor position — BuildCursor renders it with a pulse.
    const cursorKey = buildCursor ? posKey(buildCursor) : null;
    for (const pos of getOpenPipeEndpoints(blocks)) {
      const key = posKey(pos);
      if (mode === "build" && key === cursorKey) continue;
      seen.add(key);
      pipeEndpoints.push({
        key,
        pos,
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
      undetermined.push({
        key,
        threePos: tqecToThree(block.pos, block.type) as [number, number, number],
      });
    }

    return { pipeEndpoints, undetermined };
  }, [blocks, undeterminedCubes, mode, buildCursor]);

  if (pipeEndpoints.length === 0 && undetermined.length === 0) return null;

  return (
    <>
      {pipeEndpoints.map(({ key, pos, threePos }) =>
        isPlaceMode ? (
          <InteractiveGhost key={key} pos={pos} threePos={threePos} />
        ) : (
          <StaticGhost key={key} threePos={threePos} />
        )
      )}
      {undetermined.map(({ key, threePos }) => (
        <StaticGhost key={key} threePos={threePos} />
      ))}
    </>
  );
}
