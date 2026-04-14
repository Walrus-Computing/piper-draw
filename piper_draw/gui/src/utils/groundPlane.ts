import * as THREE from "three";

const _raycaster = new THREE.Raycaster();
const _screenCenter = new THREE.Vector2(0, 0);
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Returns the point on the y=0 plane that the camera center is looking at. */
export function cameraGroundPoint(camera: THREE.Camera, out: THREE.Vector3): boolean {
  _raycaster.setFromCamera(_screenCenter, camera);
  return _raycaster.ray.intersectPlane(_groundPlane, out) !== null;
}
