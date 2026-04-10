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

export interface Block {
  pos: Position3D;
  type: CubeType;
}

const X_COLOR = new THREE.Color("#ff4444"); // X basis = red
const Z_COLOR = new THREE.Color("#4488ff"); // Z basis = blue

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
export function createCubeGeometry(cubeType: CubeType): THREE.BoxGeometry {
  const [tqecX, tqecY, tqecZ] = CUBE_FACE_COLORS[cubeType];

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
 */
export function tqecToThree(pos: Position3D): [number, number, number] {
  return [pos.x + 0.5, pos.z + 0.5, -(pos.y + 0.5)];
}

export function snapToCell(value: number): number {
  return Math.floor(value);
}

export function threeToTqecCell(x: number, y: number, z: number): Position3D {
  return { x: snapToCell(x), y: snapToCell(-z), z: snapToCell(y) };
}
