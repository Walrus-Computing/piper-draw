import * as THREE from "three";
import type { BuildDirection, IsoAxis, Position3D, ViewMode } from "../types";
import { axisIndex } from "../types";

const ISO_DISTANCE = 1000;
export const ISO_INITIAL_ZOOM = 30;

type IsoMode = Extract<ViewMode, { kind: "iso" }>;

/** Three.js position of orbit target for an iso view at the active slice. */
export function isoTargetThree(viewMode: IsoMode): THREE.Vector3 {
  const t: [number, number, number] = [0, 0, 0];
  t[axisIndex(viewMode.axis)] = viewMode.slice;
  return new THREE.Vector3(t[0], t[2], -t[1]);
}

/** Three.js camera position for an iso view (target + offset along depth axis). */
export function isoCameraThree(viewMode: IsoMode): THREE.Vector3 {
  return isoTargetThree(viewMode).add(isoCameraOffset(viewMode.axis));
}

function isoCameraOffset(axis: IsoAxis): THREE.Vector3 {
  if (axis === "x") return new THREE.Vector3(ISO_DISTANCE, 0, 0);
  if (axis === "y") return new THREE.Vector3(0, 0, ISO_DISTANCE);
  return new THREE.Vector3(0, ISO_DISTANCE, 0);
}

/** Camera up vector for an iso axis (Z stays vertical except when Z is the depth axis). */
export function isoUpThree(axis: IsoAxis): THREE.Vector3 {
  if (axis === "z") return new THREE.Vector3(0, 0, -1);
  return new THREE.Vector3(0, 1, 0);
}

/** Three.js plane perpendicular to the depth axis at the active slice. */
export function isoPickPlane(viewMode: IsoMode): THREE.Plane {
  if (viewMode.axis === "x") return new THREE.Plane(new THREE.Vector3(1, 0, 0), -viewMode.slice);
  if (viewMode.axis === "y") return new THREE.Plane(new THREE.Vector3(0, 0, -1), -viewMode.slice);
  return new THREE.Plane(new THREE.Vector3(0, 1, 0), -viewMode.slice);
}

/** Mesh transform for the slice grid plane: rotation matches the plane normal. */
export function isoGridMeshTransform(axis: IsoAxis): {
  rotation: [number, number, number];
} {
  // planeGeometry is in XY local plane (normal = +Z local). We rotate so local +Z aligns with the world plane normal.
  if (axis === "x") return { rotation: [0, Math.PI / 2, 0] };       // local +Z → world +X
  if (axis === "y") return { rotation: [0, 0, 0] };                  // local +Z → world +Z (matches y depth: plane normal = -Three Z; flip to +Z is fine for double-sided)
  return { rotation: [-Math.PI / 2, 0, 0] };                         // local +Z → world +Y (floor-like)
}

/**
 * Whether a TQEC position is part of the active slab (for dimming off-slab geometry).
 * Range is [slice-2, slice+3): cubes/in-plane pipes at depth=slice are in; depth-axis pipes
 * at depth=slice-2 (extending back to previous slab) and slice+1 (extending forward) are also
 * considered in, since they connect to the active-slab cube. Cubes in adjacent slabs (slice-3,
 * slice+3) and pipes further out (slice-5, slice+4) fall outside.
 */
export function posInActiveSlice(viewMode: ViewMode, pos: Position3D): boolean {
  if (viewMode.kind !== "iso") return true;
  const depth = viewMode.axis === "x" ? pos.x : viewMode.axis === "y" ? pos.y : pos.z;
  return depth >= viewMode.slice - 2 && depth < viewMode.slice + 3;
}

/**
 * Build-mode key → TQEC build direction in iso mode.
 *   W/S      → vertical in-plane axis (screen up/down)
 *   A/D      → horizontal in-plane axis (screen left/right)
 *   ArrowUp/ArrowDown → depth axis (out of / into screen, toward camera = up)
 *
 * Camera in iso mode is locked to a fixed orientation per axis (no rotation),
 * so the mapping doesn't need an azimuth — it's a static table per IsoAxis.
 */
export function isoBuildDirection(
  key: "w" | "a" | "s" | "d" | "arrowup" | "arrowdown",
  axis: IsoAxis,
): BuildDirection {
  // [horizontal+ , vertical+ , depth-out] in TQEC-axis units, where depth-out
  // points from the slice toward the camera (out of the screen).
  // Iso X: camera at +X, up = +Three Y = +TQEC Z, screen-right = +TQEC Y.
  // Iso Y: camera at -TQEC Y (Three +Z), up = +TQEC Z, screen-right = +TQEC X.
  // Iso Z: camera at +TQEC Z (Three +Y), up = +TQEC Y, screen-right = +TQEC X.
  const table: Record<IsoAxis, [BuildDirection, BuildDirection, BuildDirection]> = {
    x: [
      { tqecAxis: 1, sign:  1 }, // right = +Y
      { tqecAxis: 2, sign:  1 }, // up    = +Z
      { tqecAxis: 0, sign:  1 }, // out   = +X
    ],
    y: [
      { tqecAxis: 0, sign:  1 }, // right = +X
      { tqecAxis: 2, sign:  1 }, // up    = +Z
      { tqecAxis: 1, sign: -1 }, // out   = -Y (camera is at -Y)
    ],
    z: [
      { tqecAxis: 0, sign:  1 }, // right = +X
      { tqecAxis: 1, sign:  1 }, // up    = +Y
      { tqecAxis: 2, sign:  1 }, // out   = +Z
    ],
  };
  const [right, up, out] = table[axis];
  const flip = (d: BuildDirection): BuildDirection => ({
    tqecAxis: d.tqecAxis,
    sign: (d.sign * -1) as 1 | -1,
  });
  switch (key) {
    case "d": return right;
    case "a": return flip(right);
    case "w": return up;
    case "s": return flip(up);
    case "arrowup": return out;
    case "arrowdown": return flip(out);
  }
}

/** Snap a Three.js point on the active iso plane to a valid TQEC position. */
export function snapIsoPos(
  viewMode: IsoMode,
  planePoint: THREE.Vector3,
  forPipe: boolean,
  snapInPlane: (a: number, b: number, forPipe: boolean) => { a: number; b: number },
): Position3D {
  let rawA: number, rawB: number;
  let axisAIdx: 0 | 1 | 2, axisBIdx: 0 | 1 | 2;

  if (viewMode.axis === "x") {
    axisAIdx = 1; rawA = -planePoint.z;   // TQEC Y = -Three Z
    axisBIdx = 2; rawB = planePoint.y;    // TQEC Z =  Three Y
  } else if (viewMode.axis === "y") {
    axisAIdx = 0; rawA = planePoint.x;    // TQEC X =  Three X
    axisBIdx = 2; rawB = planePoint.y;    // TQEC Z =  Three Y
  } else {
    axisAIdx = 0; rawA = planePoint.x;    // TQEC X =  Three X
    axisBIdx = 1; rawB = -planePoint.z;   // TQEC Y = -Three Z
  }

  const { a, b } = snapInPlane(rawA, rawB, forPipe);
  const out: [number, number, number] = [0, 0, 0];
  out[axisIndex(viewMode.axis)] = viewMode.slice;
  out[axisAIdx] = a;
  out[axisBIdx] = b;
  return { x: out[0], y: out[1], z: out[2] };
}
