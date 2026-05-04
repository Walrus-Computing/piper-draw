import type { Intersection, Object3D } from "three";

/**
 * GridPlane should bow out of clicks/hovers when the ray also hits another
 * interactive mesh further along (a block or port ghost). The invisible plane
 * at Three.js y=0 sits between the camera and other geometry in two scenarios:
 *
 *   1. Camera tilted down + sub-ground block (TQEC z<0): plane is at y=0,
 *      block lives at y<0, plane raycast wins. Pass-through lets the buried
 *      block be selected/operated on from above.
 *   2. Camera below the floor + above-floor block: plane's back face raycasts
 *      closer than the model. Pass-through lets edit-mode placement do
 *      face-adjacent placement on the model and Build-mode click move the
 *      cursor to the clicked cube.
 *
 * Returns true if any intersection's object is not the plane itself, meaning
 * the next handler in the chain should own the event.
 *
 * Relies on the project convention that decorative meshes use raycast={noRaycast}
 * so e.intersections only contains actually-clickable meshes.
 */
export function shouldPassThroughGridPlane(
  intersections: ReadonlyArray<Pick<Intersection, "object">>,
  planeMesh: Object3D | null,
): boolean {
  if (!planeMesh) return false;
  return intersections.some((i) => i.object !== planeMesh);
}
