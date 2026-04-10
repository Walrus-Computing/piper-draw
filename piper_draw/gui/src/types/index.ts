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

export const PIPE_TYPES = ["ZXO", "XZO", "ZXOH", "XZOH"] as const;
export type PipeType = (typeof PIPE_TYPES)[number];

export type BlockType = CubeType | "Y" | PipeType;
export const ALL_BLOCK_TYPES = [...CUBE_TYPES, "Y", ...PIPE_TYPES] as const;

export interface Block {
  pos: Position3D;
  type: BlockType;
}

const X_COLOR = new THREE.Color("#ff4444"); // X basis = red
const Z_COLOR = new THREE.Color("#4488ff"); // Z basis = blue
const Y_COLOR = new THREE.Color("#44cc44"); // Y basis = green
const H_COLOR = new THREE.Color("#ffcc00"); // Hadamard = yellow
const H_BAND_HALF_HEIGHT = 0.08;

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
    default: return [1, 1, 1];
  }
}

/** Create geometry for a Z-direction pipe (open in TQEC Z / Three.js Y). */
function createZPipeGeometry(
  xAxisColor: THREE.Color,
  yAxisColor: THREE.Color,
  hadamard: boolean,
): THREE.BufferGeometry {
  if (!hadamard) {
    // Non-H pipe: simple box with open faces removed
    const geo = new THREE.BoxGeometry(1, 2, 1);
    const colors = new Float32Array(24 * 3);
    const faceColors: (THREE.Color | null)[] = [
      xAxisColor, xAxisColor, // +X, -X = TQEC X-axis
      null, null,              // +Y, -Y = TQEC Z-axis = open
      yAxisColor, yAxisColor,  // +Z, -Z = TQEC Y-axis
    ];
    for (let face = 0; face < 6; face++) {
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
  const hx = 0.5, hz = 0.5;
  const bh = H_BAND_HALF_HEIGHT;
  const xAbove = yAxisColor; // swapped above Hadamard
  const yAbove = xAxisColor;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
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
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }

  // 4 walls, each with 3 strips: below band, yellow band, above band.
  // Winding order: (v1-v0)×(v2-v0) must point outward for correct raycast normals.
  const wallDefs = [
    { n: [1, 0, 0], below: xAxisColor, above: xAbove,
      quad: (y0: number, y1: number): number[][] =>
        [[hx, y0, -hz], [hx, y1, -hz], [hx, y1, hz], [hx, y0, hz]] },
    { n: [-1, 0, 0], below: xAxisColor, above: xAbove,
      quad: (y0: number, y1: number): number[][] =>
        [[-hx, y0, hz], [-hx, y1, hz], [-hx, y1, -hz], [-hx, y0, -hz]] },
    { n: [0, 0, 1], below: yAxisColor, above: yAbove,
      quad: (y0: number, y1: number): number[][] =>
        [[hx, y0, hz], [hx, y1, hz], [-hx, y1, hz], [-hx, y0, hz]] },
    { n: [0, 0, -1], below: yAxisColor, above: yAbove,
      quad: (y0: number, y1: number): number[][] =>
        [[-hx, y0, -hz], [-hx, y1, -hz], [hx, y1, -hz], [hx, y0, -hz]] },
  ];

  for (const wall of wallDefs) {
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
  geo.setIndex(indices);
  return geo;
}

export function createBlockGeometry(blockType: BlockType): THREE.BufferGeometry {
  if (blockType === "ZXO" || blockType === "XZO" || blockType === "ZXOH" || blockType === "XZOH") {
    const isXFirst = blockType === "XZO" || blockType === "XZOH";
    const hasH = blockType === "ZXOH" || blockType === "XZOH";
    return createZPipeGeometry(
      isXFirst ? X_COLOR : Z_COLOR,
      isXFirst ? Z_COLOR : X_COLOR,
      hasH,
    );
  }

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

/** Edge line segments for a block type, including Hadamard band edges for H pipes. */
export function createBlockEdges(blockType: BlockType): THREE.BufferGeometry {
  const fullBox = new THREE.BoxGeometry(...blockThreeSize(blockType));
  const edges = new THREE.EdgesGeometry(fullBox);

  const isH = blockType === "ZXOH" || blockType === "XZOH";
  if (!isH) return edges;

  // Add horizontal edge rings at y = ±H_BAND_HALF_HEIGHT
  const basePos = edges.getAttribute("position").array as Float32Array;
  const hx = 0.5, hz = 0.5;
  const o = 0.002; // tiny offset so lines render in front of coplanar faces
  const bandEdges: number[] = [];
  for (const by of [H_BAND_HALF_HEIGHT, -H_BAND_HALF_HEIGHT]) {
    bandEdges.push(-hx - o, by, -hz - o,  hx + o, by, -hz - o); // -Z wall
    bandEdges.push( hx + o, by, -hz - o,  hx + o, by,  hz + o); // +X wall
    bandEdges.push( hx + o, by,  hz + o, -hx - o, by,  hz + o); // +Z wall
    bandEdges.push(-hx - o, by,  hz + o, -hx - o, by, -hz - o); // -X wall
  }

  const merged = new Float32Array(basePos.length + bandEdges.length);
  merged.set(basePos);
  merged.set(new Float32Array(bandEdges), basePos.length);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(merged, 3));
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
 * YHalfCube is half-height in Z, so its Y center is at pos.z + 0.25.
 */
export function tqecToThree(pos: Position3D, blockType?: BlockType): [number, number, number] {
  const h = blockType ? blockHeight(blockType) : 1;
  return [pos.x + 0.5, pos.z + h / 2, -(pos.y + 0.5)];
}

/** TQEC Z-height for each block type. */
export function blockHeight(blockType: BlockType): number {
  switch (blockType) {
    case "Y": return 0.5;
    case "ZXO": case "XZO": case "ZXOH": case "XZOH": return 2;
    default: return 1;
  }
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
