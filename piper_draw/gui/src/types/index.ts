import * as THREE from "three";

export interface Position3D {
  x: number;
  y: number;
  z: number;
}

/**
 * ZXCube types from TQEC. Each string character gives the basis
 * (X or Z) for the face pair on that TQEC axis: [X-axis, Y-axis, Z-axis].
 */
export const CUBE_TYPES = ["XZZ", "ZXZ", "ZXX", "XXZ", "ZZX", "XZX"] as const;
export type CubeType = (typeof CUBE_TYPES)[number];

export type BlockType = CubeType | "Y";
export const ALL_BLOCK_TYPES = [...CUBE_TYPES, "Y"] as const;

export interface Block {
  pos: Position3D;
  type: BlockType;
}

const X_COLOR = new THREE.Color("#ff4444"); // X basis = red
const Z_COLOR = new THREE.Color("#4488ff"); // Z basis = blue
const Y_COLOR = new THREE.Color("#44cc44"); // Y basis = green

/**
 * Face colors per cube type, indexed by TQEC axis: [X, Y, Z].
 * Each entry gives the color for the +/- face pair on that axis.
 */
const CUBE_FACE_COLORS: Record<CubeType, [THREE.Color, THREE.Color, THREE.Color]> = {
  //       [X-axis, Y-axis, Z-axis]
  XZZ: [X_COLOR, Z_COLOR, Z_COLOR],
  ZXZ: [Z_COLOR, X_COLOR, Z_COLOR],
  ZXX: [Z_COLOR, X_COLOR, X_COLOR],
  XXZ: [X_COLOR, X_COLOR, Z_COLOR],
  ZZX: [Z_COLOR, Z_COLOR, X_COLOR],
  XZX: [X_COLOR, Z_COLOR, X_COLOR],
};

/**
 * Build a BoxGeometry with vertex colors for a given cube type.
 *
 * Three.js BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z (4 verts each).
 * TQEC -> Three.js axis mapping:
 *   TQEC X-axis faces -> Three.js X-axis faces (+X, -X)
 *   TQEC Y-axis faces -> Three.js Z-axis faces (+Z, -Z)  (Y -> -Z)
 *   TQEC Z-axis faces -> Three.js Y-axis faces (+Y, -Y)  (Z -> +Y)
 */
export function createBlockGeometry(blockType: BlockType): THREE.BoxGeometry {
  if (blockType === "Y") {
    // YHalfCube: 1×1×0.5 in TQEC → 1 (X) × 0.5 (Y) × 1 (Z) in Three.js, all green
    const geo = new THREE.BoxGeometry(1, 0.5, 1);
    const colors = new Float32Array(24 * 3);
    for (let i = 0; i < 24; i++) {
      colors[i * 3] = Y_COLOR.r;
      colors[i * 3 + 1] = Y_COLOR.g;
      colors[i * 3 + 2] = Y_COLOR.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }

  const [tqecX, tqecY, tqecZ] = CUBE_FACE_COLORS[blockType];

  // Map to Three.js face order: +X, -X, +Y, -Y, +Z, -Z
  const faceColors = [
    tqecX, tqecX, // Three.js +X, -X = TQEC X-axis
    tqecZ, tqecZ, // Three.js +Y, -Y = TQEC Z-axis
    tqecY, tqecY, // Three.js +Z, -Z = TQEC Y-axis
  ];

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const colors = new Float32Array(24 * 3); // 6 faces × 4 vertices × 3 rgb

  for (let face = 0; face < 6; face++) {
    const c = faceColors[face];
    for (let v = 0; v < 4; v++) {
      const idx = (face * 4 + v) * 3;
      colors[idx] = c.r;
      colors[idx + 1] = c.g;
      colors[idx + 2] = c.b;
    }
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** @deprecated Use createBlockGeometry instead */
export const createCubeGeometry = createBlockGeometry;

export function posKey(pos: Position3D): string {
  return `${pos.x},${pos.y},${pos.z}`;
}

/**
 * Coordinate mapping (right-handed):
 *   TQEC X (spatial)  -> Three.js  X
 *   TQEC Y (spatial)  -> Three.js -Z
 *   TQEC Z (temporal) -> Three.js  Y (up)
 *
 * Blocks fill grid cells: TQEC position (x,y,z) occupies from
 * (x,y,z) to (x+1,y+1,z+1). Three.js center is offset by +0.5.
 * YHalfCube is half-height in Z, so its Y center is at pos.z + 0.25.
 */
export function tqecToThree(pos: Position3D, blockType?: BlockType): [number, number, number] {
  const yOffset = blockType === "Y" ? 0.25 : 0.5;
  return [pos.x + 0.5, pos.z + yOffset, -(pos.y + 0.5)];
}

/** TQEC Z-height for each block type. */
export function blockHeight(blockType: BlockType): number {
  return blockType === "Y" ? 0.5 : 1;
}

export function snapToCell(value: number): number {
  return Math.floor(value);
}

export function threeToTqecCell(x: number, y: number, z: number): Position3D {
  return { x: snapToCell(x), y: snapToCell(-z), z: snapToCell(y) };
}

/**
 * Compute the TQEC position for a new block placed adjacent to an existing block's face.
 *
 * Three.js face normal → TQEC axis:
 *   (±1, 0, 0) → TQEC X ±1
 *   (0, ±1, 0) → TQEC Z ± (srcHeight/2 + dstHeight/2) from src center
 *   (0, 0, ±1) → TQEC Y ∓1
 */
export function getAdjacentPos(
  srcPos: Position3D,
  srcType: BlockType,
  normal: THREE.Vector3,
  dstType: BlockType,
): Position3D {
  // Round normal components to nearest axis
  const nx = Math.round(normal.x);
  const ny = Math.round(normal.y);
  const nz = Math.round(normal.z);

  // X and Y offsets are always ±1 (all blocks are size 1 in X and Y)
  const x = srcPos.x + nx;
  const y = srcPos.y - nz; // Three.js +Z = TQEC -Y

  // Z offset accounts for block heights
  const srcH = blockHeight(srcType);
  const dstH = blockHeight(dstType);
  // src center in TQEC Z = srcPos.z + srcH/2
  // For top face (ny=+1): new block bottom at srcPos.z + srcH → newPos.z = srcPos.z + srcH
  // For bottom face (ny=-1): new block top at srcPos.z → newPos.z = srcPos.z - dstH
  const z = srcPos.z + (ny > 0 ? srcH : ny < 0 ? -dstH : 0);

  return { x, y, z };
}
