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
// Position validation (tqec alternating grid)
// ---------------------------------------------------------------------------

export function isPipeType(bt: BlockType): bt is PipeType {
  return (PIPE_TYPES as readonly string[]).includes(bt);
}

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
  return slots === 1;
}

export function isValidPos(pos: Position3D, blockType: BlockType): boolean {
  if (isPipeType(blockType)) return isValidPipePos(pos);
  return isValidBlockPos(pos);
}

export function isPipeSlotCoord(v: number): boolean {
  const r = mod(v, 3);
  return r === 1;
}
/** Which TQEC axis (0=x, 1=y, 2=z) has the pipe slot at this position. */
export function pipeAxisFromPos(pos: Position3D): 0 | 1 | 2 | null {
  if (!isPipeSlotCoord(pos.x) && !isPipeSlotCoord(pos.y) && !isPipeSlotCoord(pos.z)) return null;
  if (isPipeSlotCoord(pos.x)) return 0;
  if (isPipeSlotCoord(pos.y)) return 1;
  if (isPipeSlotCoord(pos.z)) return 2;
  return null; // unreachable: at least one axis must be a pipe slot after the initial check
}

/** Map a pipe variant + position → concrete PipeType. Returns null if position is not a valid pipe pos. */
export const VARIANT_AXIS_MAP: Record<PipeVariant, [PipeType, PipeType, PipeType]> = {
  ZX:  ["OZX",  "ZOX",  "ZXO"],
  XZ:  ["OXZ",  "XOZ",  "XZO"],
  ZXH: ["OZXH", "ZOXH", "ZXOH"],
  XZH: ["OXZH", "XOZH", "XZOH"],
};

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

const X_COLOR = new THREE.Color("#ff7f7f"); // red   RGBA(255,127,127)
const Z_COLOR = new THREE.Color("#7396ff"); // blue  RGBA(115,150,255)
const Y_COLOR = new THREE.Color("#63c676"); // green RGBA(99,198,118)
const H_COLOR = new THREE.Color("#ffff65"); // yellow RGBA(255,255,101)
const H_BAND_HALF_HEIGHT = 0.08;
/** Inset so pipe walls are never coplanar with adjacent blocks/pipes. */
const WALL_EPS = 0.001;
const FACE_MASK_EPS = 1e-9;

function hasPositiveOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > FACE_MASK_EPS;
}

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
/**
 * Three.js dimensions for each block type: [x, y, z].
 * TQEC (X, Y, Z) → Three.js (X, Y=Z_tqec, Z=Y_tqec).
 */
export function blockThreeSize(blockType: BlockType): [number, number, number] {
  switch (blockType) {
    case "Y": return [1, 0.5, 1];
    case "ZXO": case "XZO": case "ZXOH": case "XZOH": return [1, 2, 1];
    case "ZOX": case "XOZ": case "ZOXH": case "XOZH": return [1, 1, 2];
    case "OZX": case "OXZ": case "OZXH": case "OXZH": return [2, 1, 1];
    default: return [1, 1, 1];
  }
}

/** Create geometry for a Z-direction pipe (open in TQEC Z / Three.js Y). */
function createZPipeGeometry(
  xAxisColor: THREE.Color,
  yAxisColor: THREE.Color,
  hadamard: boolean,
  hiddenFaces: FaceMask = 0,
): THREE.BufferGeometry {
  if (!hadamard) {
    // Non-H pipe: simple box with open faces removed
    // Shrink closed dimensions by WALL_EPS to avoid coplanar z-fighting
    const e = WALL_EPS;
    const geo = new THREE.BoxGeometry(1 - 2 * e, 2, 1 - 2 * e);
    const colors = new Float32Array(24 * 3);
    const faceColors: (THREE.Color | null)[] = [
      xAxisColor, xAxisColor, // +X, -X = TQEC X-axis
      null, null,              // +Y, -Y = TQEC Z-axis = open
      yAxisColor, yAxisColor,  // +Z, -Z = TQEC Y-axis
    ];
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
      if (face === 2 || face === 3) continue;
      for (let i = 0; i < 6; i++) {
        newIndices.push(oldIndex.getX(face * 6 + i));
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(newIndices);
    geo.clearGroups();
    return geo;
  }

  // Hadamard pipe: each wall subdivided into 3 strips (below, yellow band, above).
  // Above the band, X/Z basis colors are swapped per TQEC convention.
  const hx = 0.5 - WALL_EPS, hz = 0.5 - WALL_EPS;
  const bh = H_BAND_HALF_HEIGHT;
  const xAbove = yAxisColor; // swapped above Hadamard
  const yAbove = xAxisColor;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
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
      colors.push(color.r, color.g, color.b);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }

  // 4 walls, each with 3 strips: below band, yellow band, above band.
  // Winding order: (v1-v0)×(v2-v0) must point outward for correct raycast normals.
  const wallDefs = [
    { face: FACE_POS_X, n: [1, 0, 0], below: xAxisColor, above: xAbove,
      quad: (y0: number, y1: number): number[][] =>
        [[hx, y0, -hz], [hx, y1, -hz], [hx, y1, hz], [hx, y0, hz]] },
    { face: FACE_NEG_X, n: [-1, 0, 0], below: xAxisColor, above: xAbove,
      quad: (y0: number, y1: number): number[][] =>
        [[-hx, y0, hz], [-hx, y1, hz], [-hx, y1, -hz], [-hx, y0, -hz]] },
    { face: FACE_POS_Z, n: [0, 0, 1], below: yAxisColor, above: yAbove,
      quad: (y0: number, y1: number): number[][] =>
        [[hx, y0, hz], [hx, y1, hz], [-hx, y1, hz], [-hx, y0, hz]] },
    { face: FACE_NEG_Z, n: [0, 0, -1], below: yAxisColor, above: yAbove,
      quad: (y0: number, y1: number): number[][] =>
        [[-hx, y0, -hz], [-hx, y1, -hz], [hx, y1, -hz], [hx, y0, -hz]] },
  ];

  for (const wall of wallDefs) {
    if (hiddenFaces & wall.face) continue;
    const [v0, v1, v2, v3] = wall.quad(-1, -bh);
    addQuad(v0, v1, v2, v3, wall.n, wall.below);          // bottom strip
    const [m0, m1, m2, m3] = wall.quad(-bh, bh);
    addQuad(m0, m1, m2, m3, wall.n, H_COLOR);              // yellow band
    const [t0, t1, t2, t3] = wall.quad(bh, 1);
    addQuad(t0, t1, t2, t3, wall.n, wall.above);           // top strip (swapped)
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  return geo;
}

/** Create geometry for a Y-direction pipe (open in TQEC Y / Three.js Z). */
function createYPipeGeometry(
  xAxisColor: THREE.Color,
  zAxisColor: THREE.Color,
  hadamard: boolean,
  hiddenFaces: FaceMask = 0,
): THREE.BufferGeometry {
  if (!hadamard) {
    const e = WALL_EPS;
    const geo = new THREE.BoxGeometry(1 - 2 * e, 1 - 2 * e, 2);
    const colors = new Float32Array(24 * 3);
    const faceColors: (THREE.Color | null)[] = [
      xAxisColor, xAxisColor, // +X, -X = TQEC X-axis
      zAxisColor, zAxisColor, // +Y, -Y = TQEC Z-axis
      null, null,              // +Z, -Z = TQEC Y-axis = open
    ];
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
      if (face === 4 || face === 5) continue; // skip ±Z (open)
      for (let i = 0; i < 6; i++) {
        newIndices.push(oldIndex.getX(face * 6 + i));
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(newIndices);
    geo.clearGroups();
    return geo;
  }

  // Hadamard: each wall subdivided into 3 strips along Z (the open direction).
  // Colors swap past the band per TQEC convention.
  const hx = 0.5 - WALL_EPS, hy = 0.5 - WALL_EPS;
  const bh = H_BAND_HALF_HEIGHT;
  const xAbove = zAxisColor; // swapped past Hadamard
  const zAbove = xAxisColor;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
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
      colors.push(color.r, color.g, color.b);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }

  // 4 walls, each with 3 strips along Z.
  // Winding: (v1-v0)×(v2-v0) must point outward.
  const wallDefs = [
    { face: FACE_POS_X, n: [1, 0, 0], below: xAxisColor, above: xAbove,
      quad: (z0: number, z1: number): number[][] =>
        [[hx, hy, z0], [hx, hy, z1], [hx, -hy, z1], [hx, -hy, z0]] },
    { face: FACE_NEG_X, n: [-1, 0, 0], below: xAxisColor, above: xAbove,
      quad: (z0: number, z1: number): number[][] =>
        [[-hx, -hy, z0], [-hx, -hy, z1], [-hx, hy, z1], [-hx, hy, z0]] },
    { face: FACE_POS_Y, n: [0, 1, 0], below: zAxisColor, above: zAbove,
      quad: (z0: number, z1: number): number[][] =>
        [[-hx, hy, z0], [-hx, hy, z1], [hx, hy, z1], [hx, hy, z0]] },
    { face: FACE_NEG_Y, n: [0, -1, 0], below: zAxisColor, above: zAbove,
      quad: (z0: number, z1: number): number[][] =>
        [[hx, -hy, z0], [hx, -hy, z1], [-hx, -hy, z1], [-hx, -hy, z0]] },
  ];

  for (const wall of wallDefs) {
    if (hiddenFaces & wall.face) continue;
    const [v0, v1, v2, v3] = wall.quad(-1, -bh);
    addQuad(v0, v1, v2, v3, wall.n, wall.below);
    const [m0, m1, m2, m3] = wall.quad(-bh, bh);
    addQuad(m0, m1, m2, m3, wall.n, H_COLOR);
    const [t0, t1, t2, t3] = wall.quad(bh, 1);
    addQuad(t0, t1, t2, t3, wall.n, wall.above);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  return geo;
}

/** Create geometry for an X-direction pipe (open in TQEC X / Three.js X). */
function createXPipeGeometry(
  yAxisColor: THREE.Color,
  zAxisColor: THREE.Color,
  hadamard: boolean,
  hiddenFaces: FaceMask = 0,
): THREE.BufferGeometry {
  if (!hadamard) {
    const e = WALL_EPS;
    const geo = new THREE.BoxGeometry(2, 1 - 2 * e, 1 - 2 * e);
    const colors = new Float32Array(24 * 3);
    const faceColors: (THREE.Color | null)[] = [
      null, null,              // +X, -X = TQEC X-axis = open
      zAxisColor, zAxisColor,  // +Y, -Y = TQEC Z-axis
      yAxisColor, yAxisColor,  // +Z, -Z = TQEC Y-axis
    ];
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
      if (face === 0 || face === 1) continue; // skip ±X (open)
      for (let i = 0; i < 6; i++) {
        newIndices.push(oldIndex.getX(face * 6 + i));
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(newIndices);
    geo.clearGroups();
    return geo;
  }

  // Hadamard: each wall subdivided into 3 strips along X (the open direction).
  const hy = 0.5 - WALL_EPS, hz = 0.5 - WALL_EPS;
  const bh = H_BAND_HALF_HEIGHT;
  const yAbove = zAxisColor; // swapped past Hadamard
  const zAbove = yAxisColor;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
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
      colors.push(color.r, color.g, color.b);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }

  // 4 walls, each with 3 strips along X.
  // Winding: (v1-v0)×(v2-v0) must point outward.
  const wallDefs = [
    { face: FACE_POS_Y, n: [0, 1, 0], below: zAxisColor, above: zAbove,
      quad: (x0: number, x1: number): number[][] =>
        [[x0, hy, hz], [x1, hy, hz], [x1, hy, -hz], [x0, hy, -hz]] },
    { face: FACE_NEG_Y, n: [0, -1, 0], below: zAxisColor, above: zAbove,
      quad: (x0: number, x1: number): number[][] =>
        [[x0, -hy, -hz], [x1, -hy, -hz], [x1, -hy, hz], [x0, -hy, hz]] },
    { face: FACE_POS_Z, n: [0, 0, 1], below: yAxisColor, above: yAbove,
      quad: (x0: number, x1: number): number[][] =>
        [[x0, -hy, hz], [x1, -hy, hz], [x1, hy, hz], [x0, hy, hz]] },
    { face: FACE_NEG_Z, n: [0, 0, -1], below: yAxisColor, above: yAbove,
      quad: (x0: number, x1: number): number[][] =>
        [[x0, hy, -hz], [x1, hy, -hz], [x1, -hy, -hz], [x0, -hy, -hz]] },
  ];

  for (const wall of wallDefs) {
    if (hiddenFaces & wall.face) continue;
    const [v0, v1, v2, v3] = wall.quad(-1, -bh);
    addQuad(v0, v1, v2, v3, wall.n, wall.below);
    const [m0, m1, m2, m3] = wall.quad(-bh, bh);
    addQuad(m0, m1, m2, m3, wall.n, H_COLOR);
    const [t0, t1, t2, t3] = wall.quad(bh, 1);
    addQuad(t0, t1, t2, t3, wall.n, wall.above);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  return geo;
}

export function createBlockGeometry(blockType: BlockType, hiddenFaces: FaceMask = 0): THREE.BufferGeometry {
  if (blockType === "ZXO" || blockType === "XZO" || blockType === "ZXOH" || blockType === "XZOH") {
    const isXFirst = blockType === "XZO" || blockType === "XZOH";
    const hasH = blockType === "ZXOH" || blockType === "XZOH";
    return createZPipeGeometry(
      isXFirst ? X_COLOR : Z_COLOR,
      isXFirst ? Z_COLOR : X_COLOR,
      hasH,
      hiddenFaces,
    );
  }

  if (blockType === "ZOX" || blockType === "XOZ" || blockType === "ZOXH" || blockType === "XOZH") {
    const isXFirst = blockType === "XOZ" || blockType === "XOZH";
    const hasH = blockType === "ZOXH" || blockType === "XOZH";
    return createYPipeGeometry(
      isXFirst ? X_COLOR : Z_COLOR,
      isXFirst ? Z_COLOR : X_COLOR,
      hasH,
      hiddenFaces,
    );
  }

  if (blockType === "OZX" || blockType === "OXZ" || blockType === "OZXH" || blockType === "OXZH") {
    const isXFirst = blockType === "OXZ" || blockType === "OXZH";
    const hasH = blockType === "OZXH" || blockType === "OXZH";
    return createXPipeGeometry(
      isXFirst ? X_COLOR : Z_COLOR,
      isXFirst ? Z_COLOR : X_COLOR,
      hasH,
      hiddenFaces,
    );
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

  const [tqecX, tqecY, tqecZ] = CUBE_FACE_COLORS[blockType];

  // Map to Three.js face order: +X, -X, +Y, -Y, +Z, -Z
  const faceColors = [
    tqecX, tqecX, // Three.js +X, -X = TQEC X-axis
    tqecZ, tqecZ, // Three.js +Y, -Y = TQEC Z-axis
    tqecY, tqecY, // Three.js +Z, -Z = TQEC Y-axis
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
export function createBlockEdges(blockType: BlockType, hiddenFaces: FaceMask = 0): THREE.BufferGeometry {
  const [bx, by, bz] = blockThreeSize(blockType);
  const isPipe = (PIPE_TYPES as readonly string[]).includes(blockType);
  const e2 = isPipe ? 2 * WALL_EPS : 0;
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

  const isZPipeH = blockType === "ZXOH" || blockType === "XZOH";
  const isYPipeH = blockType === "ZOXH" || blockType === "XOZH";
  const isXPipeH = blockType === "OZXH" || blockType === "OXZH";
  if (!isZPipeH && !isYPipeH && !isXPipeH) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePoints), 3));
    return geo;
  }

  const bandEdges: number[] = [];
  // Band edge rings on the pipe wall surface (inset by WALL_EPS)

  if (isZPipeH) {
    // Z-pipe: band rings at y = ±bh (perpendicular to open direction Three.js Y)
    const z = [H_BAND_HALF_HEIGHT, -H_BAND_HALF_HEIGHT];
    for (const faceY of z) {
      if (faceY > 0 && (hiddenFaces & FACE_POS_Y)) continue;
      if (faceY < 0 && (hiddenFaces & FACE_NEG_Y)) continue;
      bandEdges.push(-hx, faceY, -hz,  hx, faceY, -hz);
      bandEdges.push(hx, faceY, -hz,  hx, faceY,  hz);
      bandEdges.push(hx, faceY,  hz, -hx, faceY,  hz);
      bandEdges.push(-hx, faceY,  hz, -hx, faceY, -hz);
    }
  } else if (isYPipeH) {
    // Y-pipe: band rings at z = ±bh (perpendicular to open direction Three.js Z)
    const z = [H_BAND_HALF_HEIGHT, -H_BAND_HALF_HEIGHT];
    for (const faceZ of z) {
      if (faceZ > 0 && (hiddenFaces & FACE_POS_Z)) continue;
      if (faceZ < 0 && (hiddenFaces & FACE_NEG_Z)) continue;
      bandEdges.push(-hx, -hy, faceZ,  hx, -hy, faceZ);
      bandEdges.push(hx, -hy, faceZ,  hx,  hy, faceZ);
      bandEdges.push(hx,  hy, faceZ, -hx,  hy, faceZ);
      bandEdges.push(-hx,  hy, faceZ, -hx, -hy, faceZ);
    }
  } else {
    // X-pipe: band rings at x = ±bh (perpendicular to open direction Three.js X)
    const x = [H_BAND_HALF_HEIGHT, -H_BAND_HALF_HEIGHT];
    for (const faceX of x) {
      if (faceX > 0 && (hiddenFaces & FACE_POS_X)) continue;
      if (faceX < 0 && (hiddenFaces & FACE_NEG_X)) continue;
      bandEdges.push(faceX, -hy, -hz,  faceX,  hy, -hz);
      bandEdges.push(faceX,  hy, -hz,  faceX,  hy,  hz);
      bandEdges.push(faceX,  hy,  hz,  faceX, -hy,  hz);
      bandEdges.push(faceX, -hy,  hz,  faceX, -hy, -hz);
    }
  }

  const merged = new Float32Array(linePoints.length + bandEdges.length);
  merged.set(linePoints);
  merged.set(new Float32Array(bandEdges), linePoints.length);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(merged, 3));
  return geo;
}

// ---------------------------------------------------------------------------
// Spatial index — O(1) neighbor lookups instead of O(n) scans
// ---------------------------------------------------------------------------

export type SpatialIndex = Map<string, Block[]>;

function cellKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

/** Build a spatial index: each integer cell maps to blocks that overlap it. */
export function buildSpatialIndex(blocks: Map<string, Block>): SpatialIndex {
  const index: SpatialIndex = new Map();
  for (const block of blocks.values()) {
    const [sx, sy, sz] = blockTqecSize(block.type);
    const x0 = Math.floor(block.pos.x);
    const x1 = Math.floor(block.pos.x + sx - 1e-9);
    const y0 = Math.floor(block.pos.y);
    const y1 = Math.floor(block.pos.y + sy - 1e-9);
    const z0 = Math.floor(block.pos.z);
    const z1 = Math.floor(block.pos.z + sz - 1e-9);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const key = cellKey(x, y, z);
          const list = index.get(key);
          if (list) list.push(block);
          else index.set(key, [block]);
        }
      }
    }
  }
  return index;
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

/** Check if placing a block at pos with the given type overlaps any existing block. */
export function hasBlockOverlap(pos: Position3D, type: BlockType, blocks: Map<string, Block>, index?: SpatialIndex): boolean {
  const sz = blockTqecSize(type);
  const candidates = index
    ? getNearbyBlocks(index, pos, sz, 0)
    : Array.from(blocks.values());
  for (const block of candidates) {
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

/** Round to 4 decimals to avoid float-precision key collisions (e.g. 0.5+0.5+0.5 ≠ 1.5). */
function r4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export function posKey(pos: Position3D): string {
  return `${r4(pos.x)},${r4(pos.y)},${r4(pos.z)}`;
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
  const [sx, sy, sz] = blockType ? blockTqecSize(blockType) : [1, 1, 1];
  return [pos.x + sx / 2, pos.z + sz / 2, -(pos.y + sy / 2)];
}

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
 * Compute the TQEC position for a new block placed adjacent to an existing block's face.
 *
 * Three.js face normal → TQEC axis:
 *   (±1, 0, 0) → TQEC X ± srcSizeX / dstSizeX
 *   (0, ±1, 0) → TQEC Z ± srcSizeZ / dstSizeZ
 *   (0, 0, ±1) → TQEC Y ∓ srcSizeY / dstSizeY
 */
export function getAdjacentPos(
  srcPos: Position3D,
  srcType: BlockType,
  normal: THREE.Vector3,
  dstType: BlockType,
): Position3D {
  const nx = Math.round(normal.x);
  const ny = Math.round(normal.y);
  const nz = Math.round(normal.z);

  const srcSize = blockTqecSize(srcType);
  const dstSize = blockTqecSize(dstType);

  const x = srcPos.x + (nx > 0 ? srcSize[0] : nx < 0 ? -dstSize[0] : 0);
  const y = srcPos.y + (nz < 0 ? srcSize[1] : nz > 0 ? -dstSize[1] : 0);
  const z = srcPos.z + (ny > 0 ? srcSize[2] : ny < 0 ? -dstSize[2] : 0);

  return { x, y, z };
}
