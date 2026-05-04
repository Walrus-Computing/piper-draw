import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { isFaceTargetingTool, shouldPassThroughGridPlane } from "./gridPlanePassthrough";
import type { ArmedTool } from "../stores/blockStore";

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

describe("isFaceTargetingTool", () => {
  // [REGRESSION] Adding a new face-targeting tool without listing it here causes
  // GridPlane to fall through to addBlock on empty-plane clicks — which placed
  // stray cubes when the corr-surface tool first shipped.
  const cases: Array<[ArmedTool, boolean]> = [
    ["pointer", false],
    ["cube", false],
    ["pipe", false],
    ["port", false],
    ["paste", false],
    ["slab", false],
    ["paint", true],
    ["corr-surface", true],
  ];
  for (const [tool, expected] of cases) {
    it(`${tool} → ${expected}`, () => {
      expect(isFaceTargetingTool(tool)).toBe(expected);
    });
  }
});
