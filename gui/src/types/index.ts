import * as THREE from "three";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Position3D {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// View modes (perspective vs. orthographic elevation)
// ---------------------------------------------------------------------------

export type IsoAxis = "x" | "y" | "z";

export type ViewMode =
  | { kind: "persp" }
  | { kind: "iso"; axis: IsoAxis; slice: number };

/** TQEC axis index: 0=x, 1=y, 2=z. */
export function axisIndex(axis: IsoAxis): 0 | 1 | 2 {
  return axis === "x" ? 0 : axis === "y" ? 1 : 2;
}

/** Returns the integer slice that the given depth coordinate falls into.
 *  Each slice spans 3 units (cube + 2 pipe slots) starting at a multiple of 3. */
export function depthToSlice(depth: number): number {
  return Math.floor(depth / 3) * 3;
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

/**
 * Toolbar-order list of placeable items (Port + 6 cubes + Y + 4 pipes).
 * Pointer is excluded — it's a tool, not an object. Used by ArrowLeft/Right
 * cycling in Drag / Drop mode.
 */
export type Placeable =
  | { kind: "port" }
  | { kind: "cube"; cubeType: BlockType }
  | { kind: "pipe"; variant: PipeVariant };

export const PLACEABLE_ORDER: ReadonlyArray<Placeable> = [
  { kind: "port" },
  ...CUBE_TYPES.map((t) => ({ kind: "cube" as const, cubeType: t as BlockType })),
  { kind: "cube" as const, cubeType: "Y" as BlockType },
  ...PIPE_VARIANTS.map((v) => ({ kind: "pipe" as const, variant: v })),
];

/**
 * Index of the currently armed placeable in PLACEABLE_ORDER, or -1 if the
 * pointer tool is armed (no placeable selected).
 */
export function currentPlaceableIndex(
  armedTool: "pointer" | "cube" | "pipe" | "port" | "paste",
  cubeType: BlockType,
  pipeVariant: PipeVariant | null,
): number {
  if (armedTool === "pointer" || armedTool === "paste") return -1;
  if (armedTool === "port") return 0;
  if (armedTool === "pipe") {
    if (!pipeVariant) return -1;
    return PLACEABLE_ORDER.findIndex((p) => p.kind === "pipe" && p.variant === pipeVariant);
  }
  return PLACEABLE_ORDER.findIndex((p) => p.kind === "cube" && p.cubeType === cubeType);
}

export interface Block {
  pos: Position3D;
  type: BlockType;
  /**
   * Optional group membership. Blocks sharing a `groupId` are treated as a
   * unit by selection (click any → fan out), verify (filter by groupId), ZX
   * extraction, and copy/paste. A block belongs to at most one group.
   * Auto-promoted blocks intentionally start ungrouped (`undefined`).
   */
  groupId?: string;
}

export type PortIO = "in" | "out";

export interface PortMeta {
  label: string;
  io: PortIO;
  /**
   * User-defined display order, used by the Ports table and Stabilizer Flows
   * panel to determine the qubit-register position of each port. Lower ranks
   * sort first; ports without a rank fall back to spatial sort and appear
   * after ranked ports.
   */
  rank?: number;
}

// ---------------------------------------------------------------------------
// Color constants — single source of truth
// ---------------------------------------------------------------------------

export const X_COLOR = new THREE.Color("#ff7f7f"); // red
export const Z_COLOR = new THREE.Color("#7396ff"); // blue
export const Y_COLOR = new THREE.Color("#63c676"); // green (Y half-cube blocks)
export const H_COLOR = new THREE.Color("#ffff65"); // yellow
// Y-type defect ("twist") edges per Gidney's defect-diagram convention.
// Distinct from Y_COLOR so Y blocks (green) and Y defects (magenta) read apart.
export const Y_DEFECT_COLOR = new THREE.Color("#ff39c2");

export const X_HEX = "#ff7f7f";
export const Z_HEX = "#7396ff";
export const Y_HEX = "#63c676";
export const H_HEX = "#ffff65";
export const Y_DEFECT_HEX = "#ff39c2";

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

/** Toggle the Hadamard flag on a pipe type: OZX ↔ OZXH, etc. */
export function toggleHadamard(pt: PipeType): PipeType {
  return (pt.endsWith("H") ? pt.slice(0, -1) : pt + "H") as PipeType;
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

/**
 * Snap two raw in-plane coordinates to a valid TQEC pair: either both at block
 * positions (multiples of 3) or one at a pipe slot (≡ 1 mod 3) for pipes.
 */
export function snapInPlane(rawA: number, rawB: number, forPipe: boolean): { a: number; b: number } {
  if (!forPipe) return { a: nearestMult3(rawA), b: nearestMult3(rawB) };
  const ba = nearestMult3(rawA), bb = nearestMult3(rawB);
  const pa = nearest3kPipeCoord(rawA), pb = nearest3kPipeCoord(rawB);
  const d1 = Math.abs(rawA - pa) + Math.abs(rawB - bb);
  const d2 = Math.abs(rawA - ba) + Math.abs(rawB - pb);
  if (d1 <= d2) return { a: pa, b: bb };
  return { a: ba, b: pb };
}

/** Snap raw TQEC X/Y coordinates (on ground plane z=0) to nearest valid position. */
export function snapGroundPos(rawX: number, rawY: number, forPipe: boolean): Position3D {
  const { a, b } = snapInPlane(rawX, rawY, forPipe);
  return { x: a, y: b, z: 0 };
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

/**
 * Y-defect edges: the subset of block edges where the two adjacent faces have
 * different basis (one X, one Z). These are the "twist" defects in TQEC defect
 * diagrams — see Gidney's "Understanding Defect Diagrams".
 *
 * Cubes: 8 of 12 edges qualify for any TQEC cube type (the 4 edges parallel to
 * the matched-basis axis are the same-basis pair and are skipped).
 * Pipes: the 4 edges along the open axis (where the two wall-pairs of opposite
 * basis meet). End caps and band rings are not emitted in v1; the H-pipe band
 * ring is a known follow-up.
 * Y blocks: empty (single-basis block, no X/Z transitions).
 *
 * An edge is skipped if both adjacent faces are hidden.
 */
export function createYDefectEdges(blockType: BlockType, hiddenFaces: FaceMask = 0): THREE.BufferGeometry {
  const empty = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    return g;
  };

  if (blockType === "Y") return empty();

  const [bx, by, bz] = blockThreeSize(blockType);
  const pipe = isPipeType(blockType);
  const e2 = pipe ? 2 * WALL_EPS : 0;
  const hx = bx / 2 - e2 / 2;
  const hy = by / 2 - e2 / 2;
  const hz = bz / 2 - e2 / 2;
  const corners: Array<[number, number, number]> = [
    [-hx, -hy, -hz],
    [-hx, -hy,  hz],
    [-hx,  hy, -hz],
    [-hx,  hy,  hz],
    [ hx, -hy, -hz],
    [ hx, -hy,  hz],
    [ hx,  hy, -hz],
    [ hx,  hy,  hz],
  ];

  // Each cube edge with the two face bits that share it.
  // Corner index bits: 0=±X, 1=±Y, 2=±Z (0=neg, 1=pos).
  const edgeFacePairs: Array<{ i: number; j: number; faceA: number; faceB: number }> = [
    // X-aligned edges (vary X bit)
    { i: 0, j: 4, faceA: FACE_NEG_Y, faceB: FACE_NEG_Z },
    { i: 1, j: 5, faceA: FACE_NEG_Y, faceB: FACE_POS_Z },
    { i: 2, j: 6, faceA: FACE_POS_Y, faceB: FACE_NEG_Z },
    { i: 3, j: 7, faceA: FACE_POS_Y, faceB: FACE_POS_Z },
    // Y-aligned edges (vary Y bit)
    { i: 0, j: 2, faceA: FACE_NEG_X, faceB: FACE_NEG_Z },
    { i: 1, j: 3, faceA: FACE_NEG_X, faceB: FACE_POS_Z },
    { i: 4, j: 6, faceA: FACE_POS_X, faceB: FACE_NEG_Z },
    { i: 5, j: 7, faceA: FACE_POS_X, faceB: FACE_POS_Z },
    // Z-aligned edges (vary Z bit)
    { i: 0, j: 1, faceA: FACE_NEG_X, faceB: FACE_NEG_Y },
    { i: 2, j: 3, faceA: FACE_NEG_X, faceB: FACE_POS_Y },
    { i: 4, j: 5, faceA: FACE_POS_X, faceB: FACE_NEG_Y },
    { i: 6, j: 7, faceA: FACE_POS_X, faceB: FACE_POS_Y },
  ];

  // Resolve the basis ('X' | 'Z' | null) of each Three.js face for this block.
  // null = open / no-basis face (pipe end caps).
  const faceBasis: Record<number, "X" | "Z" | null> = {
    [FACE_POS_X]: null, [FACE_NEG_X]: null,
    [FACE_POS_Y]: null, [FACE_NEG_Y]: null,
    [FACE_POS_Z]: null, [FACE_NEG_Z]: null,
  };

  if (pipe) {
    const base = blockType.replace("H", "");
    const tqecOpen = base.indexOf("O") as 0 | 1 | 2;
    const threeOpen = TQEC_TO_THREE_AXIS[tqecOpen];
    const closed = [0, 1, 2].filter(a => a !== threeOpen) as [number, number];
    for (const ta of closed) {
      const ch = base[THREE_TO_TQEC_AXIS[ta]] as "X" | "Z";
      faceBasis[FACE_BIT_BY_INDEX[ta * 2]] = ch;
      faceBasis[FACE_BIT_BY_INDEX[ta * 2 + 1]] = ch;
    }
    // Open-axis faces stay null (no basis).
  } else {
    // Cube type. Three.js face → TQEC axis: +X/-X→X(0), +Y/-Y→Z(2), +Z/-Z→Y(1).
    const xCh = blockType[0] as "X" | "Z";
    const yCh = blockType[1] as "X" | "Z";
    const zCh = blockType[2] as "X" | "Z";
    faceBasis[FACE_POS_X] = xCh; faceBasis[FACE_NEG_X] = xCh;
    faceBasis[FACE_POS_Y] = zCh; faceBasis[FACE_NEG_Y] = zCh;
    faceBasis[FACE_POS_Z] = yCh; faceBasis[FACE_NEG_Z] = yCh;
  }

  const linePoints: number[] = [];
  for (const { i, j, faceA, faceB } of edgeFacePairs) {
    const ba = faceBasis[faceA];
    const bb = faceBasis[faceB];
    if (!ba || !bb) continue;          // open / no-basis face
    if (ba === bb) continue;           // same basis → not a Y defect
    // If either adjacent face is hidden, the visible surface continues into the
    // neighboring block. Piper-draw's color rules guarantee the neighbor extends
    // that face with the same basis, so the merged surface has no transition at
    // this edge — the Y-defect "vanishes into the join". (In free-build mode the
    // color rules can be violated, in which case we'd miss a real transition.
    // Acceptable trade-off; tagged as known limitation.)
    if ((hiddenFaces & faceA) || (hiddenFaces & faceB)) continue;
    linePoints.push(...corners[i], ...corners[j]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePoints), 3));
  return geo;
}

/** Default cylinder radius for Y-defect tubes, in Three.js units (block edge = 1). */
export const Y_DEFECT_CYLINDER_RADIUS = 0.05;

/**
 * Returns a Group of cylinder meshes representing Y-defect edges as 3D tubes,
 * matching the Gidney defect-diagram convention (magenta cylinders along
 * X/Z-transition edges). Uses createYDefectEdges as the geometric source so
 * tube placement and line-segment placement are guaranteed to agree.
 *
 * Geometry only — caller supplies the material. Cylinders are oriented from
 * each edge's first endpoint to its second; the group is centered in the
 * block's local space so it can be added directly alongside the block mesh.
 */
export function createYDefectCylinderGroup(
  blockType: BlockType,
  hiddenFaces: FaceMask = 0,
  material: THREE.Material,
  radius: number = Y_DEFECT_CYLINDER_RADIUS,
): THREE.Group {
  const group = new THREE.Group();
  const edges = createYDefectEdges(blockType, hiddenFaces);
  const positions = edges.getAttribute("position").array as Float32Array;
  edges.dispose();

  const up = new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const dir = new THREE.Vector3();

  for (let i = 0; i < positions.length; i += 6) {
    a.set(positions[i], positions[i + 1], positions[i + 2]);
    b.set(positions[i + 3], positions[i + 4], positions[i + 5]);
    dir.subVectors(b, a);
    const length = dir.length();
    if (length < 1e-6) continue;

    const cyl = new THREE.CylinderGeometry(radius, radius, length, 12);
    const mesh = new THREE.Mesh(cyl, material);
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(up, dir.divideScalar(length));
    group.add(mesh);
  }
  return group;
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
 *
 * For each of the pipe's two endpoints:
 *  - If a real cube exists, the pipe's basis on the two closed axes must match
 *    the cube's basis on those axes (strict check).
 *  - If the position is a port (no real cube), the pipe is allowed iff some
 *    cube type at that position would satisfy both the new pipe's basis AND
 *    any other pipes already attached at the port. This lets the user wire up
 *    a port whose type is still flexible — auto-promotion picks a canonical
 *    type that satisfies all pipes.
 *
 * For Hadamard pipes, the far end (offset +2) uses swapped colors.
 * Returns true if there IS a conflict (placement should be rejected).
 */
/** Structural subset of Map<string, Block> — helpers only need `.get()`, so
 *  a lightweight wrapper (e.g. one that hides selected keys during a drag)
 *  can be passed instead of cloning the full map. */
export interface BlocksLookup {
  get(key: string): Block | undefined;
}

export function hasPipeColorConflict(
  pipeType: PipeType,
  pipePos: Position3D,
  blocks: BlocksLookup,
): boolean {
  const base = pipeType.replace("H", "");
  const hadamard = pipeType.length > 3;
  const openAxis = base.indexOf("O"); // 0, 1, or 2

  const coords: [number, number, number] = [pipePos.x, pipePos.y, pipePos.z];

  for (const offset of [-1, 2]) {
    const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
    nCoords[openAxis] += offset;
    const neighborPos: Position3D = { x: nCoords[0], y: nCoords[1], z: nCoords[2] };
    const neighbor = blocks.get(posKey(neighborPos));

    const swapped = offset === 2;

    if (!neighbor) {
      // Port endpoint: check if any cube type satisfies both existing pipe
      // constraints at this position AND the new pipe's basis requirements.
      const opts = determineCubeOptions(neighborPos, blocks);
      const candidates: readonly CubeType[] = opts.determined ? [opts.type] : opts.options;
      if (candidates.length === 0) return true;
      const anyMatches = candidates.some(ct => {
        for (let axis = 0; axis < 3; axis++) {
          if (axis === openAxis) continue;
          if (pipeEndBasis(base, hadamard, openAxis, axis, swapped) !== ct[axis]) return false;
        }
        return true;
      });
      if (!anyMatches) return true;
      continue;
    }

    if (neighbor.type === "Y") continue;
    if (isPipeType(neighbor.type)) continue;

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
  blocks: BlocksLookup,
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
  blocks: BlocksLookup,
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
// Keyboard Build mode types & logic
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
 * Given the previous and destination cursor positions of a single build step,
 * return the posKey of the pipe the step traversed. prev and dest differ by
 * exactly ±3 along one axis; the pipe sits at prev±{1,2} in that slot.
 */
export function traversedPipeKey(prev: Position3D, dest: Position3D): string {
  const dx = dest.x - prev.x, dy = dest.y - prev.y, dz = dest.z - prev.z;
  const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
  const delta = axis === 0 ? dx : axis === 1 ? dy : dz;
  const offset = delta > 0 ? 1 : -2;
  const pipe = { x: prev.x, y: prev.y, z: prev.z };
  if (axis === 0) pipe.x += offset;
  else if (axis === 1) pipe.y += offset;
  else pipe.z += offset;
  return posKey(pipe);
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
 * Flip basis colors on any BlockType by globally swapping X↔Z.
 * Cubes: "XZZ" → "ZXX", pipes: "OXZ" → "OZX", "XZOH" → "ZXOH". Y is returned unchanged.
 */
export function flipBlockType(type: BlockType): BlockType {
  if (type === "Y") return type;
  let out = "";
  for (const ch of type) {
    if (ch === "X") out += "Z";
    else if (ch === "Z") out += "X";
    else out += ch;
  }
  return out as BlockType;
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
  blocks: BlocksLookup,
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
 * Lightweight `BlocksLookup` overlay: returns from `overrides` if present,
 * else from `base`. Avoids `new Map(blocks)` clones in hot validation loops.
 */
class BlocksOverlay implements BlocksLookup {
  private readonly base: BlocksLookup;
  private readonly overrides: Map<string, Block>;
  constructor(base: BlocksLookup, overrides: Map<string, Block>) {
    this.base = base;
    this.overrides = overrides;
  }
  get(key: string): Block | undefined {
    return this.overrides.has(key) ? this.overrides.get(key) : this.base.get(key);
  }
}

/**
 * For a candidate cube T at one endpoint of pipe `n`, return the set of valid
 * retyped pipe types whose other end still validates per `hasPipeColorConflict`.
 *
 * Enumerates all 4 pipe variants for the given open axis (2 base chars × {no H, H})
 * and filters by overlay-validated `hasPipeColorConflict`. This is symmetric on
 * both pipe endpoints — correctly handles cases where T is at the +2 (far) end
 * of the pipe, where Hadamard swaps the basis chars at OUR end (not just the
 * other end). Naive `inferPipeType(T, axis) + maybeH` is wrong for far-end
 * with H because the chars need to be swapped first.
 */
function pipeRetypeCandidates(
  cubePos: Position3D,
  cubeKey: string,
  T: CubeType,
  axis: 0 | 1 | 2,
  nPos: Position3D,
  nKey: string,
  blocks: BlocksLookup,
): PipeType[] {
  const out: PipeType[] = [];
  for (const candidate of PIPE_TYPES) {
    if ((candidate as string).replace("H", "").indexOf("O") !== axis) continue;
    const overrides = new Map<string, Block>();
    overrides.set(cubeKey, { pos: cubePos, type: T });
    overrides.set(nKey, { pos: nPos, type: candidate });
    const overlay = new BlocksOverlay(blocks, overrides);
    if (!hasPipeColorConflict(candidate, nPos, overlay)) out.push(candidate);
  }
  return out;
}

/**
 * Like `determineCubeOptions`, but allows the *adjacent pipes* to retype
 * alongside the cube — including toggling Hadamard on a per-pipe basis. A
 * candidate cube type `T` is valid iff every adjacent pipe has at least one
 * retype variant (H or non-H) whose far end still validates per
 * `hasPipeColorConflict`.
 *
 * This is the helper used by user-facing cube-cycle UI (cycleBlock,
 * cycleSelectedType, Toolbar greying). Use the strict `determineCubeOptions`
 * for canonicalisation (port auto-promote, .dae import) and pipe-cycle
 * ambiguity detection — those compute "valid given existing pipes" and
 * intentionally do not imply pipe retyping.
 *
 * Local-only semantic: only pipes directly adjacent to `cubePos` are
 * considered for retyping. Far-end cubes are checked strictly. No multi-hop
 * CSP. Returns `CubeType[]` in `CUBE_TYPES` order.
 */
export function determineCubeOptionsWithPipeRetype(
  cubePos: Position3D,
  blocks: BlocksLookup,
): CubeType[] {
  const cubeKey = posKey(cubePos);
  const coords: [number, number, number] = [cubePos.x, cubePos.y, cubePos.z];
  const result: CubeType[] = [];

  for (const T of CUBE_TYPES) {
    let ok = true;
    for (let axis = 0; axis < 3 && ok; axis++) {
      for (const pipeOffset of [1, -2]) {
        const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
        nCoords[axis] += pipeOffset;
        const nPos: Position3D = { x: nCoords[0], y: nCoords[1], z: nCoords[2] };
        const nKey = posKey(nPos);
        const neighbor = blocks.get(nKey);
        if (!neighbor || !isPipeType(neighbor.type)) continue;

        const base = neighbor.type.replace("H", "");
        if (base.indexOf("O") !== axis) continue;

        const candidates = pipeRetypeCandidates(
          cubePos, cubeKey, T, axis as 0 | 1 | 2, nPos, nKey, blocks,
        );
        if (candidates.length === 0) { ok = false; break; }
      }
    }
    if (ok) result.push(T);
  }
  return result;
}

/**
 * Compute the pipe-retype updates required to make `newCubeType` consistent
 * with adjacent pipes. Returns `null` if any adjacent pipe has no valid
 * retype (neither H-preserved nor H-toggled). Returns `[]` when no pipe
 * needs to change. For each pipe, prefers H-preserved when it works, falls
 * back to H-toggled — so a non-H pipe stays non-H whenever possible.
 *
 * Used by both `cycleBlock` (build mode) and `cycleSelectedType` (edit mode)
 * to keep their pipe-mutation logic in one place.
 */
export function computePipeRetypes(
  blocks: BlocksLookup,
  cubePos: Position3D,
  newCubeType: CubeType,
): Array<{ key: string; oldType: PipeType; newType: PipeType }> | null {
  const cubeKey = posKey(cubePos);
  const coords: [number, number, number] = [cubePos.x, cubePos.y, cubePos.z];
  const updates: Array<{ key: string; oldType: PipeType; newType: PipeType }> = [];

  for (let axis = 0; axis < 3; axis++) {
    for (const pipeOffset of [1, -2]) {
      const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
      nCoords[axis] += pipeOffset;
      const nPos: Position3D = { x: nCoords[0], y: nCoords[1], z: nCoords[2] };
      const nKey = posKey(nPos);
      const neighbor = blocks.get(nKey);
      if (!neighbor || !isPipeType(neighbor.type)) continue;

      const oldType = neighbor.type as PipeType;
      const oldHadamard = oldType.length > 3;
      const base = oldType.replace("H", "");
      if (base.indexOf("O") !== axis) continue;

      const candidates = pipeRetypeCandidates(
        cubePos, cubeKey, newCubeType, axis as 0 | 1 | 2, nPos, nKey, blocks,
      );
      if (candidates.length === 0) return null;
      // Preference order: keep oldType if valid (no change); else prefer same H
      // state as oldType (don't add/remove Hadamard if unnecessary); else any.
      let newType: PipeType | undefined;
      if (candidates.includes(oldType)) newType = oldType;
      else newType = candidates.find((c) => (c.length > 3) === oldHadamard) ?? candidates[0];
      if (newType === oldType) continue;
      updates.push({ key: nKey, oldType, newType });
    }
  }
  return updates;
}

/**
 * Return posKeys of pipes whose open-axis endpoint lies at cubePos.
 * Used by the cube → port conversion (must have ≤1) and by the cascade-delete
 * path (deleting a junction cube also removes its attached pipes).
 */
export function getAttachedPipeKeys(
  cubePos: Position3D,
  blocks: Map<string, Block>,
): string[] {
  const keys: string[] = [];
  const coords: [number, number, number] = [cubePos.x, cubePos.y, cubePos.z];
  for (let axis = 0; axis < 3; axis++) {
    for (const pipeOffset of [1, -2]) {
      const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
      nCoords[axis] += pipeOffset;
      const k = posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] });
      const neighbor = blocks.get(k);
      if (!neighbor || !isPipeType(neighbor.type)) continue;
      const base = neighbor.type.replace("H", "");
      if (base.indexOf("O") === axis) keys.push(k);
    }
  }
  return keys;
}

/**
 * Count the number of pipes whose open-axis endpoint lies at cubePos.
 * Used to decide when a port position has "enough" pipes to auto-promote to a cube.
 */
export function countAttachedPipes(
  cubePos: Position3D,
  blocks: Map<string, Block>,
): number {
  return getAttachedPipeKeys(cubePos, blocks).length;
}

/**
 * Collect all port positions in the diagram: open pipe endpoints plus user-placed
 * port markers. Positions already occupied by a block are excluded. Returned in
 * deterministic sort order (by x, then y, then z).
 */
export function getAllPortPositions(
  blocks: Map<string, Block>,
  explicitPorts: Set<string>,
): Position3D[] {
  const seen = new Set<string>();
  const result: Position3D[] = [];

  const add = (pos: Position3D) => {
    const key = posKey(pos);
    if (blocks.has(key) || seen.has(key)) return;
    seen.add(key);
    result.push(pos);
  };

  for (const block of blocks.values()) {
    if (!isPipeType(block.type)) continue;
    const base = block.type.replace("H", "");
    const openAxis = base.indexOf("O");
    const coords: [number, number, number] = [block.pos.x, block.pos.y, block.pos.z];
    for (const offset of [-1, 2]) {
      const n: [number, number, number] = [coords[0], coords[1], coords[2]];
      n[openAxis] += offset;
      add({ x: n[0], y: n[1], z: n[2] });
    }
  }

  for (const key of explicitPorts) {
    const parts = key.split(",").map(Number);
    add({ x: parts[0], y: parts[1], z: parts[2] });
  }

  result.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
  return result;
}

/**
 * Like `getAllPortPositions`, but ordered by user-defined `PortMeta.rank`
 * with spatial sort as fallback for any port without a rank. This is the
 * order shown in the Ports table and used to position qubits in the
 * Stabilizer Flows table when interpreted as a circuit.
 */
export function getOrderedPortPositions(
  blocks: Map<string, Block>,
  explicitPorts: Set<string>,
  portMeta: Map<string, PortMeta>,
): Position3D[] {
  const positions = getAllPortPositions(blocks, explicitPorts);
  return positions.slice().sort((a, b) => {
    const ra = portMeta.get(posKey(a))?.rank;
    const rb = portMeta.get(posKey(b))?.rank;
    const ka = ra ?? Number.POSITIVE_INFINITY;
    const kb = rb ?? Number.POSITIVE_INFINITY;
    if (ka !== kb) return ka - kb;
    return a.x - b.x || a.y - b.y || a.z - b.z;
  });
}

/**
 * Default I/O direction for a port at `pos`, inferred from any Z-axis pipe
 * touching it: +z dangling end → "out", -z dangling end → "in". Falls back
 * to "in" for X/Y-axis pipes and stand-alone explicit port markers.
 *
 * In lattice-surgery diagrams +z is the time direction, so ports at the top
 * of the diagram are circuit outputs and ports at the bottom are inputs.
 */
export function defaultPortIO(
  pos: Position3D,
  blocks: Map<string, Block>,
): "in" | "out" {
  // A Z-axis pipe spans piper-grid length 3 along z. A port at piper-z `pz`
  // is the +z (high) end of a pipe at z = pz - 2, or the -z (low) end of a
  // pipe at z = pz + 1. See getAllPortPositions for the offset convention.
  const below = blocks.get(posKey({ x: pos.x, y: pos.y, z: pos.z - 2 }));
  if (
    below &&
    isPipeType(below.type) &&
    below.type.replace("H", "").indexOf("O") === 2
  ) {
    return "out";
  }
  const above = blocks.get(posKey({ x: pos.x, y: pos.y, z: pos.z + 1 }));
  if (
    above &&
    isPipeType(above.type) &&
    above.type.replace("H", "").indexOf("O") === 2
  ) {
    return "in";
  }
  return "in";
}

/**
 * Pick a canonical CubeType for a port position, or null if it should remain a port.
 *
 * Rules:
 *   - Fewer than 2 attached pipes: return null (still a port).
 *   - 2+ pipes that uniquely constrain: return that type.
 *   - 2+ pipes with multiple valid options (colinear-pipe ambiguity, e.g. XZZ vs XZX
 *     when both Z faces are hidden by Z-pipes): pick the first valid CUBE_TYPES entry.
 *     This may differ from a hand-authored TQEC graph — see CLAUDE.md "Canonicalisation
 *     assumption" for the rationale.
 *   - 2+ pipes with conflicting constraints (no valid options): return null.
 */
export function canonicalCubeForPort(
  cubePos: Position3D,
  blocks: Map<string, Block>,
): CubeType | null {
  if (countAttachedPipes(cubePos, blocks) < 2) return null;
  const result = determineCubeOptions(cubePos, blocks);
  if (result.determined) return result.type;
  if (result.options.length === 0) return null;
  for (const ct of CUBE_TYPES) {
    if (result.options.includes(ct)) return ct;
  }
  return null;
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
  axisAbsolute: boolean = false,
): BuildDirection {
  if (key === "arrowup") return { tqecAxis: 2, sign: 1 };
  if (key === "arrowdown") return { tqecAxis: 2, sign: -1 };

  // Axis-absolute mode: WASD maps to fixed world axes regardless of camera.
  if (axisAbsolute) {
    switch (key) {
      case "w": return { tqecAxis: 0, sign: 1 };
      case "s": return { tqecAxis: 0, sign: -1 };
      case "a": return { tqecAxis: 1, sign: 1 };
      case "d": return { tqecAxis: 1, sign: -1 };
    }
  }

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
