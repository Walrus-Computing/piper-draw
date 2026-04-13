import { useRef, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import {
  tqecToThree,
  createBlockGeometry,
  blockThreeSize,
  hasBlockOverlap,
  getAdjacentPos,
  ALL_BLOCK_TYPES,
  PIPE_TYPES,
} from "../types";
import type { BlockType, Block } from "../types";

const MAX_INITIAL = 1024;

/** Shared 256x256 DataTexture: white interior with a 2px black border on every face. */
const BORDER_TEX = (() => {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const border = 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const onBorder =
        x < border || x >= size - border || y < border || y >= size - border;
      const val = onBorder ? 0 : 255;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
})();

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
  const material = useMemo(
    () => new THREE.MeshLambertMaterial({
      map: BORDER_TEX,
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    [],
  );
  const dummy = useMemo(() => new THREE.Matrix4(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // For pipes, override raycast to use the full box geometry (including open faces)
    let originalRaycast: typeof mesh.raycast | undefined;
    if (isPipe && fullBoxGeometry) {
      originalRaycast = mesh.raycast;
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
      // Restore original raycast on cleanup
      if (originalRaycast) {
        mesh.raycast = originalRaycast;
      }
    };
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
        store.setHoveredGridPos(adj, undefined, true);
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
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, maxCount]}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => useBlockStore.getState().setHoveredGridPos(null)}
      onClick={handleClick}
    />
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
