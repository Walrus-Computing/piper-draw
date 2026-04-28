import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { shouldPassThroughGridPlane } from "./gridPlanePassthrough";

const plane = new THREE.Mesh();
const block = new THREE.Mesh();
const port = new THREE.Mesh();
const hit = (o: THREE.Object3D) => ({ object: o });

describe("shouldPassThroughGridPlane", () => {
  it("returns false when intersections is empty", () => {
    expect(shouldPassThroughGridPlane([], plane)).toBe(false);
  });

  it("returns false when only the plane is hit", () => {
    expect(shouldPassThroughGridPlane([hit(plane)], plane)).toBe(false);
  });

  it("returns true when a block is hit beyond the plane", () => {
    expect(shouldPassThroughGridPlane([hit(plane), hit(block)], plane)).toBe(true);
  });

  it("returns true when a port ghost is hit beyond the plane", () => {
    expect(shouldPassThroughGridPlane([hit(plane), hit(port)], plane)).toBe(true);
  });

  it("returns false when planeMesh is null (e.g., pre-mount frame)", () => {
    expect(shouldPassThroughGridPlane([hit(block)], null)).toBe(false);
  });
});
