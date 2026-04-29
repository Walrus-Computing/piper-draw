import type { Block, Position3D } from "../types";
import { isPipeType, isSlabType, SLAB_TYPE } from "../types";

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
  // Slabs are rotation-invariant in XY (two horizontal squares), so the type
  // never changes — only the position rotates around Z elsewhere.
  if (kindStr === SLAB_TYPE) return kindStr;
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

  const axesDirs = getAxesDirections(rot);

  // Y / cultivation blocks: reject invalid rotations, keep original name
  if (rotatedName.includes("!")) {
    if (!rotatedName.endsWith("!") || axesDirs["Z"] < 0) {
      throw new Error(
        `Invalid rotation for ${kindStr} block: cultivation and Y blocks only allow rotation around Z axis.`,
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
// Z-axis rotation primitives (90° only)
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

export type RotationDirection = "cw" | "ccw";

function posMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Canonicalize a grid coordinate so that pipe slots stay at `c ≡ 1 (mod 3)`.
 *
 * A 90° rotation around a cube-valid pivot can produce coordinates where a
 * pipe's slot axis lands at `c ≡ 2 (mod 3)` — still physically between the
 * same two cubes, but stored non-canonically. Shifting by -1 moves it to the
 * canonical `≡ 1 (mod 3)` representation without crossing into a different
 * cube gap.
 */
function canonicalizePipeCoord(c: number): number {
  return posMod(c, 3) === 2 ? c - 1 : c;
}

/** Rotate a grid position around `pivot` by 90° around +Z (CCW or CW). */
export function rotatePositionAroundZ(
  pos: Position3D,
  pivot: Position3D,
  direction: RotationDirection,
  isPipe: boolean,
): Position3D {
  const dx = pos.x - pivot.x;
  const dy = pos.y - pivot.y;
  let nx: number, ny: number;
  if (direction === "ccw") {
    // (x, y) -> (-y, x) relative to pivot
    nx = pivot.x - dy;
    ny = pivot.y + dx;
  } else {
    // (x, y) -> (y, -x) relative to pivot
    nx = pivot.x + dy;
    ny = pivot.y - dx;
  }
  if (isPipe) {
    nx = canonicalizePipeCoord(nx);
    ny = canonicalizePipeCoord(ny);
  }
  return { x: nx, y: ny, z: pos.z };
}

/**
 * Rotate a block (position + type) 90° around +Z about `pivot`.
 *
 * Throws if the block's type cannot be rotated (e.g. a Y block with a pivot
 * that would move it off its own column — impossible for pure Z rotation, so
 * not actually reachable here, but the underlying rotateBlockKind throws on
 * bad matrices in general).
 */
export function rotateBlockAroundZ(
  block: Block,
  pivot: Position3D,
  direction: RotationDirection,
): Block {
  const rot = direction === "ccw" ? ROT_Z_CCW : ROT_Z_CW;
  const isPipe = isPipeType(block.type);
  // Slabs share the pipe-slot coord constraint (x,y ≡ 1 mod 3), so a Z-rotation
  // around a cube pivot can land them at c ≡ 2 (mod 3). Treat them the same as
  // pipes for the canonicalization step.
  const needsCoordCanon = isPipe || isSlabType(block.type);

  let newType = rotateBlockKind(block.type, rot);

  // Hadamard pipes: after rotation, if the pipe now points in the negative
  // direction along its axis, swap to the canonical equivalent so rendering
  // stays consistent. Mirrors daeImport.ts behavior.
  if (isPipe && newType.endsWith("H")) {
    const axesDirs = getAxesDirections(rot);
    const dirIdx = pipeDirectionIndex(newType);
    const dirLabel = ["X", "Y", "Z"][dirIdx];
    if (axesDirs[dirLabel] === -1) {
      newType = adjustHadamardDirection(newType);
    }
  }

  const newPos = rotatePositionAroundZ(block.pos, pivot, direction, needsCoordCanon);

  return { pos: newPos, type: newType as Block["type"] };
}
