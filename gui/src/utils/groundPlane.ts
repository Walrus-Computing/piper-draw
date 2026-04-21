import * as THREE from "three";

const _raycaster = new THREE.Raycaster();
const _screenCenter = new THREE.Vector2(0, 0);
const _pointerNdc = new THREE.Vector2();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Returns the point on the y=0 plane that the camera center is looking at. */
export function cameraGroundPoint(camera: THREE.Camera, out: THREE.Vector3): boolean {
  _raycaster.setFromCamera(_screenCenter, camera);
  return _raycaster.ray.intersectPlane(_groundPlane, out) !== null;
}

/**
 * Raycast the pointer (given in NDC; ndcX, ndcY in [-1, 1]) onto a horizontal
 * plane at Three.js y = planeY (default 0). Fails when the ray is nearly
 * parallel to the plane (unstable) or escapes a sane world-space box.
 */
export function pointerGroundPoint(
  camera: THREE.Camera,
  ndcX: number,
  ndcY: number,
  out: THREE.Vector3,
  planeY = 0,
): boolean {
  _pointerNdc.set(ndcX, ndcY);
  _raycaster.setFromCamera(_pointerNdc, camera);
  if (Math.abs(_raycaster.ray.direction.y) < 0.05) return false;
  // Plane equation: normal·X + constant = 0, with normal = (0,1,0) means y + constant = 0 → constant = -planeY
  _dragPlane.set(_groundPlane.normal, -planeY);
  const hit = _raycaster.ray.intersectPlane(_dragPlane, out);
  if (!hit) return false;
  return Math.abs(out.x) < 10000 && Math.abs(out.z) < 10000;
}
