export interface Position3D {
  x: number;
  y: number;
  z: number;
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
