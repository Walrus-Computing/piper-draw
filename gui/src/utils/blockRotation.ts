import type { Block, Position3D } from "../types";
import { isPipeType } from "../types";

// ---------------------------------------------------------------------------
// Hadamard direction equivalences (same as tqec's adjust_hadamards_direction)
// ---------------------------------------------------------------------------

export const HDM_EQUIVALENCES: Record<string, string> = {
  ZXOH: "XZOH",
  XOZH: "ZOXH",
  OXZH: "OZXH",
};

export const HDM_INVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(HDM_EQUIVALENCES).map(([k, v]) => [v, k]),
);

// ---------------------------------------------------------------------------
// General rotation helpers (port of tqec's rotate_block_kind_by_matrix)
// ---------------------------------------------------------------------------

/** Check if a 3x3 matrix is approximately the identity. */
export function isIdentityRotation(rot: number[][]): boolean {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const expected = i === j ? 1 : 0;
      if (Math.abs(rot[i][j] - expected) > 1e-6) return false;
    }
  }
  return true;
}

/**
 * Get axis direction multipliers from a rotation matrix.
 * For each row, return +1 or -1 based on the sum of elements.
 */
export function getAxesDirections(rot: number[][]): Record<string, number> {
  const dirs: Record<string, number> = {};
  const labels = ["X", "Y", "Z"];
  for (let i = 0; i < 3; i++) {
    const sum = rot[i][0] + rot[i][1] + rot[i][2];
    dirs[labels[i]] = sum < 0 ? -1 : 1;
  }
  return dirs;
}

/**
 * Rotate a block kind name using the rotation matrix.
 * Port of tqec's `rotate_block_kind_by_matrix`.
 */
export function rotateBlockKind(kindStr: string, rot: number[][]): string {
  const isY = kindStr === "Y";
  // For Y blocks, use "Y-!" as the base for the rotation check
  const originalName = isY ? "Y-!" : kindStr.slice(0, 3);

  let rotatedName = "";
  for (const row of rot) {
    let entry = "";
    for (let j = 0; j < 3; j++) {
      const count = Math.abs(Math.round(row[j]));
      entry += originalName[j].repeat(count);
    }
    rotatedName += entry;
  }

  // Y / cultivation blocks: reject only when the Y-direction sentinel `!` would
  // move off the Z axis (i.e. 90° rotations around X or Y).
  if (rotatedName.includes("!")) {
    if (!rotatedName.endsWith("!")) {
      throw new Error(
        `${kindStr} blocks cannot 90°-rotate around the X or Y axis.`,
      );
    }
    return kindStr;
  }

  // Hadamard: append 'H' if original had it
  if (kindStr.endsWith("H")) {
    rotatedName += "H";
  }

  return rotatedName.toUpperCase();
}

/** Adjust Hadamard pipe direction when pointing in negative direction. */
export function adjustHadamardDirection(kindStr: string): string {
  if (kindStr in HDM_EQUIVALENCES) return HDM_EQUIVALENCES[kindStr];
  if (kindStr in HDM_INVERSE) return HDM_INVERSE[kindStr];
  return kindStr;
}

/** Get the pipe direction axis index from a pipe kind (position of 'O'). */
export function pipeDirectionIndex(kindStr: string): number {
  return kindStr.slice(0, 3).indexOf("O");
}

// ---------------------------------------------------------------------------
// Rotation primitives (X / Y / Z, 90° CCW/CW and 180° flips)
// ---------------------------------------------------------------------------

/** 90° counter-clockwise rotation around +Z. */
export const ROT_Z_CCW: number[][] = [
  [0, -1, 0],
  [1, 0, 0],
  [0, 0, 1],
];

/** 90° clockwise rotation around +Z. */
export const ROT_Z_CW: number[][] = [
  [0, 1, 0],
  [-1, 0, 0],
  [0, 0, 1],
];

/** 180° rotation around Z axis (same as two CCW). */
export const ROT_Z_180: number[][] = [
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, 1],
];

/** 90° CCW rotation around +X (right-hand rule: +Y → +Z). */
export const ROT_X_CCW: number[][] = [
  [1, 0, 0],
  [0, 0, -1],
  [0, 1, 0],
];

/** 90° CW rotation around +X (+Z → +Y). */
export const ROT_X_CW: number[][] = [
  [1, 0, 0],
  [0, 0, 1],
  [0, -1, 0],
];

/** 180° rotation around X axis. */
export const ROT_X_180: number[][] = [
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
];

/** 90° CCW rotation around +Y (right-hand rule: +Z → +X). */
export const ROT_Y_CCW: number[][] = [
  [0, 0, 1],
  [0, 1, 0],
  [-1, 0, 0],
];

/** 90° CW rotation around +Y (+X → +Z). */
export const ROT_Y_CW: number[][] = [
  [0, 0, -1],
  [0, 1, 0],
  [1, 0, 0],
];

/** 180° rotation around Y axis. */
export const ROT_Y_180: number[][] = [
  [-1, 0, 0],
  [0, 1, 0],
  [0, 0, -1],
];

export type RotationAxis = "x" | "y" | "z";
export type RotationOperation = "ccw" | "cw" | "flip";

/** Backwards-compatible alias for the original Z-only rotation API. */
export type RotationDirection = "cw" | "ccw";

/** Lookup table: axis × operation → 3x3 matrix. */
export const MATRICES: Record<RotationAxis, Record<RotationOperation, number[][]>> = {
  x: { ccw: ROT_X_CCW, cw: ROT_X_CW, flip: ROT_X_180 },
  y: { ccw: ROT_Y_CCW, cw: ROT_Y_CW, flip: ROT_Y_180 },
  z: { ccw: ROT_Z_CCW, cw: ROT_Z_CW, flip: ROT_Z_180 },
};

function posMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Canonicalize a grid coordinate so that pipe slots stay at `c ≡ 1 (mod 3)`.
 *
 * A rotation around a cube-valid pivot can produce coordinates where a
 * pipe's slot axis lands at `c ≡ 2 (mod 3)` — still physically between the
 * same two cubes, but stored non-canonically. Shifting by -1 moves it to the
 * canonical `≡ 1 (mod 3)` representation without crossing into a different
 * cube gap.
 */
function canonicalizePipeCoord(c: number): number {
  return posMod(c, 3) === 2 ? c - 1 : c;
}

function applyMatrix(m: number[][], v: [number, number, number]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/**
 * Rotate a grid position around `pivot` by `operation` (90° CCW/CW or 180°)
 * about the named `axis`. Pipes get their two non-axis coords canonicalized
 * back to `c ≡ 1 (mod 3)` after the rotation.
 */
export function rotatePositionAroundAxis(
  pos: Position3D,
  pivot: Position3D,
  axis: RotationAxis,
  operation: RotationOperation,
  isPipe: boolean,
): Position3D {
  const m = MATRICES[axis][operation];
  const [nx, ny, nz] = applyMatrix(m, [pos.x - pivot.x, pos.y - pivot.y, pos.z - pivot.z]);
  let resX = pivot.x + nx;
  let resY = pivot.y + ny;
  let resZ = pivot.z + nz;
  if (isPipe) {
    if (axis !== "x") resX = canonicalizePipeCoord(resX);
    if (axis !== "y") resY = canonicalizePipeCoord(resY);
    if (axis !== "z") resZ = canonicalizePipeCoord(resZ);
  }
  return { x: resX, y: resY, z: resZ };
}

/**
 * Rotate a block (position + type) about `pivot` around the named `axis` by
 * `operation` (90° CCW/CW or 180°).
 *
 * Throws via `rotateBlockKind` when the rotation is invalid for the block
 * type (e.g. a Y block under a 90° X or Y rotation; 180° flips on any axis
 * are accepted).
 */
export function rotateBlockAroundAxis(
  block: Block,
  pivot: Position3D,
  axis: RotationAxis,
  operation: RotationOperation,
): Block {
  const rot = MATRICES[axis][operation];
  const isPipe = isPipeType(block.type);

  let newType = rotateBlockKind(block.type, rot);

  // Hadamard pipes: after rotation, if the pipe now points in the negative
  // direction along its open axis, swap to the canonical equivalent so
  // rendering stays consistent. Mirrors daeImport.ts behavior.
  if (isPipe && newType.endsWith("H")) {
    const axesDirs = getAxesDirections(rot);
    const dirIdx = pipeDirectionIndex(newType);
    const dirLabel = ["X", "Y", "Z"][dirIdx];
    if (axesDirs[dirLabel] === -1) {
      newType = adjustHadamardDirection(newType);
    }
  }

  const newPos = rotatePositionAroundAxis(block.pos, pivot, axis, operation, isPipe);

  // Spread `block` first so optional metadata (e.g. `groupId`) rides through;
  // rotation only mutates pos and type. Without the spread, group membership
  // would silently disappear on every rotate.
  return { ...block, pos: newPos, type: newType as Block["type"] };
}

/** Backwards-compatible alias: rotate a position 90° around +Z. */
export function rotatePositionAroundZ(
  pos: Position3D,
  pivot: Position3D,
  direction: RotationDirection,
  isPipe: boolean,
): Position3D {
  return rotatePositionAroundAxis(pos, pivot, "z", direction, isPipe);
}

/** Backwards-compatible alias: rotate a block 90° around +Z. */
export function rotateBlockAroundZ(
  block: Block,
  pivot: Position3D,
  direction: RotationDirection,
): Block {
  return rotateBlockAroundAxis(block, pivot, "z", direction);
}
