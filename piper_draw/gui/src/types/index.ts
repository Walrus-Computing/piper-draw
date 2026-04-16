import * as THREE from "three";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export const PIPE_TYPES = ["OZX", "OXZ", "OZXH", "OXZH", "ZOX", "XOZ", "ZOXH", "XOZH", "ZXO", "XZO", "ZXOH", "XZOH"] as const;
export type PipeType = (typeof PIPE_TYPES)[number];

export type BlockType = CubeType | "Y" | PipeType;
export type FaceMask = number;

export const FACE_POS_X = 1 << 0; // +X face in Three.js box geometry order
export const FACE_NEG_X = 1 << 1; // -X
export const FACE_POS_Y = 1 << 2; // +Y
export const FACE_NEG_Y = 1 << 3; // -Y
export const FACE_POS_Z = 1 << 4; // +Z
export const FACE_NEG_Z = 1 << 5; // -Z

export const FACE_BIT_BY_INDEX: ReadonlyArray<number> = [
  FACE_POS_X,
  FACE_NEG_X,
  FACE_POS_Y,
  FACE_NEG_Y,
  FACE_POS_Z,
  FACE_NEG_Z,
];

/** Pipe variant: the two non-O face characters (+ optional H). Open axis determined by position. */
export type PipeVariant = "ZX" | "XZ" | "ZXH" | "XZH";
export const PIPE_VARIANTS: PipeVariant[] = ["ZX", "XZ", "ZXH", "XZH"];

export interface Block {
  pos: Position3D;
  type: BlockType;
}

// ---------------------------------------------------------------------------
// Color constants — single source of truth
// ---------------------------------------------------------------------------

export const X_COLOR = new THREE.Color("#ff7f7f"); // red
export const Z_COLOR = new THREE.Color("#7396ff"); // blue
export const Y_COLOR = new THREE.Color("#63c676"); // green
export const H_COLOR = new THREE.Color("#ffff65"); // yellow

export const X_HEX = "#ff7f7f";
export const Z_HEX = "#7396ff";
export const Y_HEX = "#63c676";
export const H_HEX = "#ffff65";

const H_BAND_HALF_HEIGHT = 0.08;
/** Inset so pipe walls are never coplanar with adjacent blocks/pipes. */
const WALL_EPS = 0.001;
const FACE_MASK_EPS = 1e-9;

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

export function isPipeType(bt: BlockType): bt is PipeType {
  return (PIPE_TYPES as readonly string[]).includes(bt);
}

/** Map a TQEC basis character ('X' or 'Z') to its THREE.Color. */
function basisColor(ch: string): THREE.Color {
  return ch === "X" ? X_COLOR : Z_COLOR;
}

// ---------------------------------------------------------------------------
// Position validation (tqec alternating grid)
// ---------------------------------------------------------------------------

/** Positive modulo that works for negative numbers. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function nearest3kPipeCoord(v: number): number {
  return Math.round((v - 1) / 3) * 3 + 1;
}

/**
 * Grid spacing: repeating unit is 3 (block=1 + pipe=2).
 *   Block positions: all coordinates ≡ 0 (mod 3)
 *   Pipe positions: exactly one coordinate ≡ 1 (mod 3), rest ≡ 0 (mod 3)
 */
export function isValidBlockPos(pos: Position3D): boolean {
  return mod(pos.x, 3) === 0 && mod(pos.y, 3) === 0 && mod(pos.z, 3) === 0;
}

export function isValidPipePos(pos: Position3D): boolean {
  const mx = mod(pos.x, 3), my = mod(pos.y, 3), mz = mod(pos.z, 3);
  const slots = (mx === 1 ? 1 : 0) + (my === 1 ? 1 : 0) + (mz === 1 ? 1 : 0);
  const zeros = (mx === 0 ? 1 : 0) + (my === 0 ? 1 : 0) + (mz === 0 ? 1 : 0);
  return slots === 1 && zeros === 2;
}

export function isValidPos(pos: Position3D, blockType: BlockType): boolean {
  if (isPipeType(blockType)) return isValidPipePos(pos);
  return isValidBlockPos(pos);
}

export function isPipeSlotCoord(v: number): boolean {
  return mod(v, 3) === 1;
}

/** Which TQEC axis (0=x, 1=y, 2=z) has the pipe slot at this position. */
export function pipeAxisFromPos(pos: Position3D): 0 | 1 | 2 | null {
  if (isPipeSlotCoord(pos.x)) return 0;
  if (isPipeSlotCoord(pos.y)) return 1;
  if (isPipeSlotCoord(pos.z)) return 2;
  return null;
}

/** Map a pipe variant + position → concrete PipeType. Returns null if position is not a valid pipe pos. */
export const VARIANT_AXIS_MAP: Record<PipeVariant, [PipeType, PipeType, PipeType]> = {
  ZX:  ["OZX",  "ZOX",  "ZXO"],
  XZ:  ["OXZ",  "XOZ",  "XZO"],
  ZXH: ["OZXH", "XOZH", "ZXOH"],
  XZH: ["OXZH", "ZOXH", "XZOH"],
};

/** Reverse lookup: concrete PipeType → toolbar PipeVariant. */
export const PIPE_TYPE_TO_VARIANT: Record<PipeType, PipeVariant> = Object.fromEntries(
  (Object.entries(VARIANT_AXIS_MAP) as [PipeVariant, PipeType[]][])
    .flatMap(([variant, types]) => types.map((t) => [t, variant]))
) as Record<PipeType, PipeVariant>;

/** Returns the [nonH, H] pair for a given pipe variant. */
export function pipeVariantPair(v: PipeVariant): [PipeVariant, PipeVariant] {
  return v.endsWith("H") ? [v.slice(0, -1) as PipeVariant, v] : [v, (v + "H") as PipeVariant];
}

export function resolvePipeType(variant: PipeVariant, pos: Position3D): PipeType | null {
  const axis = pipeAxisFromPos(pos);
  if (axis === null) return null;
  return VARIANT_AXIS_MAP[variant][axis];
}

// ---------------------------------------------------------------------------
// Snapping to valid grid positions
// ---------------------------------------------------------------------------

/** Snap to nearest multiple of 3. */
function nearestMult3(v: number): number {
  return Math.round(v / 3) * 3;
}

/** Snap raw TQEC X/Y coordinates (on ground plane z=0) to nearest valid position. */
export function snapGroundPos(rawX: number, rawY: number, forPipe: boolean): Position3D {
  if (!forPipe) {
    return { x: nearestMult3(rawX), y: nearestMult3(rawY), z: 0 };
  }
  // For pipe on ground: z=0 ≡ 0 (mod 3), need exactly one of x,y in a non-zero pipe remainder class
  const bx = nearestMult3(rawX), by = nearestMult3(rawY);
  const px = nearest3kPipeCoord(rawX), py = nearest3kPipeCoord(rawY);
  // Candidate: X-pipe at (px, by) or Y-pipe at (bx, py)
  const d1 = Math.abs(rawX - px) + Math.abs(rawY - by);
  const d2 = Math.abs(rawX - bx) + Math.abs(rawY - py);
  if (d1 <= d2) return { x: px, y: by, z: 0 };
  return { x: bx, y: py, z: 0 };
}

// ---------------------------------------------------------------------------
// Sizes and coordinate mapping
// ---------------------------------------------------------------------------

/** TQEC dimensions [X, Y, Z] for each block type. */
export function blockTqecSize(blockType: BlockType): [number, number, number] {
  switch (blockType) {
    case "Y": return [1, 1, 0.5];
    case "ZXO": case "XZO": case "ZXOH": case "XZOH": return [1, 1, 2];
    case "ZOX": case "XOZ": case "ZOXH": case "XOZH": return [1, 2, 1];
    case "OZX": case "OXZ": case "OZXH": case "OXZH": return [2, 1, 1];
    default: return [1, 1, 1];
  }
}

/**
 * Three.js dimensions for each block type: [x, y, z].
 * TQEC (X, Y, Z) → Three.js (X, Y=Z_tqec, Z=Y_tqec).
 */
export function blockThreeSize(blockType: BlockType): [number, number, number] {
  const [tx, ty, tz] = blockTqecSize(blockType);
  return [tx, tz, ty];
}

/**
 * Coordinate mapping (right-handed):
 *   TQEC X (spatial)  -> Three.js  X
 *   TQEC Y (spatial)  -> Three.js -Z
 *   TQEC Z (temporal) -> Three.js  Y (up)
 *
 * Blocks fill grid cells: TQEC position (x,y,z) occupies from
 * (x,y,z) to (x+sx,y+sy,z+sz). Three.js center is offset by +half-size.
 */
export function tqecToThree(pos: Position3D, blockType?: BlockType, zOffset = 0): [number, number, number] {
  const [sx, sy, sz] = blockType ? blockTqecSize(blockType) : [1, 1, 1];
  return [pos.x + sx / 2, pos.z + sz / 2 + zOffset, -(pos.y + sy / 2)];
}

/**
 * Visual Z offset for Y blocks: +0.5 when a pipe sits directly above (z+1),
 * so the half-cube renders flush against the pipe's open face.
 */
export function yBlockZOffset(pos: Position3D, blocks: Map<string, Block>): number {
  const aboveKey = posKey({ x: pos.x, y: pos.y, z: pos.z + 1 });
  const above = blocks.get(aboveKey);
  return above != null && isPipeType(above.type) ? 0.5 : 0;
}

// ---------------------------------------------------------------------------
// posKey — primary lookup key for blocks
// ---------------------------------------------------------------------------

/**
 * Round to 4 decimals as a safety net against float arithmetic accumulation.
 * Block positions are always integers or multiples of 0.5 (Y half-cubes),
 * which are exact in IEEE 754, so this is purely defensive.
 */
function r4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export function posKey(pos: Position3D): string {
  return `${r4(pos.x)},${r4(pos.y)},${r4(pos.z)}`;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function hasPositiveOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > FACE_MASK_EPS;
}

/** TQEC axis index → Three.js axis index: TQEC [X,Y,Z] → Three.js [0,2,1]. */
const TQEC_TO_THREE_AXIS = [0, 2, 1] as const;
/** Inverse (same mapping since it's a self-inverse permutation). */
const THREE_TO_TQEC_AXIS = [0, 2, 1] as const;

/**
 * Unified pipe geometry constructor. Builds a pipe open along one Three.js axis.
 *
 * For non-Hadamard pipes: a BoxGeometry with the open-axis face pair removed and
 * closed-axis walls inset by WALL_EPS.
 *
 * For Hadamard pipes: each wall is subdivided into 3 strips (below band, yellow
 * Hadamard band, above band) with the two wall colors swapping above the band.
 *
 * @param openAxis   Three.js axis index (0=X, 1=Y, 2=Z) that is open (length 2)
 * @param wallColors Colors for the two closed-axis wall pairs, ordered by Three.js axis number
 * @param hadamard   If true, subdivide walls with a yellow Hadamard band; colors swap above it
 * @param hiddenFaces Bitmask of faces to omit from geometry
 */
function createPipeGeometry(
  openAxis: number,
  wallColors: [THREE.Color, THREE.Color],
  hadamard: boolean,
  hiddenFaces: FaceMask = 0,
  hBandHalfHeight?: number,
): THREE.BufferGeometry {
  const closedAxes = [0, 1, 2].filter(a => a !== openAxis) as [number, number];

  if (!hadamard) {
    const e = WALL_EPS;
    const dims: [number, number, number] = [1, 1, 1];
    dims[openAxis] = 2;
    for (const ca of closedAxes) dims[ca] -= 2 * e;

    const geo = new THREE.BoxGeometry(...dims);
    const colors = new Float32Array(24 * 3);
    // Map closed axes to their face color pairs; open axis faces are null
    const faceColors: (THREE.Color | null)[] = new Array(6).fill(null);
    for (let i = 0; i < 2; i++) {
      const ca = closedAxes[i];
      faceColors[ca * 2] = wallColors[i];     // +ca
      faceColors[ca * 2 + 1] = wallColors[i]; // -ca
    }

    for (let face = 0; face < 6; face++) {
      if (hiddenFaces & FACE_BIT_BY_INDEX[face]) continue;
      const c = faceColors[face];
      if (!c) continue;
      for (let v = 0; v < 4; v++) {
        const idx = (face * 4 + v) * 3;
        colors[idx] = c.r;
        colors[idx + 1] = c.g;
        colors[idx + 2] = c.b;
      }
    }

    const oldIndex = geo.index!;
    const newIndices: number[] = [];
    for (let face = 0; face < 6; face++) {
      if (hiddenFaces & FACE_BIT_BY_INDEX[face]) continue;
      // Skip the two open-axis faces
      if (face === openAxis * 2 || face === openAxis * 2 + 1) continue;
      for (let i = 0; i < 6; i++) {
        newIndices.push(oldIndex.getX(face * 6 + i));
      }
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(newIndices);
    geo.clearGroups();
    return geo;
  }

  // --- Hadamard pipe: 4 walls × 3 strips each ---

  const halfExt: [number, number, number] = [0.5, 0.5, 0.5];
  for (const ca of closedAxes) halfExt[ca] -= WALL_EPS;
  const bh = hBandHalfHeight ?? H_BAND_HALF_HEIGHT;
  // Above the band, the two closed-axis colors swap per TQEC convention
  const wallColorsAbove: [THREE.Color, THREE.Color] = [wallColors[1], wallColors[0]];

  const positions: number[] = [];
  const normals: number[] = [];
  const colorsArr: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  function addQuad(
    v0: number[], v1: number[], v2: number[], v3: number[],
    n: number[],
    color: THREE.Color,
  ) {
    const vi = positions.length / 3;
    for (const v of [v0, v1, v2, v3]) {
      positions.push(...v);
      normals.push(...n);
      colorsArr.push(color.r, color.g, color.b);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }

  const oa = openAxis;

  // For each closed axis, generate two walls (+ca and -ca), each with 3 strips.
  // Winding order is computed from the parity of the (ca, oa, oc) permutation
  // so that (v1-v0)×(v2-v0) points outward.
  for (let i = 0; i < 2; i++) {
    const ca = closedAxes[i];
    const oc = closedAxes[1 - i];
    // rightHanded: is (ca, oa, oc) an even permutation of (0,1,2)?
    const rightHanded = ((oa - ca + 3) % 3) === 1;

    for (const sign of [1, -1] as const) {
      const faceBit = FACE_BIT_BY_INDEX[ca * 2 + (sign > 0 ? 0 : 1)];
      if (hiddenFaces & faceBit) continue;

      // oc traversal direction: ensures outward-facing normal
      const ocDir = sign * (rightHanded ? 1 : -1);
      const n: [number, number, number] = [0, 0, 0];
      n[ca] = sign;

      const quad = (t0: number, t1: number): [number[], number[], number[], number[]] => {
        const make = (oaVal: number, ocSign: number): number[] => {
          const v: [number, number, number] = [0, 0, 0];
          v[ca] = sign * halfExt[ca];
          v[oa] = oaVal;
          v[oc] = ocSign * halfExt[oc];
          return v;
        };
        return [make(t0, -ocDir), make(t1, -ocDir), make(t1, ocDir), make(t0, ocDir)];
      };

      // Three strips along the open axis: below band, yellow band, above band
      const [b0, b1, b2, b3] = quad(-1, -bh);
      addQuad(b0, b1, b2, b3, n, wallColors[i]);
      const [m0, m1, m2, m3] = quad(-bh, bh);
      addQuad(m0, m1, m2, m3, n, H_COLOR);
      const [a0, a1, a2, a3] = quad(bh, 1);
      addQuad(a0, a1, a2, a3, n, wallColorsAbove[i]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colorsArr), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Create colored geometry for any block type.
 *
 * Pipe types are parsed from the type name: each character gives the basis
 * for that TQEC axis ('X', 'Z', or 'O' for open). Hadamard variants end in 'H'.
 */
export function createBlockGeometry(blockType: BlockType, hiddenFaces: FaceMask = 0, hBandHalfHeight?: number): THREE.BufferGeometry {
  if (isPipeType(blockType)) {
    const base = blockType.replace("H", "");
    const hadamard = blockType.length > 3;
    const tqecOpenAxis = base.indexOf("O") as 0 | 1 | 2;
    const threeOpenAxis = TQEC_TO_THREE_AXIS[tqecOpenAxis];
    const closedAxes = [0, 1, 2].filter(a => a !== threeOpenAxis) as [number, number];
    let wallColors = closedAxes.map(ta => basisColor(base[THREE_TO_TQEC_AXIS[ta]])) as [THREE.Color, THREE.Color];
    // For Y-open Hadamard pipes, the geometry "below band" end (negative Three.js Z)
    // corresponds to the tail (higher TQEC Y). Pre-swap so below-band shows tail
    // (flipped) colors and above-band shows head (original) colors.
    if (hadamard && tqecOpenAxis === 1) {
      wallColors = [wallColors[1], wallColors[0]];
    }
    return createPipeGeometry(threeOpenAxis, wallColors, hadamard, hiddenFaces, hBandHalfHeight);
  }

  if (blockType === "Y") {
    // YHalfCube: 1×1×0.5 in TQEC → 1 (X) × 0.5 (Y) × 1 (Z) in Three.js, all green
    const geo = new THREE.BoxGeometry(1, 0.5, 1);
    const colors = new Float32Array(24 * 3);
    const oldIndex = geo.index!;
    const newIndices: number[] = [];
    for (let i = 0; i < 24; i++) {
      colors[i * 3] = Y_COLOR.r;
      colors[i * 3 + 1] = Y_COLOR.g;
      colors[i * 3 + 2] = Y_COLOR.b;
    }
    for (let face = 0; face < 6; face++) {
      if (hiddenFaces & FACE_BIT_BY_INDEX[face]) continue;
      for (let i = 0; i < 6; i++) {
        newIndices.push(oldIndex.getX(face * 6 + i));
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(newIndices);
    geo.clearGroups();
    return geo;
  }

  // Cube type: parse face colors from the type name
  const tqecColors = [basisColor(blockType[0]), basisColor(blockType[1]), basisColor(blockType[2])];
  // Map to Three.js face order: +X, -X, +Y, -Y, +Z, -Z
  const faceColors = [
    tqecColors[0], tqecColors[0], // Three.js +X, -X = TQEC X-axis
    tqecColors[2], tqecColors[2], // Three.js +Y, -Y = TQEC Z-axis
    tqecColors[1], tqecColors[1], // Three.js +Z, -Z = TQEC Y-axis
  ];

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const colors = new Float32Array(24 * 3); // 6 faces × 4 vertices × 3 rgb
  const oldIndex = geo.index!;
  const newIndices: number[] = [];

  for (let face = 0; face < 6; face++) {
    const c = faceColors[face];
    if (hiddenFaces & FACE_BIT_BY_INDEX[face]) continue;
    for (let v = 0; v < 4; v++) {
      const idx = (face * 4 + v) * 3;
      colors[idx] = c.r;
      colors[idx + 1] = c.g;
      colors[idx + 2] = c.b;
    }
    for (let i = 0; i < 6; i++) {
      newIndices.push(oldIndex.getX(face * 6 + i));
    }
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(newIndices);
  geo.clearGroups();
  return geo;
}

/** Edge line segments for a block type, including Hadamard band edges for H pipes. */
export function createBlockEdges(blockType: BlockType, hiddenFaces: FaceMask = 0, hBandHalfHeight?: number): THREE.BufferGeometry {
  const [bx, by, bz] = blockThreeSize(blockType);
  const pipe = isPipeType(blockType);
  const e2 = pipe ? 2 * WALL_EPS : 0;
  const hx = bx / 2 - e2 / 2;
  const hy = by / 2 - e2 / 2;
  const hz = bz / 2 - e2 / 2;
  const corners: Array<[number, number, number]> = [
    [-hx, -hy, -hz],
    [-hx, -hy, hz],
    [-hx, hy, -hz],
    [-hx, hy, hz],
    [hx, -hy, -hz],
    [hx, -hy, hz],
    [hx, hy, -hz],
    [hx, hy, hz],
  ];

  const faceEdges: Record<number, [number, number][]> = {
    [FACE_NEG_X]: [[0, 1], [1, 3], [3, 2], [2, 0]],
    [FACE_POS_X]: [[4, 5], [5, 7], [7, 6], [6, 4]],
    [FACE_NEG_Y]: [[0, 1], [1, 5], [5, 4], [4, 0]],
    [FACE_POS_Y]: [[2, 3], [3, 7], [7, 6], [6, 2]],
    [FACE_NEG_Z]: [[0, 2], [2, 6], [6, 4], [4, 0]],
    [FACE_POS_Z]: [[1, 3], [3, 7], [7, 5], [5, 1]],
  };

  const seen = new Set<string>();
  const linePoints: number[] = [];
  const maybePushEdge = (i: number, j: number) => {
    if (i > j) [i, j] = [j, i];
    const key = `${i}|${j}`;
    if (seen.has(key)) return;
    seen.add(key);
    const a = corners[i];
    const b = corners[j];
    linePoints.push(...a, ...b);
  };

  for (const [faceBit, edges] of Object.entries(faceEdges) as unknown as Array<[string, [number, number][]]>) {
    const bit = Number(faceBit) as FaceMask;
    if (hiddenFaces & bit) continue;
    for (const [i, j] of edges) {
      maybePushEdge(i, j);
    }
  }

  // Hadamard band edge rings
  if (pipe && blockType.endsWith("H")) {
    const base = blockType.replace("H", "");
    const tqecOpen = base.indexOf("O") as 0 | 1 | 2;
    const threeOpen = TQEC_TO_THREE_AXIS[tqecOpen];
    const closed = [0, 1, 2].filter(a => a !== threeOpen) as [number, number];
    const halfExts = [hx, hy, hz];
    const bandEdges: number[] = [];

    const bandHH = hBandHalfHeight ?? H_BAND_HALF_HEIGHT;
    for (const bp of [bandHH, -bandHH]) {
      const faceBit = FACE_BIT_BY_INDEX[threeOpen * 2 + (bp > 0 ? 0 : 1)];
      if (hiddenFaces & faceBit) continue;

      // 4 corners of the band ring at open-axis position bp
      const [ca1, ca2] = closed;
      const ringCorners: [number, number, number][] = [];
      for (const [s1, s2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const v: [number, number, number] = [0, 0, 0];
        v[threeOpen] = bp;
        v[ca1] = s1 * halfExts[ca1];
        v[ca2] = s2 * halfExts[ca2];
        ringCorners.push(v);
      }
      for (let k = 0; k < 4; k++) {
        bandEdges.push(...ringCorners[k], ...ringCorners[(k + 1) % 4]);
      }
    }

    const merged = new Float32Array(linePoints.length + bandEdges.length);
    merged.set(linePoints);
    merged.set(new Float32Array(bandEdges), linePoints.length);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(merged, 3));
    return geo;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePoints), 3));
  return geo;
}

// ---------------------------------------------------------------------------
// Spatial index — O(1) neighbor lookups instead of O(n) scans
// Max entries: ~19 block types × 64 face masks = ~1216 geometry/edge pairs.
// ---------------------------------------------------------------------------

export type SpatialIndex = Map<string, Block[]>;

function cellKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

/** Compute the integer cell keys that a block occupies. */
function blockCells(block: Block): string[] {
  const [sx, sy, sz] = blockTqecSize(block.type);
  const x0 = Math.floor(block.pos.x);
  const x1 = Math.floor(block.pos.x + sx - 1e-9);
  const y0 = Math.floor(block.pos.y);
  const y1 = Math.floor(block.pos.y + sy - 1e-9);
  const z0 = Math.floor(block.pos.z);
  const z1 = Math.floor(block.pos.z + sz - 1e-9);
  const keys: string[] = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        keys.push(cellKey(x, y, z));
  return keys;
}

/** Build a spatial index: each integer cell maps to blocks that overlap it. */
export function buildSpatialIndex(blocks: Map<string, Block>): SpatialIndex {
  const index: SpatialIndex = new Map();
  for (const block of blocks.values()) {
    for (const key of blockCells(block)) {
      const list = index.get(key);
      if (list) list.push(block);
      else index.set(key, [block]);
    }
  }
  return index;
}

/** Incrementally add a block to an existing spatial index. */
export function addToSpatialIndex(index: SpatialIndex, block: Block): void {
  for (const key of blockCells(block)) {
    const list = index.get(key);
    if (list) list.push(block);
    else index.set(key, [block]);
  }
}

/** Incrementally remove a block from an existing spatial index. */
export function removeFromSpatialIndex(index: SpatialIndex, block: Block): void {
  const pk = posKey(block.pos);
  for (const key of blockCells(block)) {
    const list = index.get(key);
    if (!list) continue;
    const idx = list.findIndex(b => posKey(b.pos) === pk);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) index.delete(key);
  }
}

/** Collect unique nearby blocks from the spatial index for an AABB expanded by `pad` cells. */
function getNearbyBlocks(index: SpatialIndex, pos: Position3D, size: [number, number, number], pad: number): Block[] {
  const x0 = Math.floor(pos.x) - pad;
  const x1 = Math.floor(pos.x + size[0] - 1e-9) + pad;
  const y0 = Math.floor(pos.y) - pad;
  const y1 = Math.floor(pos.y + size[1] - 1e-9) + pad;
  const z0 = Math.floor(pos.z) - pad;
  const z1 = Math.floor(pos.z + size[2] - 1e-9) + pad;
  const seen = new Set<string>();
  const result: Block[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const list = index.get(cellKey(x, y, z));
        if (!list) continue;
        for (const block of list) {
          const pk = posKey(block.pos);
          if (!seen.has(pk)) {
            seen.add(pk);
            result.push(block);
          }
        }
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Hidden face computation
// ---------------------------------------------------------------------------

/**
 * Compute which outward faces should be hidden because another block touches it directly.
 *
 * Face order follows three.js order:
 * +X, -X, +Y, -Y, +Z, -Z.
 */
export function getHiddenFaceMaskForPos(
  pos: Position3D,
  type: BlockType,
  blocks: Map<string, Block>,
  index?: SpatialIndex,
): FaceMask {
  const size = blockTqecSize(type);
  const [sx, sy, sz] = size;
  const x0 = pos.x;
  const y0 = pos.y;
  const z0 = pos.z;
  const x1 = x0 + sx;
  const y1 = y0 + sy;
  const z1 = z0 + sz;
  let mask = 0;

  const candidates = index
    ? getNearbyBlocks(index, pos, size, 1)
    : Array.from(blocks.values());

  for (const block of candidates) {
    if (block.pos.x === pos.x && block.pos.y === pos.y && block.pos.z === pos.z) {
      continue;
    }

    const [bx, by, bz] = blockTqecSize(block.type);
    const nx0 = block.pos.x;
    const ny0 = block.pos.y;
    const nz0 = block.pos.z;
    const nx1 = nx0 + bx;
    const ny1 = ny0 + by;
    const nz1 = nz0 + bz;

    if (Math.abs(nx0 - x1) <= FACE_MASK_EPS && hasPositiveOverlap(y0, y1, ny0, ny1) && hasPositiveOverlap(z0, z1, nz0, nz1)) {
      mask |= FACE_POS_X;
    }
    if (Math.abs(nx1 - x0) <= FACE_MASK_EPS && hasPositiveOverlap(y0, y1, ny0, ny1) && hasPositiveOverlap(z0, z1, nz0, nz1)) {
      mask |= FACE_NEG_X;
    }
    if (Math.abs(ny0 - y1) <= FACE_MASK_EPS && hasPositiveOverlap(x0, x1, nx0, nx1) && hasPositiveOverlap(z0, z1, nz0, nz1)) {
      mask |= FACE_NEG_Z;
    }
    if (Math.abs(ny1 - y0) <= FACE_MASK_EPS && hasPositiveOverlap(x0, x1, nx0, nx1) && hasPositiveOverlap(z0, z1, nz0, nz1)) {
      mask |= FACE_POS_Z;
    }
    if (Math.abs(nz0 - z1) <= FACE_MASK_EPS && hasPositiveOverlap(x0, x1, nx0, nx1) && hasPositiveOverlap(y0, y1, ny0, ny1)) {
      mask |= FACE_POS_Y;
    }
    if (Math.abs(nz1 - z0) <= FACE_MASK_EPS && hasPositiveOverlap(x0, x1, nx0, nx1) && hasPositiveOverlap(y0, y1, ny0, ny1)) {
      mask |= FACE_NEG_Y;
    }
  }

  return mask;
}

/**
 * Recompute hidden face masks for a block and its spatial neighbors after a mutation.
 * Returns a Map from posKey to the new FaceMask for all affected blocks.
 */
export function recomputeAffectedHiddenFaces(
  affectedPos: Position3D,
  affectedType: BlockType,
  blocks: Map<string, Block>,
  index: SpatialIndex,
): Map<string, FaceMask> {
  const result = new Map<string, FaceMask>();
  const size = blockTqecSize(affectedType);
  const nearby = getNearbyBlocks(index, affectedPos, size, 1);
  for (const block of nearby) {
    result.set(posKey(block.pos), getHiddenFaceMaskForPos(block.pos, block.type, blocks, index));
  }
  // Also compute for the affected position itself (if it still exists in blocks)
  const key = posKey(affectedPos);
  if (blocks.has(key)) {
    result.set(key, getHiddenFaceMaskForPos(affectedPos, affectedType, blocks, index));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Overlap detection
// ---------------------------------------------------------------------------

/** Check if placing a block at pos with the given type overlaps any existing block.
 *  When `excludeKey` is provided, the block with that key is skipped (used for replacement). */
export function hasBlockOverlap(pos: Position3D, type: BlockType, blocks: Map<string, Block>, index?: SpatialIndex, excludeKey?: string): boolean {
  const sz = blockTqecSize(type);
  const candidates = index
    ? getNearbyBlocks(index, pos, sz, 0)
    : Array.from(blocks.values());
  for (const block of candidates) {
    if (excludeKey !== undefined && posKey(block.pos) === excludeKey) continue;
    const bs = blockTqecSize(block.type);
    if (
      pos.x < block.pos.x + bs[0] && pos.x + sz[0] > block.pos.x &&
      pos.y < block.pos.y + bs[1] && pos.y + sz[1] > block.pos.y &&
      pos.z < block.pos.z + bs[2] && pos.z + sz[2] > block.pos.z
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Get the effective basis character for a pipe on a given TQEC axis at one end.
 * Hadamard pipes swap their two closed-axis colors at the far end (offset +2,
 * higher position = tail in TQEC). `swapped` = true means this end sees the
 * swapped colors.
 */
function pipeEndBasis(base: string, hadamard: boolean, openAxis: number, axis: number, swapped: boolean): string {
  if (!hadamard || !swapped) return base[axis];
  // Swap: return the other closed axis's character
  const closedAxes = [0, 1, 2].filter(a => a !== openAxis);
  const otherAxis = closedAxes[0] === axis ? closedAxes[1] : closedAxes[0];
  return base[otherAxis];
}

/**
 * Check whether a pipe placement conflicts with adjacent cube colors.
 * For each of the pipe's two closed TQEC axes, the pipe's basis character
 * must match any adjacent cube's basis character on the same axis.
 * For Hadamard pipes, the far end (offset +2) uses swapped colors.
 * Returns true if there IS a conflict (placement should be rejected).
 */
export function hasPipeColorConflict(
  pipeType: PipeType,
  pipePos: Position3D,
  blocks: Map<string, Block>,
): boolean {
  const base = pipeType.replace("H", "");
  const hadamard = pipeType.length > 3;
  const openAxis = base.indexOf("O"); // 0, 1, or 2

  const coords: [number, number, number] = [pipePos.x, pipePos.y, pipePos.z];

  for (const offset of [-1, 2]) {
    const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
    nCoords[openAxis] += offset;
    const neighbor = blocks.get(posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] }));

    if (!neighbor) continue;
    if (neighbor.type === "Y") continue;
    if (isPipeType(neighbor.type)) continue;

    const swapped = offset === 2;
    for (let axis = 0; axis < 3; axis++) {
      if (axis === openAxis) continue;
      if (pipeEndBasis(base, hadamard, openAxis, axis, swapped) !== neighbor.type[axis]) return true;
    }
  }

  return false;
}

/**
 * Check whether a cube placement conflicts with adjacent pipe colors.
 * For each of the 3 TQEC axes, checks both possible neighboring pipe positions.
 * For Hadamard pipes, determines which end faces the cube and uses the right colors.
 * Returns true if there IS a conflict (placement should be rejected).
 */
export function hasCubeColorConflict(
  cubeType: CubeType,
  cubePos: Position3D,
  blocks: Map<string, Block>,
): boolean {
  const coords: [number, number, number] = [cubePos.x, cubePos.y, cubePos.z];

  for (let axis = 0; axis < 3; axis++) {
    // Two pipe positions along this axis: pos[axis]+1 and pos[axis]-2
    for (const offset of [1, -2]) {
      const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
      nCoords[axis] += offset;
      const neighbor = blocks.get(posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] }));

      if (!neighbor) continue;
      if (!isPipeType(neighbor.type)) continue;

      const base = neighbor.type.replace("H", "");
      const hadamard = neighbor.type.length > 3;
      const openAxis = base.indexOf("O");
      if (openAxis !== axis) continue;

      // offset +1: cube is at pipe's start (-1 neighbor = head)
      // offset -2: cube is at pipe's far end (+2 neighbor = tail, swapped for Hadamard)
      const swapped = offset === -2;
      for (let i = 0; i < 3; i++) {
        if (i === openAxis) continue;
        if (pipeEndBasis(base, hadamard, openAxis, i, swapped) !== cubeType[i]) return true;
      }
    }
  }

  return false;
}

/**
 * Check whether a Y cube is being placed next to an X-open or Y-open pipe,
 * or an X/Y-open pipe is being placed next to a Y cube.
 * Only Z-open pipes (axis 2) are allowed adjacent to Y cubes.
 * Returns true if there IS a conflict (placement should be rejected).
 */
export function hasYCubePipeAxisConflict(
  blockType: BlockType,
  pos: Position3D,
  blocks: Map<string, Block>,
): boolean {
  if (blockType === "Y") {
    const coords: [number, number, number] = [pos.x, pos.y, pos.z];
    for (let axis = 0; axis < 3; axis++) {
      for (const offset of [1, -2]) {
        const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
        nCoords[axis] += offset;
        const neighbor = blocks.get(posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] }));
        if (!neighbor || !isPipeType(neighbor.type)) continue;
        const openAxis = neighbor.type.replace("H", "").indexOf("O");
        if (openAxis === 0 || openAxis === 1) return true;
      }
    }
    return false;
  }

  if (isPipeType(blockType)) {
    const openAxis = blockType.replace("H", "").indexOf("O");
    if (openAxis !== 0 && openAxis !== 1) return false;
    const coords: [number, number, number] = [pos.x, pos.y, pos.z];
    for (const offset of [-1, 2]) {
      const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
      nCoords[openAxis] += offset;
      const neighbor = blocks.get(posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] }));
      if (neighbor?.type === "Y") return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Adjacency
// ---------------------------------------------------------------------------

/**
 * Compute the TQEC position for a new block placed adjacent to an existing block's face.
 *
 * Three.js face normal → TQEC axis:
 *   (±1, 0, 0) → TQEC X ± srcSizeX / dstSizeX
 *   (0, ±1, 0) → TQEC Z ± srcSizeZ / dstSizeZ
 *   (0, 0, ±1) → TQEC Y ∓ srcSizeY / dstSizeY
 */
// ---------------------------------------------------------------------------
// Build mode types & logic
// ---------------------------------------------------------------------------

export type BuildDirection = { tqecAxis: 0 | 1 | 2; sign: 1 | -1 };

export type UndeterminedCubeInfo = {
  options: CubeType[];
  currentIndex: number;
};

/**
 * Compute destination cube position from cursor position and build direction.
 * Cubes are spaced 3 apart on the grid.
 */
export function computeDestCubePos(cursorPos: Position3D, dir: BuildDirection): Position3D {
  const dst = { ...cursorPos };
  const key: keyof Position3D = dir.tqecAxis === 0 ? "x" : dir.tqecAxis === 1 ? "y" : "z";
  dst[key] += dir.sign * 3;
  return dst;
}

/**
 * Compute pipe position between cursor and destination for a build direction.
 * Pipe occupies the slot at cursor[axis]+1 (positive dir) or cursor[axis]-2 (negative dir).
 */
export function computePipePos(cursorPos: Position3D, dir: BuildDirection): Position3D {
  const pipe = { ...cursorPos };
  const key: keyof Position3D = dir.tqecAxis === 0 ? "x" : dir.tqecAxis === 1 ? "y" : "z";
  pipe[key] += dir.sign > 0 ? 1 : -2;
  return pipe;
}

/**
 * Swap the two closed-axis characters of a pipe base type.
 * E.g. "OXZ" → "OZX", "ZOX" → "XOZ", "XZO" → "ZXO".
 */
export function swapPipeVariant(pipeBase: string): string {
  const openAxis = pipeBase.indexOf("O");
  const chars = pipeBase.split("");
  const closedAxes = [0, 1, 2].filter(a => a !== openAxis);
  [chars[closedAxes[0]], chars[closedAxes[1]]] = [chars[closedAxes[1]], chars[closedAxes[0]]];
  return chars.join("");
}

/**
 * Infer the non-Hadamard PipeType to place from a source cube along the given axis.
 * The pipe's closed-axis characters come from the source cube's type characters.
 * Returns null if the closed-axis characters are both the same (e.g. "OZZ"),
 * which is not a valid pipe variant.
 */
export function inferPipeType(srcType: CubeType, tqecAxis: 0 | 1 | 2): PipeType | null {
  const chars = [srcType[0], srcType[1], srcType[2]];
  chars[tqecAxis] = "O";
  const result = chars.join("");
  return (PIPE_TYPES as readonly string[]).includes(result) ? result as PipeType : null;
}

/**
 * Determine valid CubeType options for a cube at cubePos given adjacent pipes in blocks.
 * Each adjacent pipe constrains 2 of the cube's 3 axis characters.
 * For Hadamard pipes, the swapped end has its two closed-axis chars exchanged.
 */
export function determineCubeOptions(
  cubePos: Position3D,
  blocks: Map<string, Block>,
): { determined: true; type: CubeType } | { determined: false; options: CubeType[] } {
  const constraints: (string | null)[] = [null, null, null];
  const coords: [number, number, number] = [cubePos.x, cubePos.y, cubePos.z];

  for (let axis = 0; axis < 3; axis++) {
    for (const pipeOffset of [1, -2]) {
      const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
      nCoords[axis] += pipeOffset;
      const neighbor = blocks.get(posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] }));

      if (!neighbor || !isPipeType(neighbor.type)) continue;

      const base = neighbor.type.replace("H", "");
      const hadamard = neighbor.type.length > 3;
      const openAxis = base.indexOf("O");
      if (openAxis !== axis) continue;

      // Cube at pipeOffset +1 from cube = pipe's -1 end; pipeOffset -2 = pipe's +2 end.
      // Hadamard pipes swap their closed-axis colors at the +2 (tail) end.
      const cubeAtPipeEnd = pipeOffset === 1 ? -1 : 2;
      const swapped = cubeAtPipeEnd === 2;

      for (let ca = 0; ca < 3; ca++) {
        if (ca === openAxis) continue;
        const required = pipeEndBasis(base, hadamard, openAxis, ca, swapped);
        if (constraints[ca] === null) {
          constraints[ca] = required;
        } else if (constraints[ca] !== required) {
          return { determined: false, options: [] };
        }
      }
    }
  }

  const valid = CUBE_TYPES.filter(ct => {
    for (let i = 0; i < 3; i++) {
      if (constraints[i] !== null && ct[i] !== constraints[i]) return false;
    }
    return true;
  });

  if (valid.length === 1) return { determined: true, type: valid[0] };
  return { determined: false, options: [...valid] };
}

/**
 * Map a WASD/Arrow key + camera azimuthal angle to a TQEC BuildDirection.
 * Camera azimuth is snapped to the nearest 90° to align with grid axes.
 *
 * OrbitControls azimuthal angle reference:
 *   0    = camera on +Z (Three.js), looking toward -Z = TQEC +Y
 *   π/2  = camera on +X, looking toward -X = TQEC -X
 *   π    = camera on -Z, looking toward +Z = TQEC -Y
 *  -π/2  = camera on -X, looking toward +X = TQEC +X
 */
export function wasdToBuildDirection(
  key: "w" | "a" | "s" | "d" | "arrowup" | "arrowdown",
  cameraAzimuth: number,
): BuildDirection {
  if (key === "arrowup") return { tqecAxis: 2, sign: 1 };
  if (key === "arrowdown") return { tqecAxis: 2, sign: -1 };

  // Snap to nearest 90° quadrant: 0, 1, 2, 3
  const q = ((Math.round(cameraAzimuth / (Math.PI / 2)) % 4) + 4) % 4;

  // [forward, right] pairs in TQEC coordinates per quadrant
  const cardinals: Array<[BuildDirection, BuildDirection]> = [
    [{ tqecAxis: 1, sign: 1 },  { tqecAxis: 0, sign: 1 }],   // q=0: fwd +Y, right +X
    [{ tqecAxis: 0, sign: -1 }, { tqecAxis: 1, sign: 1 }],   // q=1: fwd -X, right +Y
    [{ tqecAxis: 1, sign: -1 }, { tqecAxis: 0, sign: -1 }],  // q=2: fwd -Y, right -X
    [{ tqecAxis: 0, sign: 1 },  { tqecAxis: 1, sign: -1 }],  // q=3: fwd +X, right -Y
  ];

  const [forward, right] = cardinals[q];

  switch (key) {
    case "w": return forward;
    case "s": return { tqecAxis: forward.tqecAxis, sign: (forward.sign * -1) as 1 | -1 };
    case "d": return right;
    case "a": return { tqecAxis: right.tqecAxis, sign: (right.sign * -1) as 1 | -1 };
  }
}

/**
 * Compute the camera azimuthal angle to "look from behind" a build direction.
 * Returns null for Z-axis movement (no azimuth change for temporal axis).
 */
export function cameraAzimuthForDirection(dir: BuildDirection): number | null {
  if (dir.tqecAxis === 2) return null;
  // Camera should be behind the build direction:
  //   build +Y → camera at +Z → azimuth 0
  //   build -Y → camera at -Z → azimuth π
  //   build +X → camera at -X → azimuth -π/2
  //   build -X → camera at +X → azimuth π/2
  if (dir.tqecAxis === 1) return dir.sign === 1 ? 0 : Math.PI;
  return dir.sign === 1 ? -Math.PI / 2 : Math.PI / 2;
}

// ---------------------------------------------------------------------------
// Adjacency
// ---------------------------------------------------------------------------

/**
 * Compute the TQEC position for a new block placed adjacent to an existing block's face.
 *
 * Three.js face normal → TQEC axis:
 *   (±1, 0, 0) → TQEC X ± srcSizeX / dstSizeX
 *   (0, ±1, 0) → TQEC Z ± srcSizeZ / dstSizeZ
 *   (0, 0, ±1) → TQEC Y ∓ srcSizeY / dstSizeY
 */
/** Grid-snapping size: Y blocks occupy the same grid cell as regular cubes. */
function blockGridSize(blockType: BlockType): [number, number, number] {
  if (blockType === "Y") return [1, 1, 1];
  return blockTqecSize(blockType);
}

export function getAdjacentPos(
  srcPos: Position3D,
  srcType: BlockType,
  normal: THREE.Vector3,
  dstType: BlockType,
): Position3D {
  const nx = Math.round(normal.x);
  const ny = Math.round(normal.y);
  const nz = Math.round(normal.z);

  const srcSize = blockGridSize(srcType);
  const dstSize = blockGridSize(dstType);

  const x = srcPos.x + (nx > 0 ? srcSize[0] : nx < 0 ? -dstSize[0] : 0);
  const y = srcPos.y + (nz < 0 ? srcSize[1] : nz > 0 ? -dstSize[1] : 0);
  const z = srcPos.z + (ny > 0 ? srcSize[2] : ny < 0 ? -dstSize[2] : 0);

  return { x, y, z };
}
