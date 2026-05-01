import {
  blockThreeSize,
  H_BAND_HALF_HEIGHT,
  TQEC_TO_THREE_AXIS,
  derivePipeStrip,
  faceIndexFromNormal,
  isPipeType,
  pipeOpenThreeAxis,
  tqecToThree,
} from "../types";
import type { Block } from "../types";
import type * as THREE from "three";

export type Strip = "band" | "below" | "above" | null;
export type SliceAxis = 0 | 1 | 2;

/**
 * Emit a TQEC-style internal correlation-surface quad: a flat rectangle in
 * the plane perpendicular to `sliceAxis`, at the block's centerline along
 * that axis.
 *
 * Matches what `/api/flows` returns from TQEC's
 * `CorrelationSurfaceTransformationHelper`. For an OZX pipe at TQEC (1,0,0),
 * an X-basis surface lies at Three.js z=-0.5 spanning the full pipe length —
 * NOT a quad on the outside +Z face.
 *
 * For Hadamard / Y-twist pipes, the lengthwise extent (along the OPEN axis)
 * is clipped to the strip:
 *   - `:below` → [pipe-start, geometric-center]
 *   - `:above` → [geometric-center, pipe-end]
 *   - `:band`  → a thin sliver at the center (TQEC has no band surface; this
 *               is a visual nudge for click-on-band).
 * TQEC splits exactly at the geometric center; the band's `H_BAND_HALF_HEIGHT`
 * width is a paint convention only.
 *
 * Appends 4 vertices (12 floats) to `positions`. Caller indexes them as two
 * triangles (0,1,2 and 0,2,3) per quad.
 */
export function emitSliceQuad(
  positions: number[],
  block: Block,
  sliceAxis: SliceAxis,
  strip: Strip,
): void {
  const [cx, cy, cz] = tqecToThree(block.pos, block.type);
  const [sx, sy, sz] = blockThreeSize(block.type);
  const halves: [number, number, number] = [sx / 2, sy / 2, sz / 2];

  // Open axis (for pipes) is the lengthwise direction. For H/Y-twist pipes,
  // the strip subdivision is along this axis (not the slice axis).
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

  // Pin the slice axis to the centerline (the slice is a 2D plane at the
  // block center along `sliceAxis`).
  lo[sliceAxis] = 0;
  hi[sliceAxis] = 0;

  // Apply strip clip on the open axis if this is a colour-flip pipe.
  if (isColourFlip && openAxis !== -1 && strip !== null) {
    if (strip === "below") {
      hi[openAxis] = 0;
    } else if (strip === "above") {
      lo[openAxis] = 0;
    } else {
      // Band sliver at center (TQEC has no real band surface).
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
 * Parse a `corrSurfaceMarks` axis-key (e.g. `"0"`, `"2:band"`) into its
 * components. Strict: axis must be 0/1/2; strip must be `band`/`below`/`above`
 * or absent. Returns `null` for any malformed input — callers (renderer,
 * store, sanitizer) skip rather than render garbage.
 */
export function parseSliceKey(key: string): { axis: SliceAxis; strip: Strip } | null {
  const colon = key.indexOf(":");
  const axisStr = colon === -1 ? key : key.slice(0, colon);
  const axis = Number(axisStr);
  if (!Number.isInteger(axis) || axis < 0 || axis > 2) return null;
  if (colon === -1) return { axis: axis as SliceAxis, strip: null };
  const strip = key.slice(colon + 1);
  if (strip !== "band" && strip !== "below" && strip !== "above") return null;
  return { axis: axis as SliceAxis, strip };
}

/**
 * Map a face index (0–5) to its slice axis (0/1/2). Used by the click
 * handler to normalize "+Y vs -Y of the same pipe" to one canonical axis-key.
 *   faceIdx 0,1 → axis 0 (Three.js X)
 *   faceIdx 2,3 → axis 1 (Three.js Y)
 *   faceIdx 4,5 → axis 2 (Three.js Z)
 */
export function faceIndexToSliceAxis(faceIdx: 0 | 1 | 2 | 3 | 4 | 5): SliceAxis {
  return (faceIdx >> 1) as SliceAxis;
}

/**
 * Derive an axis-key for a corr-surface click on `block`. The slice axis is
 * the axis perpendicular to the clicked face's normal; +Y and -Y of the same
 * pipe both produce key `"1"`. For Hadamard / Y-twist pipes, the strip
 * (`below`/`band`/`above`) is appended. Returns `null` for clicks on a pipe's
 * open-axis end faces (no rendered geometry; no slice exists there).
 */
export function deriveSliceKey(
  block: Block,
  hitNormal: THREE.Vector3,
  hitPoint: THREE.Vector3,
): string | null {
  const faceIdx = faceIndexFromNormal(hitNormal);
  const open = pipeOpenThreeAxis(block);
  if (open !== null && (faceIdx >> 1) === open) return null;
  const sliceAxis = faceIndexToSliceAxis(faceIdx);
  const strip = derivePipeStrip(block, hitPoint);
  return strip === null ? String(sliceAxis) : `${sliceAxis}:${strip}`;
}

/**
 * Translate a legacy face-keyed `faceCorrSurface` payload into the new
 * axis-keyed `corrSurfaceMarks` shape. Used on snapshot load to migrate
 * scenes authored against the per-face schema.
 *
 * Dedupe rule: two face indices on the same axis (e.g. 2 and 3) collapse to
 * one axis-key; iteration order determines the winner (last write wins).
 * Strip suffixes (`:band|below|above`) are preserved.
 *
 * Returns `undefined` if the input is empty or all entries are malformed,
 * matching `sanitizeBlock`'s convention of dropping empty fields.
 */
export function migrateFaceKeysToAxisKeys(
  legacy: Record<string, "X" | "Z">,
): Record<string, "X" | "Z"> | undefined {
  const out: Record<string, "X" | "Z"> = {};
  for (const [faceKey, basis] of Object.entries(legacy)) {
    if (basis !== "X" && basis !== "Z") continue;
    const colon = faceKey.indexOf(":");
    const idxStr = colon === -1 ? faceKey : faceKey.slice(0, colon);
    const faceIdx = Number(idxStr);
    if (!Number.isInteger(faceIdx) || faceIdx < 0 || faceIdx > 5) continue;
    const sliceAxis = faceIdx >> 1;
    let stripPart = "";
    if (colon !== -1) {
      const strip = faceKey.slice(colon + 1);
      if (strip !== "band" && strip !== "below" && strip !== "above") continue;
      stripPart = `:${strip}`;
    }
    out[`${sliceAxis}${stripPart}`] = basis;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
