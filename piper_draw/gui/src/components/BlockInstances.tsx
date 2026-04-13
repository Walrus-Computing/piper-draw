import { useRef, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import {
  tqecToThree,
  createBlockGeometry,
  createBlockEdges,
  blockThreeSize,
  hasBlockOverlap,
  getAdjacentPos,
  ALL_BLOCK_TYPES,
  PIPE_TYPES,
} from "../types";
import type { BlockType, Block } from "../types";

const MAX_INITIAL = 1024;

function TypedInstances({
  cubeType,
  blocks,
}: {
  cubeType: BlockType;
  blocks: Block[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const isPipe = (PIPE_TYPES as readonly string[]).includes(cubeType);
  const geometry = useMemo(() => createBlockGeometry(cubeType), [cubeType]);
  // Full box geometry for pipe raycast (includes open faces)
  const fullBoxGeometry = useMemo(
    () => isPipe ? new THREE.BoxGeometry(...blockThreeSize(cubeType)) : null,
    [cubeType, isPipe],
  );
  const edgeTemplate = useMemo(() => {
    const edges = createBlockEdges(cubeType);
    return edges.getAttribute("position").array as Float32Array;
  }, [cubeType]);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: isPipe ? THREE.DoubleSide : THREE.FrontSide,
    }),
    [isPipe],
  );
  const edgesMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: 0x000000 }),
    [],
  );
  const dummy = useMemo(() => new THREE.Matrix4(), []);

  // Merged edge geometry: one BufferGeometry with all edge lines for all blocks
  const mergedEdges = useMemo(() => {
    if (blocks.length === 0) return null;
    const vertsPerBlock = edgeTemplate.length; // floats (x,y,z per vertex)
    const merged = new Float32Array(blocks.length * vertsPerBlock);
    for (let i = 0; i < blocks.length; i++) {
      const [tx, ty, tz] = tqecToThree(blocks[i].pos, cubeType);
      const offset = i * vertsPerBlock;
      for (let j = 0; j < vertsPerBlock; j += 3) {
        merged[offset + j] = edgeTemplate[j] + tx;
        merged[offset + j + 1] = edgeTemplate[j + 1] + ty;
        merged[offset + j + 2] = edgeTemplate[j + 2] + tz;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(merged, 3));
    return geo;
  }, [blocks, edgeTemplate, cubeType]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // For pipes, override raycast to use the full box geometry (including open faces)
    if (isPipe && fullBoxGeometry) {
      const originalRaycast = THREE.InstancedMesh.prototype.raycast;
      const realGeo = mesh.geometry;
      mesh.raycast = function (raycaster, intersects) {
        this.geometry = fullBoxGeometry;
        originalRaycast.call(this, raycaster, intersects);
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
  }, [blocks, dummy, isPipe, fullBoxGeometry]);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const b = blocksRef.current;
    if (e.instanceId == null || e.instanceId >= b.length) return;
    const store = useBlockStore.getState();
    if (store.mode === "delete") {
      store.setHoveredGridPos(b[e.instanceId].pos, cubeType);
    } else {
      if (!e.face) return;
      const adj = getAdjacentPos(b[e.instanceId].pos, cubeType, e.face.normal, store.cubeType);
      if (hasBlockOverlap(adj, store.cubeType, store.blocks)) {
        store.setHoveredGridPos(null);
      } else {
        store.setHoveredGridPos(adj);
      }
    }
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 2) return;
    const b = blocksRef.current;
    if (e.instanceId == null || e.instanceId >= b.length) return;
    const { mode, cubeType: selectedType, addBlock, removeBlock } = useBlockStore.getState();
    if (mode === "delete") {
      removeBlock(b[e.instanceId].pos);
    } else {
      if (!e.face) return;
      const adj = getAdjacentPos(b[e.instanceId].pos, cubeType, e.face.normal, selectedType);
      addBlock(adj);
    }
  };

  if (blocks.length === 0) return null;

  const maxCount = Math.max(MAX_INITIAL, blocks.length);

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, maxCount]}
        onPointerMove={handlePointerMove}
        onClick={handleClick}
      />
      {mergedEdges && (
        <lineSegments>
          <primitive object={mergedEdges} attach="geometry" />
          <primitive object={edgesMaterial} attach="material" />
        </lineSegments>
      )}
    </>
  );
}

export function BlockInstances() {
  const blocks = useBlockStore((s) => s.blocks);

  const grouped = useMemo(() => {
    const map = new Map<BlockType, Block[]>();
    for (const ct of ALL_BLOCK_TYPES) map.set(ct, []);
    for (const block of blocks.values()) {
      map.get(block.type)!.push(block);
    }
    return map;
  }, [blocks]);

  return (
    <>
      {ALL_BLOCK_TYPES.map((ct) => (
        <TypedInstances
          key={ct}
          cubeType={ct}
          blocks={grouped.get(ct)!}
        />
      ))}
    </>
  );
}
