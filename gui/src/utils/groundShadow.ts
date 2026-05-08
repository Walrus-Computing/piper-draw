import { blockTqecSize, type BlockType, type Position3D } from "../types";

export const GROUND_EPSILON = 1e-4;
export const Y_OFFSET = 0.01;
export const ELEVATION_FALLOFF_FLOOR = 0.30;

// Match DragGhost's red palette for invalid:
//   shadow color #ff5555 (DragGhost mesh, gui/src/components/DragGhost.tsx:23)
//   line   color #ff0000 (DragGhost edges, gui/src/components/DragGhost.tsx:30)
export const VALID_MESH_OPACITY = 0.28;
export const INVALID_MESH_OPACITY = 0.30;
export const VALID_LINE_OPACITY = 0.22;
export const INVALID_LINE_OPACITY = 0.28;

export const VALID_SHADOW_COLOR = 0x000000;
export const INVALID_SHADOW_COLOR = 0xff5555;
export const VALID_LINE_COLOR = 0x000000;
export const INVALID_LINE_COLOR = 0xff0000;

/** True when the block is sufficiently above the ground to deserve a shadow. */
export function shouldRenderShadow(pos: Position3D): boolean {
  return pos.z > GROUND_EPSILON;
}

/**
 * Elevation falloff factor. Asymptotic, floored at ELEVATION_FALLOFF_FLOOR
 * so the shadow always remains visible even on very tall TQEC graphs.
 *  z=1  -> 1.00   (full)
 *  z=8  -> 0.64
 *  z=16 -> 0.45
 *  z=30 -> 0.30   (floor)
 */
export function elevationFactor(z: number): number {
  const raw = 1 / (1 + Math.max(0, z - 1) * 0.08);
  return Math.max(raw, ELEVATION_FALLOFF_FLOOR);
}

export interface ShadowVisuals {
  cx: number;
  cz: number;
  lineLen: number;
  meshOpacity: number;
  lineOpacity: number;
  meshColor: number;
  lineColor: number;
}

/**
 * Derive everything a GroundShadowAbsolute needs to render from inputs.
 *
 * Coordinate convention: TQEC pos.z is the block's bottom in three.js Y
 * (since tqecToThree maps TQEC Z -> three.js Y and adds sz/2 from the base).
 * The shadow's ground-plane center is offset by sx/2, sy/2 from pos in the
 * XZ plane (with TQEC Y negated to match three.js -Z).
 *
 * NOTE: caller is responsible for the shouldRenderShadow gate; this fn
 * computes visuals unconditionally so tests can exercise the math at z=0.
 */
export function shadowVisuals(
  pos: Position3D,
  blockType: BlockType,
  valid: boolean,
): ShadowVisuals {
  const [sx, sy] = blockTqecSize(blockType);
  // Valid shadows fade with elevation; invalid stays full strength so the
  // conflict signal remains legible at any height.
  const fade = valid ? elevationFactor(pos.z) : 1;
  return {
    cx: pos.x + sx / 2,
    cz: -(pos.y + sy / 2),
    lineLen: pos.z - Y_OFFSET,
    meshOpacity: (valid ? VALID_MESH_OPACITY : INVALID_MESH_OPACITY) * fade,
    lineOpacity: (valid ? VALID_LINE_OPACITY : INVALID_LINE_OPACITY) * fade,
    meshColor: valid ? VALID_SHADOW_COLOR : INVALID_SHADOW_COLOR,
    lineColor: valid ? VALID_LINE_COLOR : INVALID_LINE_COLOR,
  };
}
