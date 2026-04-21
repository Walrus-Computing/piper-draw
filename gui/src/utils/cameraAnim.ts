import * as THREE from "three";

const DEFAULT_DURATION_MS = 280;
const SNAP_EPSILON = 1e-4;

const activeAnimations = new WeakMap<object, number>();

export interface CameraAnimateOptions {
  duration?: number;
  onComplete?: () => void;
}

/**
 * Smoothly animate an OrbitControls target + its camera position to new values
 * using ease-out-quad. Cancels any in-flight animation for the same controls,
 * so rapid successive calls (e.g. holding a build key) chain cleanly.
 */
export function animateCamera(
  controls: { target: THREE.Vector3; object: THREE.Object3D; update: () => void },
  endTarget: THREE.Vector3,
  endPosition: THREE.Vector3,
  options: CameraAnimateOptions = {},
): void {
  const camera = controls.object as THREE.PerspectiveCamera;
  const startTarget = controls.target.clone();
  const startPos = camera.position.clone();

  const targetUnchanged = startTarget.distanceToSquared(endTarget) < SNAP_EPSILON;
  const posUnchanged = startPos.distanceToSquared(endPosition) < SNAP_EPSILON;
  if (targetUnchanged && posUnchanged) {
    options.onComplete?.();
    return;
  }

  const prev = activeAnimations.get(controls);
  if (prev !== undefined) cancelAnimationFrame(prev);

  const duration = options.duration ?? DEFAULT_DURATION_MS;
  const start = performance.now();

  const step = () => {
    const t = Math.min((performance.now() - start) / duration, 1);
    const ease = t * (2 - t); // ease-out quad
    controls.target.lerpVectors(startTarget, endTarget, ease);
    camera.position.lerpVectors(startPos, endPosition, ease);
    controls.update();
    if (t < 1) {
      activeAnimations.set(controls, requestAnimationFrame(step));
    } else {
      activeAnimations.delete(controls);
      options.onComplete?.();
    }
  };

  activeAnimations.set(controls, requestAnimationFrame(step));
}
