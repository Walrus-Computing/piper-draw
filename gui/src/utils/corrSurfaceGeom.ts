import {
  blockThreeSize,
  H_BAND_HALF_HEIGHT,
  TQEC_TO_THREE_AXIS,
  isPipeType,
  tqecToThree,
} from "../types";
import type { Block } from "../types";

export type Strip = "band" | "below" | "above" | null;

/**
 * Emit a TQEC-style internal correlation-surface quad: a flat rectangle in
 * the plane perpendicular to the clicked face's normal axis, at the block's
 * centerline along that axis.
 *
 * This matches what /api/flows returns from the TQEC
 * `CorrelationSurfaceTransformationHelper` (see `_quad_vertices_three` in
 * server.py). For an OZX pipe at TQEC (1,0,0), an X-basis surface is at
 * Three.js z=-0.5 spanning the full pipe length — NOT a quad on the outside
 * +Z face.
 *
 * For Hadamard / Y-twist pipes, the lengthwise extent (along the open axis)
 * is clipped to the clicked strip:
 *   - `:below` → [pipe-start, geometric-center]
 *   - `:above` → [geometric-center, pipe-end]
 *   - `:band`  → a thin sliver at the center (TQEC has no band surface; this
 *               is a visual nudge for click-on-band).
 * TQEC splits exactly at the geometric center; the band's `H_BAND_HALF_HEIGHT`
 * width is a paint convention only.
 *
 * Appends 4 vertices (flattened as 12 floats) to `positions`. Caller
 * indexes them as two triangles (0,1,2 and 0,2,3) per quad.
 */
export function emitSliceQuad(
  positions: number[],
  block: Block,
  faceIdx: 0 | 1 | 2 | 3 | 4 | 5,
  strip: Strip,
): void {
  const [cx, cy, cz] = tqecToThree(block.pos, block.type);
  const [sx, sy, sz] = blockThreeSize(block.type);
  const halves: [number, number, number] = [sx / 2, sy / 2, sz / 2];

  // Slice axis = the axis the clicked face is perpendicular to.
  // Faces 0/1 → axis 0 (Three.js X); 2/3 → axis 1 (Y); 4/5 → axis 2 (Z).
  const sliceAxis: 0 | 1 | 2 = (faceIdx >> 1) as 0 | 1 | 2;

  // Open axis (for pipes) is the lengthwise direction. For H/Y-twist pipes,
  // the strip subdivision is along this axis.
  let openAxis: 0 | 1 | 2 | -1 = -1;
  let isColourFlip = false;
  if (isPipeType(block.type)) {
    const base = block.type.length > 3 ? block.type.slice(0, 3) : block.type;
    const tqecOpen = base.indexOf("O") as 0 | 1 | 2;
    openAxis = TQEC_TO_THREE_AXIS[tqecOpen] as 0 | 1 | 2;
    isColourFlip = block.type.endsWith("H")
      || (block.type.endsWith("Y") && block.type.length === 4);
  }

  const lo: [number, number, number] = [-halves[0], -halves[1], -halves[2]];
  const hi: [number, number, number] = [halves[0], halves[1], halves[2]];

  // Pin the slice axis to the centerline (the slice is a 2D plane at z=cz_etc).
  lo[sliceAxis] = 0;
  hi[sliceAxis] = 0;

  if (isColourFlip && openAxis !== -1 && strip !== null) {
    if (strip === "below") {
      hi[openAxis] = 0;
    } else if (strip === "above") {
      lo[openAxis] = 0;
    } else {
      // Band sliver at center
      lo[openAxis] = -H_BAND_HALF_HEIGHT;
      hi[openAxis] = H_BAND_HALF_HEIGHT;
    }
  }

  // Pick the two non-slice axes and emit a CCW rectangle.
  const a = sliceAxis === 0 ? 1 : 0;
  const b = sliceAxis === 2 ? 1 : 2;
  const aValues = [lo[a], hi[a], hi[a], lo[a]] as const;
  const bValues = [lo[b], lo[b], hi[b], hi[b]] as const;
  const center: [number, number, number] = [cx, cy, cz];
  for (let i = 0; i < 4; i++) {
    const v: [number, number, number] = [0, 0, 0];
    v[a] = aValues[i];
    v[b] = bValues[i];
    positions.push(center[0] + v[0], center[1] + v[1], center[2] + v[2]);
  }
}

/**
 * Parse a `faceCorrSurface` key (e.g., "0", "5", "2:band") into a
 * `(faceIdx, strip)` pair. Returns null on unparseable keys (caller skips).
 */
export function parseFaceKey(key: string): { faceIdx: 0 | 1 | 2 | 3 | 4 | 5; strip: Strip } | null {
  const colon = key.indexOf(":");
  const idx = Number(colon === -1 ? key : key.slice(0, colon));
  if (!Number.isInteger(idx) || idx < 0 || idx > 5) return null;
  const stripRaw = colon === -1 ? null : key.slice(colon + 1);
  const strip: Strip = stripRaw === "band" || stripRaw === "below" || stripRaw === "above"
    ? stripRaw
    : null;
  return { faceIdx: idx as 0 | 1 | 2 | 3 | 4 | 5, strip };
}
