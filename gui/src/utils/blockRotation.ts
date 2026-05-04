import type { Block, Position3D } from "../types";
import { isPipeType, isSlabType, SLAB_TYPE, TQEC_TO_THREE_AXIS } from "../types";

// ---------------------------------------------------------------------------
// Hadamard direction equivalences (same as tqec's adjust_hadamards_direction).
// Y-twist pipes share the same colour-flip convention, so the same equivalences
// apply with the H suffix swapped for Y.
// ---------------------------------------------------------------------------

export const HDM_EQUIVALENCES: Record<string, string> = {
  ZXOH: "XZOH",
  XOZH: "ZOXH",
  OXZH: "OZXH",
  ZXOY: "XZOY",
  XOZY: "ZOXY",
  OXZY: "OZXY",
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
        `${kindStr} blocks can only rotate around the Z axis.`,
      );
    }
    return kindStr;
  }

  // Suffix preservation: H (Hadamard) or Y (free-build Y-twist). Both attach to
  // pipes only; cube types never end in H or Y, and the bare "Y" block was
  // already returned above. The geometry/colour-flip convention is the same
  // for both, so rotation handles them identically.
  if (kindStr.endsWith("H")) {
    rotatedName += "H";
  } else if (kindStr.endsWith("Y") && kindStr.length > 1) {
    rotatedName += "Y";
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
 * type (e.g. a Y block under any non-Z-preserving rotation).
 */
export function rotateBlockAroundAxis(
  block: Block,
  pivot: Position3D,
  axis: RotationAxis,
  operation: RotationOperation,
): Block {
  const rot = MATRICES[axis][operation];
  const isPipe = isPipeType(block.type);
  // Slabs share the pipe-slot coord constraint (x,y ≡ 1 mod 3), so a Z-rotation
  // around a cube pivot can land them at c ≡ 2 (mod 3). Treat them the same as
  // pipes for the canonicalization step.
  const needsCoordCanon = isPipe || isSlabType(block.type);

  let newType = rotateBlockKind(block.type, rot);

  // Colour-flip pipes (Hadamard or Y-twist): after rotation, if the pipe now
  // points in the negative direction along its axis, swap to the canonical
  // equivalent so rendering stays consistent. Mirrors daeImport.ts behavior.
  if (isPipe && (newType.endsWith("H") || newType.endsWith("Y"))) {
    const axesDirs = getAxesDirections(rot);
    const dirIdx = pipeDirectionIndex(newType);
    const dirLabel = ["X", "Y", "Z"][dirIdx];
    if (axesDirs[dirLabel] === -1) {
      newType = adjustHadamardDirection(newType);
    }
  }

  const newPos = rotatePositionAroundAxis(block.pos, pivot, axis, operation, needsCoordCanon);

  // Face-paint colors and corr-surface marks only rotate under a Z 90°
  // (CCW/CW). Other axes/180° are not supported by the paint or corr-surface
  // UI today, so face annotations pass through unchanged in those cases.
  // Spread `block` first so optional metadata (e.g. `groupId`) rides through;
  // without it group membership would silently disappear on every rotate.
  const result: Block = { ...block, pos: newPos, type: newType as Block["type"] };
  if (axis === "z" && operation !== "flip") {
    if (block.faceColors) {
      const rotated = rotateFaceColorsAroundZ(block.faceColors, block.type, operation);
      if (rotated) {
        result.faceColors = rotated;
      } else {
        delete result.faceColors;
      }
    }
    if (block.corrSurfaceMarks) {
      const rotated = rotateAxisKeyedRecordAroundZ(block.corrSurfaceMarks, block.type, operation);
      if (rotated) {
        result.corrSurfaceMarks = rotated;
      } else {
        delete result.corrSurfaceMarks;
      }
    }
  }
  return result;
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

/**
 * Z-axis 90° rotation permutes Three.js face indices on the X/Z axes
 * (TQEC X↔Y, which `TQEC_TO_THREE_AXIS=[0,2,1]` maps to Three.js X↔Z).
 * Y faces (indices 2, 3) are invariant.
 *
 * Three.js face order: 0=+X 1=-X 2=+Y 3=-Y 4=+Z 5=-Z.
 *
 * CCW (TQEC X→Y, Y→-X) maps to Three.js (+X→-Z, -X→+Z, +Z→+X, -Z→-X):
 *   0→5, 1→4, 4→0, 5→1
 * CW: inverse — 0→4, 1→5, 4→1, 5→0.
 */
const FACE_PERM_CCW = [5, 4, 2, 3, 0, 1] as const;
const FACE_PERM_CW = [4, 5, 2, 3, 1, 0] as const;

/**
 * Rotate Hadamard strip suffix under a Z-rotation.
 *
 * `createPipeGeometry` uses `:below` for the strip at the negative end of the
 * pipe's Three.js open axis and `:above` for the positive end. Under a
 * Three.js Y-axis 90° rotation (= TQEC Z-rotation), a horizontal pipe's open
 * axis swaps between Three.js X and Three.js Z, and one of those swaps also
 * inverts the open-axis sign — so the physical "below" end can land at the
 * new pipe's "above" end. Vertical pipes (Three.js openAxis=1) are
 * rotation-invariant. The flip pattern (worked out by tracing object-space
 * points through `(x,z) → (z,-x)` for CCW and the inverse for CW):
 *
 *   CCW: flips iff original Three.js openAxis === 0 (X-open in TQEC).
 *   CW:  flips iff original Three.js openAxis === 2 (Z-open / Y-open in TQEC).
 */
function flipHStrip(strip: string, threeOpenAxis: 0 | 1 | 2, direction: RotationDirection): string {
  if (strip === "band" || threeOpenAxis === 1) return strip;
  const flip = direction === "ccw" ? threeOpenAxis === 0 : threeOpenAxis === 2;
  if (!flip) return strip;
  return strip === "below" ? "above" : strip === "above" ? "below" : strip;
}

/**
 * Generic Z-rotation for any face-keyed annotation `Record<string, T>`.
 * Permutes face indices, flips H/Y-twist below↔above strips per axis, and
 * passes values through unchanged. Used by `rotateFaceColorsAroundZ` (paint).
 */
export function rotateFaceKeyedRecordAroundZ<T>(
  record: Record<string, T>,
  blockType: Block["type"],
  direction: RotationDirection,
): Record<string, T> | undefined {
  const perm = direction === "ccw" ? FACE_PERM_CCW : FACE_PERM_CW;
  let threeOpenAxis: 0 | 1 | 2 | null = null;
  // Hadamard ("H") and Y-twist ("Y") pipes have per-strip face keys whose
  // below/above suffix is sign-relative to the open-axis end of the pipe.
  const isHadamard = isPipeType(blockType) && blockType.endsWith("H");
  const isYTwist = isPipeType(blockType) && blockType.endsWith("Y") && blockType.length === 4;
  if (isHadamard || isYTwist) {
    const base = blockType.length > 3 ? blockType.slice(0, 3) : blockType;
    const tqecOpen = base.indexOf("O") as 0 | 1 | 2;
    threeOpenAxis = TQEC_TO_THREE_AXIS[tqecOpen] as 0 | 1 | 2;
  }
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const colon = key.indexOf(":");
    if (colon === -1) {
      const idx = Number(key);
      if (Number.isInteger(idx) && idx >= 0 && idx < 6) {
        out[String(perm[idx])] = value;
      } else {
        out[key] = value;
      }
    } else {
      const idx = Number(key.slice(0, colon));
      const strip = key.slice(colon + 1);
      const newStrip = threeOpenAxis !== null
        ? flipHStrip(strip, threeOpenAxis, direction)
        : strip;
      if (Number.isInteger(idx) && idx >= 0 && idx < 6) {
        out[`${perm[idx]}:${newStrip}`] = value;
      } else {
        out[key] = value;
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function rotateFaceColorsAroundZ(
  faceColors: Record<string, string>,
  blockType: Block["type"],
  direction: RotationDirection,
): Record<string, string> | undefined {
  return rotateFaceKeyedRecordAroundZ(faceColors, blockType, direction);
}

/**
 * Z-axis 90° rotation permutes Three.js axis indices: X (0) ↔ Z (2),
 * Y (1) is invariant. Same permutation under both CCW and CW (rotation
 * direction affects the position-vector signs, not the axis labels).
 */
const AXIS_PERM_Z_ROT = [2, 1, 0] as const;

/**
 * Generic Z-rotation for any axis-keyed annotation `Record<string, T>` —
 * the per-axis schema for `corrSurfaceMarks`. Permutes the axis index
 * (0 ↔ 2, Y invariant) and flips H/Y-twist `below ↔ above` strip suffixes
 * the same way as the face-keyed helper. Bare strings that aren't valid
 * axis-keys pass through unchanged (defensive — they shouldn't exist).
 */
export function rotateAxisKeyedRecordAroundZ<T>(
  record: Record<string, T>,
  blockType: Block["type"],
  direction: RotationDirection,
): Record<string, T> | undefined {
  let threeOpenAxis: 0 | 1 | 2 | null = null;
  const isHadamard = isPipeType(blockType) && blockType.endsWith("H");
  const isYTwist = isPipeType(blockType) && blockType.endsWith("Y") && blockType.length === 4;
  if (isHadamard || isYTwist) {
    const base = blockType.length > 3 ? blockType.slice(0, 3) : blockType;
    const tqecOpen = base.indexOf("O") as 0 | 1 | 2;
    threeOpenAxis = TQEC_TO_THREE_AXIS[tqecOpen] as 0 | 1 | 2;
  }
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const colon = key.indexOf(":");
    const axisStr = colon === -1 ? key : key.slice(0, colon);
    const axis = Number(axisStr);
    if (!Number.isInteger(axis) || axis < 0 || axis > 2) {
      out[key] = value;
      continue;
    }
    const newAxis = AXIS_PERM_Z_ROT[axis];
    if (colon === -1) {
      out[String(newAxis)] = value;
    } else {
      const strip = key.slice(colon + 1);
      const newStrip = threeOpenAxis !== null
        ? flipHStrip(strip, threeOpenAxis, direction)
        : strip;
      out[`${newAxis}:${newStrip}`] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
