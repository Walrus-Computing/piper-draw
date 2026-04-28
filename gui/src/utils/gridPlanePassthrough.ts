import type { Intersection, Object3D } from "three";

/**
 * In select mode, GridPlane should bow out of clicks/hovers when the ray also
 * hits another interactive mesh further along (a block or port ghost). Without
 * this, the invisible plane at Three.js y=0 swallows clicks meant for blocks
 * placed at TQEC z<0 (below the plane) when the camera looks down from above.
 *
 * Click chain (perspective, camera tilted down):
 *
 *   camera                  After fix:
 *     │                       plane sees a non-plane hit in e.intersections
 *     ▼                       → returns without stopProp/clearSelection
 *   [GridPlane y=0]           → BlockInstances.handleClick runs
 *     │                       → sub-ground block gets selected
 *     ▼
 *   [Block | Port]
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
