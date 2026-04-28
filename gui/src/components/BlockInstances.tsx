import { useRef, useLayoutEffect, useMemo, useEffect, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import {
  tqecToThree,
  yBlockZOffset,
  createBlockGeometry,
  createBlockEdges,
  blockThreeSize,
  isPipeType,
  isFreeBuildPipeSpec,
  blockTypeCacheKey,
  posKey,
} from "../types";
import type { Block, BlockType, FaceMask } from "../types";
import {
  decidePlaceModeClick,
  decidePlaceModeHover,
  type PlaceModeState,
} from "./BlockInstances.logic";
import { posInActiveSlice } from "../utils/isoView";

function snapshotPlaceMode(store: ReturnType<typeof useBlockStore.getState>): PlaceModeState {
  return {
    armedTool: store.armedTool,
    cubeType: store.cubeType,
    pipeVariant: store.pipeVariant,
    fbPreset: store.fbPreset,
    freeBuild: store.freeBuild,
    blocks: store.blocks,
    spatialIndex: store.spatialIndex,
  };
}

const DIMMED_OPACITY = 0.18;
const DIMMED_EDGE_OPACITY = 0.25;

const MIN_CAPACITY = 64;

/**
 * Module-level geometry caches — each (block type, hidden-face mask) pair's
 * geometry never changes. Bounded at ~19 types × 64 masks = ~1216 entries max.
 */
const geometryCache = new Map<string, THREE.BufferGeometry>();
const fullBoxCache = new Map<string, THREE.BoxGeometry>();
const edgesCache = new Map<string, THREE.BufferGeometry>();
const edgeLineMaterial = new THREE.LineBasicMaterial({ color: "#000000" });
const dimmedEdgeLineMaterial = new THREE.LineBasicMaterial({
  color: "#000000",
  transparent: true,
  opacity: DIMMED_EDGE_OPACITY,
  depthWrite: false,
});

// eslint-disable-next-line react-refresh/only-export-components
export function getCachedGeometry(blockType: BlockType, hiddenFaces: FaceMask): THREE.BufferGeometry {
  const key = `${blockTypeCacheKey(blockType)}:${hiddenFaces}`;
  let geo = geometryCache.get(key);
  if (!geo) {
    geo = createBlockGeometry(blockType, hiddenFaces);
    geometryCache.set(key, geo);
  }
  return geo;
}

// eslint-disable-next-line react-refresh/only-export-components
export function getCachedEdges(blockType: BlockType, hiddenFaces: FaceMask): THREE.BufferGeometry {
  const key = `${blockTypeCacheKey(blockType)}:${hiddenFaces}`;
  let geo = edgesCache.get(key);
  if (!geo) {
    geo = createBlockEdges(blockType, hiddenFaces);
    edgesCache.set(key, geo);
  }
  return geo;
}

// eslint-disable-next-line react-refresh/only-export-components
export function getCachedFullBox(blockType: BlockType): THREE.BoxGeometry {
  const key = blockTypeCacheKey(blockType);
  let geo = fullBoxCache.get(key);
  if (!geo) {
    geo = new THREE.BoxGeometry(...blockThreeSize(blockType));
    fullBoxCache.set(key, geo);
  }
  return geo;
}

function TypedInstances({
  cubeType,
  blocks,
  hiddenFaces,
  allBlocks,
  dimmed,
}: {
  cubeType: BlockType;
  blocks: Block[];
  hiddenFaces: FaceMask;
  allBlocks: Map<string, Block>;
  dimmed: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const blocksRef = useRef(blocks);
  useEffect(() => {
    blocksRef.current = blocks;
  });
  const [capacity, setCapacity] = useState(MIN_CAPACITY);

  // Double capacity when needed; never shrink (avoids thrashing remounts)
  let maxCount = capacity;
  while (maxCount < blocks.length) maxCount *= 2;
  if (maxCount !== capacity) setCapacity(maxCount);

  const pipe = isPipeType(cubeType) || isFreeBuildPipeSpec(cubeType);
  const geometry = getCachedGeometry(cubeType, hiddenFaces);
  const fullBoxGeometry = pipe ? getCachedFullBox(cubeType) : null;
  const material = useMemo(
    () => new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: dimmed,
      opacity: dimmed ? DIMMED_OPACITY : 1,
      depthWrite: !dimmed,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    [dimmed],
  );
  const dummy = useMemo(() => new THREE.Matrix4(), []);

  // Build batched edge wireframe geometry
  const edgeTemplate = getCachedEdges(cubeType, hiddenFaces);
  const templatePositions = edgeTemplate.getAttribute("position").array as Float32Array;
  const vertCount = templatePositions.length / 3;

  const isY = cubeType === "Y";

  const batchedEdgesGeo = useMemo(() => {
    if (blocks.length === 0) return null;
    const totalVerts = blocks.length * vertCount;
    const positions = new Float32Array(totalVerts * 3);
    for (let i = 0; i < blocks.length; i++) {
      const zo = isY ? yBlockZOffset(blocks[i].pos, allBlocks) : 0;
      const [tx, ty, tz] = tqecToThree(blocks[i].pos, cubeType, zo);
      const offset = i * vertCount * 3;
      for (let v = 0; v < vertCount; v++) {
        const vi = v * 3;
        positions[offset + vi] = templatePositions[vi] + tx;
        positions[offset + vi + 1] = templatePositions[vi + 1] + ty;
        positions[offset + vi + 2] = templatePositions[vi + 2] + tz;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [blocks, cubeType, templatePositions, vertCount, isY, allBlocks]);

  // Dispose old batched edge geometry
  useEffect(() => {
    return () => { batchedEdgesGeo?.dispose(); };
  }, [batchedEdgesGeo]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // For pipes, override raycast to use the full box geometry (including open faces)
    if (pipe && fullBoxGeometry) {
      const realGeo = mesh.geometry;
      mesh.raycast = function (raycaster, intersects) {
        this.geometry = fullBoxGeometry;
        THREE.InstancedMesh.prototype.raycast.call(this, raycaster, intersects);
        this.geometry = realGeo;
      };
    }

    // Set instance matrices and compute bounding sphere in a single pass
    // (avoids Three.js computeBoundingSphere which decomposes matrices)
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < blocks.length; i++) {
      const zo = isY ? yBlockZOffset(blocks[i].pos, allBlocks) : 0;
      const [tx, ty, tz] = tqecToThree(blocks[i].pos, cubeType, zo);
      dummy.makeTranslation(tx, ty, tz);
      mesh.setMatrixAt(i, dummy);
      if (tx < minX) minX = tx; if (tx > maxX) maxX = tx;
      if (ty < minY) minY = ty; if (ty > maxY) maxY = ty;
      if (tz < minZ) minZ = tz; if (tz > maxZ) maxZ = tz;
    }
    mesh.count = blocks.length;
    mesh.instanceMatrix.needsUpdate = true;

    if (blocks.length > 0) {
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
      const dx = (maxX - minX) / 2, dy = (maxY - minY) / 2, dz = (maxZ - minZ) / 2;
      const [bx, by, bz] = blockThreeSize(cubeType);
      const halfDiag = Math.sqrt(bx * bx + by * by + bz * bz) / 2;
      if (!mesh.boundingSphere) mesh.boundingSphere = new THREE.Sphere();
      mesh.boundingSphere.center.set(cx, cy, cz);
      mesh.boundingSphere.radius = Math.sqrt(dx * dx + dy * dy + dz * dz) + halfDiag;
    }

    return () => {
      // Remove instance override, falls back to prototype — safe under Strict Mode double-mount
      if (pipe) {
        delete (mesh as any).raycast; // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    };
  }, [blocks, dummy, pipe, fullBoxGeometry, cubeType]);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const b = blocksRef.current;
    if (e.instanceId == null || e.instanceId >= b.length) return;
    const store = useBlockStore.getState();
    // X-held delete preview: show a red hover on the block itself, no ghost.
    if (store.xHeld && store.mode === "edit") {
      store.setHoveredGridPos(b[e.instanceId].pos, b[e.instanceId].type);
      return;
    }
    const armed = store.armedTool;
    if (
      store.mode === "build" ||
      (store.mode === "edit" && armed === "pointer")
    ) {
      // Read the actual block type from the instance, not the group prop
      store.setHoveredGridPos(b[e.instanceId].pos, b[e.instanceId].type);
    } else if (store.mode === "edit" && armed === "paste") {
      // Paste mode: track the hovered block's cube-slot so PasteGhost keeps
      // following the cursor even when it's over scene geometry.
      store.setHoveredGridPos(b[e.instanceId].pos);
    } else if (store.mode === "edit" && armed === "port") {
      // Port-conversion tool: no ghost preview on existing blocks — the click
      // either removes the cube or does nothing (and sets a warning).
      store.setHoveredGridPos(null);
    } else if (
      store.mode === "edit" &&
      armed === "pipe" &&
      store.fbPreset &&
      isFreeBuildPipeSpec(b[e.instanceId].type)
    ) {
      // Mirrors the click branch below: hovering an existing FB pipe with an
      // FB preset armed will select it on click, not place adjacent — so
      // suppress the place-adjacent ghost.
      store.setHoveredGridPos(null);
    } else {
      // Place mode: pure decision logic lives in BlockInstances.logic.ts so
      // the cube-replace gate and FB/TQEC pipe paths are unit-testable.
      const intent = decidePlaceModeHover(snapshotPlaceMode(store), b[e.instanceId], e.face?.normal ?? null);
      if (intent.kind === "clear") {
        store.setHoveredGridPos(null);
      } else {
        store.setHoveredGridPos(intent.pos, intent.type, intent.invalid, intent.reason, intent.replace);
      }
    }
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 2) return;
    const b = blocksRef.current;
    if (e.instanceId == null || e.instanceId >= b.length) return;
    const store = useBlockStore.getState();
    if (store.isDraggingSelection) return;
    // X-held single-click delete (Drag / Drop mode only) short-circuits everything.
    if (store.xHeld && store.mode === "edit") {
      store.removeBlock(b[e.instanceId].pos);
      return;
    }
    if (store.mode === "build") {
      // In Keyboard Build mode, clicking a cube moves the cursor there
      const clicked = b[e.instanceId];
      if (!isPipeType(clicked.type)) {
        store.moveBuildCursor(clicked.pos);
      }
      return;
    }
    const armed = store.armedTool;
    if (armed === "pointer") {
      store.selectBlock(b[e.instanceId].pos, e.nativeEvent.shiftKey);
      return;
    }
    // Free Build: clicking an existing FB pipe focuses it (opens the variants
    // picker, enables Backspace-to-delete) instead of trying to place an
    // adjacent pipe. Chain-extension still works via the port ghosts at open
    // endpoints. Without this, the user has no way to select an FB pipe while
    // an FB preset is armed (armedTool === "pipe").
    if (armed === "pipe" && store.fbPreset && isFreeBuildPipeSpec(b[e.instanceId].type)) {
      store.selectBlock(b[e.instanceId].pos, e.nativeEvent.shiftKey);
      return;
    }
    if (armed === "paste") {
      // Paste mode: click commits the clipboard at the hovered cell.
      store.commitPaste();
      return;
    }
    // Port-conversion tool: click on a cube to remove it (leaving a port
    // if a pipe was attached). Never falls through to pipe-placement.
    if (armed === "port") {
      store.convertBlockToPort(b[e.instanceId].pos);
      return;
    }
    const action = decidePlaceModeClick(snapshotPlaceMode(store), b[e.instanceId], e.face?.normal ?? null);
    if (action.kind === "place-at") store.addBlock(action.pos);
  };

  if (blocks.length === 0) return null;

  return (
    <>
      <instancedMesh
        key={maxCount}
        ref={meshRef}
        args={[geometry, material, maxCount]}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => useBlockStore.getState().setHoveredGridPos(null)}
        onClick={handleClick}
      />
      {batchedEdgesGeo && (
        <lineSegments geometry={batchedEdgesGeo} material={dimmed ? dimmedEdgeLineMaterial : edgeLineMaterial} />
      )}
    </>
  );
}

export function BlockInstances() {
  const blocks = useBlockStore((s) => s.blocks);
  const hiddenFaces = useBlockStore((s) => s.hiddenFaces);
  const viewMode = useBlockStore((s) => s.viewMode);
  const flowVizMode = useBlockStore((s) => s.flowVizMode);

  const grouped = useMemo(() => {
    type Group = {
      type: BlockType;
      hiddenFaces: FaceMask;
      dimmed: boolean;
      blocks: Block[];
    };
    const map = new Map<string, Group>();
    for (const block of blocks.values()) {
      const hf = hiddenFaces.get(posKey(block.pos)) ?? 0;
      const dimmed =
        flowVizMode ||
        (viewMode.kind === "iso" && !posInActiveSlice(viewMode, block.pos));
      const key = `${blockTypeCacheKey(block.type)}:${hf}:${dimmed ? 1 : 0}`;
      const existing = map.get(key);
      if (existing) {
        existing.blocks.push(block);
      } else {
        map.set(key, {
          type: block.type,
          hiddenFaces: hf,
          dimmed,
          blocks: [block],
        });
      }
    }
    return map;
  }, [blocks, hiddenFaces, viewMode, flowVizMode]);

  return (
    <>
      {Array.from(grouped.entries()).map(([key, group]) => (
        <TypedInstances
          key={key}
          cubeType={group.type}
          hiddenFaces={group.hiddenFaces}
          blocks={group.blocks}
          allBlocks={blocks}
          dimmed={group.dimmed}
        />
      ))}
    </>
  );
}
