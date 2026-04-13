import { useRef, useLayoutEffect, useMemo, useEffect } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import {
  tqecToThree,
  createBlockGeometry,
  createBlockEdges,
  blockThreeSize,
  hasBlockOverlap,
  isValidPos,
  resolvePipeType,
  getAdjacentPos,
  getHiddenFaceMaskForPos,
  buildSpatialIndex,
  VARIANT_AXIS_MAP,
  PIPE_TYPES,
} from "../types";
import type { BlockType, Block, FaceMask, Position3D, PipeVariant } from "../types";

const MIN_CAPACITY = 64;

/** Module-level geometry caches — each block type and hidden-face mask pair's geometry never changes. */
const geometryCache = new Map<string, THREE.BufferGeometry>();
const fullBoxCache = new Map<BlockType, THREE.BoxGeometry>();
const edgesCache = new Map<string, THREE.BufferGeometry>();

function resolvePipeTypeFromFace(
  srcPos: Position3D,
  srcType: BlockType,
  normal: THREE.Vector3,
  variant: PipeVariant,
): BlockType | null {
  for (const candidateType of VARIANT_AXIS_MAP[variant]) {
    const probe = getAdjacentPos(srcPos, srcType, normal, candidateType);
    const resolved = resolvePipeType(variant, probe);
    if (resolved) return resolved;
  }
  return null;
}

export function getCachedGeometry(blockType: BlockType, hiddenFaces: FaceMask): THREE.BufferGeometry {
  const key = `${blockType}:${hiddenFaces}`;
  let geo = geometryCache.get(key);
  if (!geo) {
    geo = createBlockGeometry(blockType, hiddenFaces);
    geometryCache.set(key, geo);
  }
  return geo;
}

export function getCachedEdges(blockType: BlockType, hiddenFaces: FaceMask): THREE.BufferGeometry {
  const key = `${blockType}:${hiddenFaces}`;
  let geo = edgesCache.get(key);
  if (!geo) {
    geo = createBlockEdges(blockType, hiddenFaces);
    edgesCache.set(key, geo);
  }
  return geo;
}

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
}: {
  cubeType: BlockType;
  blocks: Block[];
  hiddenFaces: FaceMask;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const capacityRef = useRef(MIN_CAPACITY);

  // Double capacity when needed; never shrink (avoids thrashing remounts)
  if (blocks.length > capacityRef.current) {
    while (capacityRef.current < blocks.length) {
      capacityRef.current *= 2;
    }
  }
  const maxCount = capacityRef.current;

  const isPipe = (PIPE_TYPES as readonly string[]).includes(cubeType);
  const geometry = getCachedGeometry(cubeType, hiddenFaces);
  const fullBoxGeometry = isPipe ? getCachedFullBox(cubeType) : null;
  const material = useMemo(
    () => new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
    [],
  );
  const dummy = useMemo(() => new THREE.Matrix4(), []);

  // Build batched edge wireframe geometry
  const edgeTemplate = getCachedEdges(cubeType, hiddenFaces);
  const templatePositions = edgeTemplate.getAttribute("position").array as Float32Array;
  const vertCount = templatePositions.length / 3;

  const batchedEdgesGeo = useMemo(() => {
    if (blocks.length === 0) return null;
    const totalVerts = blocks.length * vertCount;
    const positions = new Float32Array(totalVerts * 3);
    for (let i = 0; i < blocks.length; i++) {
      const [tx, ty, tz] = tqecToThree(blocks[i].pos, cubeType);
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
  }, [blocks, cubeType, templatePositions, vertCount]);

  // Dispose old batched edge geometry
  useEffect(() => {
    return () => { batchedEdgesGeo?.dispose(); };
  }, [batchedEdgesGeo]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // For pipes, override raycast to use the full box geometry (including open faces)
    if (isPipe && fullBoxGeometry) {
      const realGeo = mesh.geometry;
      mesh.raycast = function (raycaster, intersects) {
        this.geometry = fullBoxGeometry;
        THREE.InstancedMesh.prototype.raycast.call(this, raycaster, intersects);
        this.geometry = realGeo;
      };
    }

    for (let i = 0; i < blocks.length; i++) {
      const [tx, ty, tz] = tqecToThree(blocks[i].pos, cubeType);
      dummy.makeTranslation(tx, ty, tz);
      mesh.setMatrixAt(i, dummy);
    }
    mesh.count = blocks.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();

    return () => {
      // Remove instance override, falls back to prototype — safe under Strict Mode double-mount
      if (isPipe) {
        delete (mesh as any).raycast;
      }
    };
  }, [blocks, dummy, isPipe, fullBoxGeometry, cubeType]);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const b = blocksRef.current;
    if (e.instanceId == null || e.instanceId >= b.length) return;
    const store = useBlockStore.getState();
    if (store.mode === "delete") {
      store.setHoveredGridPos(b[e.instanceId].pos, cubeType);
    } else {
      if (!e.face) return;

      // Determine the destination block type
      let dstType: BlockType = store.cubeType;
      if (store.pipeVariant) {
        const resolved = resolvePipeTypeFromFace(b[e.instanceId].pos, cubeType, e.face.normal, store.pipeVariant);
        if (!resolved) {
          store.setHoveredGridPos(b[e.instanceId].pos, undefined, true);
          return;
        }
        dstType = resolved;
      }

      const adj = getAdjacentPos(b[e.instanceId].pos, cubeType, e.face.normal, dstType);

      if (!isValidPos(adj, dstType) || hasBlockOverlap(adj, dstType, store.blocks)) {
        store.setHoveredGridPos(adj, dstType, true);
      } else {
        store.setHoveredGridPos(adj, dstType);
      }
    }
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 2) return;
    const b = blocksRef.current;
    if (e.instanceId == null || e.instanceId >= b.length) return;
    const store = useBlockStore.getState();
    if (store.mode === "delete") {
      store.removeBlock(b[e.instanceId].pos);
    } else {
      if (!e.face) return;

      let dstType: BlockType = store.cubeType;
      if (store.pipeVariant) {
        const resolved = resolvePipeTypeFromFace(b[e.instanceId].pos, cubeType, e.face.normal, store.pipeVariant);
        if (!resolved) return;
        dstType = resolved;
      }

      const adj = getAdjacentPos(b[e.instanceId].pos, cubeType, e.face.normal, dstType);
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
        <lineSegments geometry={batchedEdgesGeo}>
          <lineBasicMaterial color="#000000" />
        </lineSegments>
      )}
    </>
  );
}

export function BlockInstances() {
  const blocks = useBlockStore((s) => s.blocks);

  const grouped = useMemo(() => {
    type Group = {
        type: BlockType;
      hiddenFaces: FaceMask;
      blocks: Block[];
    };
    const index = buildSpatialIndex(blocks);
    const map = new Map<string, Group>();
    for (const block of blocks.values()) {
      const hiddenFaces = getHiddenFaceMaskForPos(block.pos, block.type, blocks, index);
      const key = `${block.type}:${hiddenFaces}`;
      const existing = map.get(key);
      if (existing) {
        existing.blocks.push(block);
      } else {
        map.set(key, {
          type: block.type,
          hiddenFaces,
          blocks: [block],
        });
      }
    }
    return map;
  }, [blocks]);

  return (
    <>
      {Array.from(grouped.values()).map((group) => (
        <TypedInstances
          key={`${group.type}:${group.hiddenFaces}`}
          cubeType={group.type}
          hiddenFaces={group.hiddenFaces}
          blocks={group.blocks}
        />
      ))}
    </>
  );
}
