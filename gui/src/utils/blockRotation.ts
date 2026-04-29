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
        `Invalid rotation for ${kindStr} block: cultivation and Y blocks only allow rotation around Z axis.`,
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

  const newPos = rotatePositionAroundZ(block.pos, pivot, direction, needsCoordCanon);

  const newFaceColors = block.faceColors
    ? rotateFaceColorsAroundZ(block.faceColors, block.type, direction)
    : undefined;

  const result: Block = { pos: newPos, type: newType as Block["type"] };
  if (newFaceColors) result.faceColors = newFaceColors;
  return result;
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

function rotateFaceColorsAroundZ(
  faceColors: Record<string, string>,
  blockType: Block["type"],
  direction: RotationDirection,
): Record<string, string> | undefined {
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
  const out: Record<string, string> = {};
  for (const [key, hex] of Object.entries(faceColors)) {
    const colon = key.indexOf(":");
    if (colon === -1) {
      const idx = Number(key);
      if (Number.isInteger(idx) && idx >= 0 && idx < 6) {
        out[String(perm[idx])] = hex;
      } else {
        out[key] = hex;
      }
    } else {
      const idx = Number(key.slice(0, colon));
      const strip = key.slice(colon + 1);
      const newStrip = threeOpenAxis !== null
        ? flipHStrip(strip, threeOpenAxis, direction)
        : strip;
      if (Number.isInteger(idx) && idx >= 0 && idx < 6) {
        out[`${perm[idx]}:${newStrip}`] = hex;
      } else {
        out[key] = hex;
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}
