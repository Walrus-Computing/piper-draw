import * as THREE from "three";
import {
  blockThreeSize,
  createBlockEdges,
  createBlockGeometry,
  getAdjacentPos,
  isValidPipePos,
  resolvePipeType,
  VARIANT_AXIS_MAP,
} from "../types";
import type { BlockType, FaceMask, PipeVariant, Position3D } from "../types";

/**
 * Module-level geometry caches — each (block type, hidden-face mask) pair's
 * geometry never changes. Bounded at ~19 types × 64 masks = ~1216 entries max.
 *
 * These live in their own module (separate from `BlockInstances.tsx`) so the
 * Vite React plugin can keep Fast Refresh enabled on the component file: HMR
 * Fast Refresh requires component modules to export only components.
 */
const geometryCache = new Map<string, THREE.BufferGeometry>();
const fullBoxCache = new Map<BlockType, THREE.BoxGeometry>();
const edgesCache = new Map<string, THREE.BufferGeometry>();

// HMR cache invalidation: when this module or any of its imports (notably
// `../types` where the geometry constructors live) hot-reloads, the cached
// `BufferGeometry` objects are stale. Dispose them and clear the maps so the
// next render rebuilds from the new constructors.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const g of geometryCache.values()) g.dispose();
    for (const g of fullBoxCache.values()) g.dispose();
    for (const g of edgesCache.values()) g.dispose();
    geometryCache.clear();
    fullBoxCache.clear();
    edgesCache.clear();
  });
  import.meta.hot.accept();
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

/**
 * Sorted-key serialisation of a block's face-color overrides — used as part
 * of the rendering group key so two blocks of the same type/hiddenFaces but
 * different paint state don't share an InstancedMesh.
 */
export function faceColorsKey(faceColors: Record<string, string> | undefined): string {
  if (!faceColors) return "";
  const keys = Object.keys(faceColors);
  if (keys.length === 0) return "";
  keys.sort();
  let s = "";
  for (const k of keys) s += `${k}=${faceColors[k]};`;
  return s;
}

/**
 * Given a clicked source block, the click's world-space normal, and a target
 * pipe variant, pick the concrete pipe type that would be valid at the
 * adjacent slot — or null if no orientation of the variant fits there.
 */
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
