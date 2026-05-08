import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { pointerGroundPoint } from "./groundPlane";

function makeCam(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  cam.position.set(0, 10, 0);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

describe("pointerGroundPoint", () => {
  it("hits the y=0 plane at screen center", () => {
    const cam = makeCam();
    const out = new THREE.Vector3();
    expect(pointerGroundPoint(cam, 0, 0, out)).toBe(true);
    expect(Math.abs(out.y)).toBeLessThan(1e-6);
  });

  it("respects a non-zero planeY", () => {
    const cam = makeCam();
    const out = new THREE.Vector3();
    expect(pointerGroundPoint(cam, 0, 0, out, 3)).toBe(true);
    expect(out.y).toBeCloseTo(3);
  });

  it("returns false when the ray is nearly parallel to the plane", () => {
    const sideCam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    sideCam.position.set(0, 0, 10);
    sideCam.lookAt(100, 0, 10);
    sideCam.updateMatrixWorld();
    const out = new THREE.Vector3();
    expect(pointerGroundPoint(sideCam, 0, 0, out)).toBe(false);
  });

  it("returns false when the intersection escapes the sanity box", () => {
    // Nearly-grazing ray from a high camera looking almost horizontally.
    // Hits the plane at |x|/|z| > 10000.
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1e9);
    cam.position.set(0, 1, 0);
    cam.lookAt(1e7, 0, 1e7);
    cam.updateMatrixWorld();
    const out = new THREE.Vector3();
    expect(pointerGroundPoint(cam, 0, 0, out)).toBe(false);
  });
});
