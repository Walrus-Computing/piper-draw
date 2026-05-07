import { useMemo, useCallback } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import { usePulseScale } from "../hooks/usePulseScale";
import {
  tqecToThree,
  posKey,
  isPipeType,
  isValidPos,
  hasBlockOverlap,
  hasCubeColorConflict,
  hasYCubePipeAxisConflict,
  validatePipePlacement,
  getAdjacentPos,
  getAllPortPositions,
} from "../types";
import { resolvePipeTypeFromFace } from "./BlockInstances";
import type { Position3D, BlockType, CubeType } from "../types";

// Sentinel cube type for sizing/face-normal calculations on a port (which has
// no real type). All standard cubes are 1×1×1 in grid units, so any concrete
// cube type produces the right offsets for getAdjacentPos.
const PORT_SENTINEL_TYPE: BlockType = "XZZ";

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

const selectionHighlightMaterial = new THREE.MeshBasicMaterial({
  color: 0x4a9eff,
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const selectionOutlineMaterial = new THREE.LineBasicMaterial({
  color: 0x4a9eff,
  linewidth: 2,
});

const defaultBox = new THREE.BoxGeometry(1, 1, 1);
const defaultEdges = new THREE.EdgesGeometry(defaultBox);
const highlightBox = new THREE.BoxGeometry(1.04, 1.04, 1.04);
const highlightEdges = new THREE.EdgesGeometry(highlightBox);

const noRaycast = () => {};

/**
 * Interactive ghost cube at an open pipe endpoint.
 * In place mode, hovering shows the placement preview and clicking places the block.
 */
function InteractiveGhost({ pos, threePos }: { pos: Position3D; threePos: [number, number, number] }) {
  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const store = useBlockStore.getState();
    if (store.mode !== "edit" || store.xHeld) return;
    if (store.armedTool === "pointer") return;
    // Paste mode: let GridPlane's pointerMove drive hoveredGridPos; the port
    // ghost is not a valid paste target on its own, but we must NOT fall
    // through into cube-placement logic below.
    if (store.armedTool === "paste") return;

    // The port tool targets existing cubes, not ports — clicking a port is a no-op,
    // so don't render a misleading placement preview.
    if (store.armedTool === "port") {
      store.setHoveredGridPos(null);
      return;
    }

    if (store.armedTool === "pipe" && store.pipeVariant) {
      // Pipe placement adjacent to a port: use the hovered face normal to compute
      // which adjacent pipe slot to target, mirroring BlockInstances' face logic.
      if (!e.face) {
        store.setHoveredGridPos(null);
        return;
      }
      const resolved = resolvePipeTypeFromFace(pos, PORT_SENTINEL_TYPE, e.face.normal, store.pipeVariant);
      if (!resolved) {
        store.setHoveredGridPos(null);
        return;
      }
      const adj = getAdjacentPos(pos, PORT_SENTINEL_TYPE, e.face.normal, resolved);
      const adjKey = posKey(adj);
      const existingKey = store.blocks.has(adjKey) ? adjKey : undefined;
      const adjReplace = !!(existingKey && store.blocks.get(existingKey)!.type !== resolved);
      if (!isValidPos(adj, resolved) || hasBlockOverlap(adj, resolved, store.blocks, store.spatialIndex, existingKey)) {
        store.setHoveredGridPos(adj, resolved, true, undefined, adjReplace);
      } else if (existingKey && store.blocks.get(existingKey)!.type === resolved) {
        store.setHoveredGridPos(null);
      } else if (!store.freeBuild && isPipeType(resolved) && !validatePipePlacement(resolved, adj, store.blocks).ok) {
        store.setHoveredGridPos(adj, resolved, true, "Pipe colors don't match the adjacent cube", adjReplace);
      } else if (!store.freeBuild && hasYCubePipeAxisConflict(resolved, adj, store.blocks)) {
        store.setHoveredGridPos(adj, resolved, true, "Y cube cannot be next to an X-open or Y-open pipe", adjReplace);
      } else {
        store.setHoveredGridPos(adj, resolved, false, undefined, adjReplace);
      }
      return;
    }
    const blockType: BlockType = store.cubeType;

    if (!isValidPos(pos, blockType) || hasBlockOverlap(pos, blockType, store.blocks, store.spatialIndex)) {
      store.setHoveredGridPos(pos, blockType, true);
    } else if (isPipeType(blockType) && !validatePipePlacement(blockType, pos, store.blocks).ok) {
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
    if (store.mode !== "edit" || store.xHeld) return;
    if (store.armedTool === "pointer") return;
    // Paste mode: commit at whatever is currently hovered.
    if (store.armedTool === "paste") {
      store.commitPaste();
      return;
    }
    // Port tool: clicking a port is a no-op (it's already a port).
    if (store.armedTool === "port") return;
    if (store.armedTool === "pipe" && store.pipeVariant) {
      if (!e.face) return;
      const resolved = resolvePipeTypeFromFace(pos, PORT_SENTINEL_TYPE, e.face.normal, store.pipeVariant);
      if (!resolved) return;
      const adj = getAdjacentPos(pos, PORT_SENTINEL_TYPE, e.face.normal, resolved);
      store.addBlock(adj);
      return;
    }
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
 * Port ghost in select mode — clicking toggles it in `selectedPortPositions`.
 */
function SelectablePortGhost({ pos, threePos }: { pos: Position3D; threePos: [number, number, number] }) {
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 2) return;
    const additive = e.shiftKey;
    useBlockStore.getState().togglePortSelection(pos, additive);
  }, [pos]);

  return (
    <group position={threePos}>
      <mesh
        geometry={defaultBox}
        material={ghostMaterial}
        onClick={handleClick}
      />
      <lineSegments
        geometry={defaultEdges}
        material={ghostLineMaterial}
        raycast={noRaycast}
      />
    </group>
  );
}

/** Pulsing blue outline around a selected port. */
function PortSelectionHighlight({ threePos }: { threePos: [number, number, number] }) {
  const groupRef = usePulseScale();
  return (
    <group ref={groupRef} position={threePos}>
      <mesh geometry={highlightBox} material={selectionHighlightMaterial} raycast={noRaycast} />
      <lineSegments geometry={highlightEdges} material={selectionOutlineMaterial} raycast={noRaycast} />
    </group>
  );
}

/**
 * Non-interactive ghost cube (for delete tool).
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
 * Port ghost in Keyboard Build mode — clicking moves the build cursor here.
 * Mesh keeps its raycast enabled so clicks register; lineSegments suppress
 * raycast like the other interactive ghost variants.
 */
function BuildPortGhost({ pos, threePos }: { pos: Position3D; threePos: [number, number, number] }) {
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 2) return;
    useBlockStore.getState().moveBuildCursor(pos);
  }, [pos]);

  return (
    <group position={threePos}>
      <mesh
        geometry={defaultBox}
        material={ghostMaterial}
        onClick={handleClick}
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
 * Renders white semi-transparent ghost cubes ("ports") at open pipe endpoints.
 * - Place mode: hovering shows placement preview; clicking places the block.
 * - Select mode: clicking adds the port to `selectedPortPositions` (shift-click = additive).
 * - Keyboard Build mode: clicking moves the build cursor here.
 * - Delete tool: static ghost, no interaction.
 */
export function OpenPipeGhosts() {
  const blocks = useBlockStore((s) => s.blocks);
  const mode = useBlockStore((s) => s.mode);
  const buildCursor = useBlockStore((s) => s.buildCursor);
  const selectedPortPositions = useBlockStore((s) => s.selectedPortPositions);
  const portPositions = useBlockStore((s) => s.portPositions);
  const armedTool = useBlockStore((s) => s.armedTool);
  const xHeld = useBlockStore((s) => s.xHeld);

  const pipeEndpoints = useMemo(() => {
    const result: Array<{ key: string; pos: Position3D; threePos: [number, number, number] }> = [];

    // Ghost cubes at open pipe endpoints (positions with no block).
    // In Keyboard Build mode, skip the cursor position — BuildCursor renders it with a pulse.
    const cursorKey = buildCursor ? posKey(buildCursor) : null;
    for (const pos of getAllPortPositions(blocks, portPositions)) {
      const key = posKey(pos);
      if (mode === "build" && key === cursorKey) continue;
      result.push({
        key,
        pos,
        threePos: tqecToThree(pos, "XZZ") as [number, number, number],
      });
    }

    return result;
  }, [blocks, mode, buildCursor, portPositions]);

  if (pipeEndpoints.length === 0) return null;

  const renderGhost = (
    key: string,
    pos: Position3D,
    threePos: [number, number, number],
  ) => {
    if (mode === "edit" && !xHeld && armedTool !== "pointer") {
      return <InteractiveGhost key={key} pos={pos} threePos={threePos} />;
    }
    if (mode === "edit" && !xHeld && armedTool === "pointer") {
      return <SelectablePortGhost key={key} pos={pos} threePos={threePos} />;
    }
    if (mode === "build") {
      return <BuildPortGhost key={key} pos={pos} threePos={threePos} />;
    }
    return <StaticGhost key={key} threePos={threePos} />;
  };

  const showSelection = mode === "edit" && armedTool === "pointer" && !xHeld;
  return (
    <>
      {pipeEndpoints.map(({ key, pos, threePos }) => renderGhost(key, pos, threePos))}
      {showSelection &&
        pipeEndpoints
          .filter(({ key }) => selectedPortPositions.has(key))
          .map(({ key, threePos }) => (
            <PortSelectionHighlight key={`hl-${key}`} threePos={threePos} />
          ))}
    </>
  );
}
