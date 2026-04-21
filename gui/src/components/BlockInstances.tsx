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
  hasBlockOverlap,
  hasCubeColorConflict,
  hasPipeColorConflict,
  hasYCubePipeAxisConflict,
  isValidPipePos,
  isValidPos,
  isPipeType,
  resolvePipeType,
  getAdjacentPos,
  posKey,
  VARIANT_AXIS_MAP,
} from "../types";
import type { BlockType, CubeType, Block, FaceMask, Position3D, PipeVariant } from "../types";
import { posInActiveSlice } from "../utils/isoView";

const DIMMED_OPACITY = 0.18;
const DIMMED_EDGE_OPACITY = 0.25;

const MIN_CAPACITY = 64;

/**
 * Module-level geometry caches — each (block type, hidden-face mask) pair's
 * geometry never changes. Bounded at ~19 types × 64 masks = ~1216 entries max.
 */
const geometryCache = new Map<string, THREE.BufferGeometry>();
const fullBoxCache = new Map<BlockType, THREE.BoxGeometry>();
const edgesCache = new Map<string, THREE.BufferGeometry>();
const edgeLineMaterial = new THREE.LineBasicMaterial({ color: "#000000" });
const dimmedEdgeLineMaterial = new THREE.LineBasicMaterial({
  color: "#000000",
  transparent: true,
  opacity: DIMMED_EDGE_OPACITY,
  depthWrite: false,
});

// eslint-disable-next-line react-refresh/only-export-components
export function resolvePipeTypeFromFace(
  srcPos: Position3D,
  srcType: BlockType,
  normal: THREE.Vector3,
  variant: PipeVariant,
): BlockType | null {
  for (const candidateType of VARIANT_AXIS_MAP[variant]) {
    const probe = getAdjacentPos(srcPos, srcType, normal, candidateType);
    if (!isValidPipePos(probe)) continue;
    const resolved = resolvePipeType(variant, probe);
    if (resolved) return resolved;
  }
  return null;
}

// eslint-disable-next-line react-refresh/only-export-components
export function getCachedGeometry(blockType: BlockType, hiddenFaces: FaceMask): THREE.BufferGeometry {
  const key = `${blockType}:${hiddenFaces}`;
  let geo = geometryCache.get(key);
  if (!geo) {
    geo = createBlockGeometry(blockType, hiddenFaces);
    geometryCache.set(key, geo);
  }
  return geo;
}

// eslint-disable-next-line react-refresh/only-export-components
export function getCachedEdges(blockType: BlockType, hiddenFaces: FaceMask): THREE.BufferGeometry {
  const key = `${blockType}:${hiddenFaces}`;
  let geo = edgesCache.get(key);
  if (!geo) {
    geo = createBlockEdges(blockType, hiddenFaces);
    edgesCache.set(key, geo);
  }
  return geo;
}

// eslint-disable-next-line react-refresh/only-export-components
export function getCachedFullBox(blockType: BlockType): THREE.BoxGeometry {
  let geo = fullBoxCache.get(blockType);
  if (!geo) {
    geo = new THREE.BoxGeometry(...blockThreeSize(blockType));
    fullBoxCache.set(blockType, geo);
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

  const pipe = isPipeType(cubeType);
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
    } else if (store.mode === "edit" && armed === "port") {
      // Port-conversion tool: no ghost preview on existing blocks — the click
      // either removes the cube or does nothing (and sets a warning).
      store.setHoveredGridPos(null);
    } else {
      // Place mode: check if we can replace the hovered block itself
      const hovered = b[e.instanceId];
      let replaceType: BlockType = store.cubeType;
      if (store.pipeVariant) {
        const resolved = resolvePipeType(store.pipeVariant, hovered.pos);
        if (resolved) replaceType = resolved;
      }
      if (isValidPos(hovered.pos, replaceType) && replaceType !== hovered.type) {
        const hovKey = posKey(hovered.pos);
        if (hasBlockOverlap(hovered.pos, replaceType, store.blocks, store.spatialIndex, hovKey)) {
          store.setHoveredGridPos(hovered.pos, replaceType, true, undefined, true);
        } else if (!store.freeBuild && isPipeType(replaceType) && hasPipeColorConflict(replaceType, hovered.pos, store.blocks)) {
          store.setHoveredGridPos(hovered.pos, replaceType, true, "Pipe colors don't match the adjacent cube", true);
        } else if (!store.freeBuild && !isPipeType(replaceType) && replaceType !== "Y" && hasCubeColorConflict(replaceType as CubeType, hovered.pos, store.blocks)) {
          store.setHoveredGridPos(hovered.pos, replaceType, true, "Cube colors don't match the adjacent pipe", true);
        } else if (!store.freeBuild && hasYCubePipeAxisConflict(replaceType, hovered.pos, store.blocks)) {
          store.setHoveredGridPos(hovered.pos, replaceType, true, "Y cube cannot be next to an X-open or Y-open pipe", true);
        } else {
          store.setHoveredGridPos(hovered.pos, replaceType, false, undefined, true);
        }
        return;
      }

      if (!e.face) return;

      // Determine the destination block type for adjacent placement
      let dstType: BlockType = store.cubeType;
      if (store.pipeVariant) {
        const resolved = resolvePipeTypeFromFace(hovered.pos, hovered.type, e.face.normal, store.pipeVariant);
        if (!resolved) {
          store.setHoveredGridPos(null);
          return;
        }
        dstType = resolved;
      }

      const adj = getAdjacentPos(hovered.pos, hovered.type, e.face.normal, dstType);

      if (!isValidPos(adj, dstType)) {
        store.setHoveredGridPos(null);
        return;
      }
      const adjKey = posKey(adj);
      const existingKey = store.blocks.has(adjKey) ? adjKey : undefined;
      const adjReplace = !!(existingKey && store.blocks.get(existingKey)!.type !== dstType);
      if (hasBlockOverlap(adj, dstType, store.blocks, store.spatialIndex, existingKey)) {
        store.setHoveredGridPos(adj, dstType, true, undefined, adjReplace);
      } else if (existingKey && store.blocks.get(existingKey)!.type === dstType) {
        // Same type — no replacement needed, hide ghost
        store.setHoveredGridPos(null);
      } else if (!store.freeBuild && isPipeType(dstType) && hasPipeColorConflict(dstType, adj, store.blocks)) {
        store.setHoveredGridPos(adj, dstType, true, "Pipe colors don't match the adjacent cube", adjReplace);
      } else if (!store.freeBuild && !isPipeType(dstType) && dstType !== "Y" && hasCubeColorConflict(dstType as CubeType, adj, store.blocks)) {
        store.setHoveredGridPos(adj, dstType, true, "Cube colors don't match the adjacent pipe", adjReplace);
      } else if (!store.freeBuild && hasYCubePipeAxisConflict(dstType, adj, store.blocks)) {
        store.setHoveredGridPos(adj, dstType, true, "Y cube cannot be next to an X-open or Y-open pipe", adjReplace);
      } else {
        store.setHoveredGridPos(adj, dstType, false, undefined, adjReplace);
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
    {
      // Port-conversion tool: click on a cube to remove it (leaving a port
      // if a pipe was attached). Never falls through to pipe-placement.
      if (armed === "port") {
        store.convertBlockToPort(b[e.instanceId].pos);
        return;
      }
      // Place mode: try replacing the clicked block if the selected type
      // is valid at the clicked block's position
      const clicked = b[e.instanceId];
      let replaceType: BlockType = store.cubeType;
      if (store.pipeVariant) {
        const resolved = resolvePipeType(store.pipeVariant, clicked.pos);
        if (resolved) replaceType = resolved;
      }
      if (isValidPos(clicked.pos, replaceType) && replaceType !== clicked.type) {
        store.addBlock(clicked.pos);
        return;
      }

      if (!e.face) return;

      let dstType: BlockType = store.cubeType;
      if (store.pipeVariant) {
        const resolved = resolvePipeTypeFromFace(clicked.pos, clicked.type, e.face.normal, store.pipeVariant);
        if (!resolved) return;
        dstType = resolved;
      }

      const adj = getAdjacentPos(clicked.pos, clicked.type, e.face.normal, dstType);
      store.addBlock(adj);
    }
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
      const dimmed = viewMode.kind === "iso" && !posInActiveSlice(viewMode, block.pos);
      const key = `${block.type}:${hf}:${dimmed ? 1 : 0}`;
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
  }, [blocks, hiddenFaces, viewMode]);

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
