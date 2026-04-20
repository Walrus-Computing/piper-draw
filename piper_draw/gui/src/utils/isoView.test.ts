import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ISO_INITIAL_ZOOM,
  isoBuildDirection,
  isoCameraThree,
  isoGridMeshTransform,
  isoPickPlane,
  isoTargetThree,
  isoUpThree,
  posInActiveSlice,
  snapIsoPos,
} from "./isoView";

const iso = (axis: "x" | "y" | "z", slice: number) =>
  ({ kind: "iso" as const, axis, slice });

// JS `-0` is distinct from `0` under `Object.is` / vitest's `toEqual`.
// Our math occasionally produces `-(0)`, so normalize before comparing.
const noNegZero = (arr: number[]) =>
  arr.map((n) => (Object.is(n, -0) ? 0 : n));

describe("ISO_INITIAL_ZOOM", () => {
  it("is a positive number", () => {
    expect(ISO_INITIAL_ZOOM).toBeGreaterThan(0);
  });
});

describe("isoTargetThree", () => {
  it("maps the iso slice onto the Three.js axis for each axis mode", () => {
    // tqecToThree mapping: (x, y, z) -> (x, z, -y).
    expect(noNegZero(isoTargetThree(iso("x", 6)).toArray())).toEqual([6, 0, 0]);
    expect(noNegZero(isoTargetThree(iso("y", 6)).toArray())).toEqual([0, 0, -6]);
    expect(noNegZero(isoTargetThree(iso("z", 6)).toArray())).toEqual([0, 6, 0]);
  });
});

describe("isoCameraThree", () => {
  it("places the camera along the depth axis relative to the target", () => {
    const cx = isoCameraThree(iso("x", 0));
    expect(cx.x).toBeGreaterThan(0);
    expect(cx.y).toBe(0);
    expect(cx.z).toBe(0);

    const cy = isoCameraThree(iso("y", 0));
    expect(cy.x).toBe(0);
    expect(cy.y).toBe(0);
    expect(cy.z).toBeGreaterThan(0);

    const cz = isoCameraThree(iso("z", 0));
    expect(cz.x).toBe(0);
    expect(cz.y).toBeGreaterThan(0);
    expect(cz.z).toBe(0);
  });

  it("target-to-camera offset is independent of slice", () => {
    const d1 = isoCameraThree(iso("x", 0)).sub(isoTargetThree(iso("x", 0)));
    const d2 = isoCameraThree(iso("x", 9)).sub(isoTargetThree(iso("x", 9)));
    expect(d1.toArray()).toEqual(d2.toArray());
  });
});

describe("isoUpThree", () => {
  it("keeps Three Y as up for x and y iso views", () => {
    expect(isoUpThree("x").toArray()).toEqual([0, 1, 0]);
    expect(isoUpThree("y").toArray()).toEqual([0, 1, 0]);
  });

  it("uses -Three Z as up for the z (top-down) iso view", () => {
    expect(isoUpThree("z").toArray()).toEqual([0, 0, -1]);
  });
});

describe("isoPickPlane", () => {
  it("returns a plane perpendicular to the depth axis at the slice", () => {
    const px = isoPickPlane(iso("x", 3));
    expect(px.normal.toArray()).toEqual([1, 0, 0]);
    // Plane equation normal · p + constant = 0 → a point with x=3 should lie on it.
    expect(px.distanceToPoint(new THREE.Vector3(3, 10, 10))).toBeCloseTo(0);

    const pz = isoPickPlane(iso("z", 6));
    expect(pz.normal.toArray()).toEqual([0, 1, 0]);
    expect(pz.distanceToPoint(new THREE.Vector3(1, 6, 2))).toBeCloseTo(0);
  });
});

describe("isoGridMeshTransform", () => {
  it("returns distinct rotations for each axis", () => {
    const rx = isoGridMeshTransform("x").rotation;
    const ry = isoGridMeshTransform("y").rotation;
    const rz = isoGridMeshTransform("z").rotation;
    expect(rx).not.toEqual(ry);
    expect(ry).not.toEqual(rz);
    expect(rx).not.toEqual(rz);
  });
});

describe("posInActiveSlice", () => {
  it("returns true for any pos in perspective mode", () => {
    expect(posInActiveSlice({ kind: "persp" }, { x: 99, y: 99, z: 99 })).toBe(true);
  });

  it("includes pipes extending forward/backward from the cube", () => {
    // Slice 0: range is [slice-2, slice+3) → -2, -1, 0, 1, 2 are in; -3 and 3 are out.
    const vm = iso("x", 0);
    expect(posInActiveSlice(vm, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(posInActiveSlice(vm, { x: -2, y: 0, z: 0 })).toBe(true);
    expect(posInActiveSlice(vm, { x: 2, y: 0, z: 0 })).toBe(true);
  });

  it("excludes positions outside the slab", () => {
    const vm = iso("x", 0);
    expect(posInActiveSlice(vm, { x: -3, y: 0, z: 0 })).toBe(false);
    expect(posInActiveSlice(vm, { x: 3, y: 0, z: 0 })).toBe(false);
  });

  it("checks the correct coordinate for each axis", () => {
    // axis "y" slab gates on pos.y, "z" gates on pos.z.
    expect(posInActiveSlice(iso("y", 6), { x: 0, y: 6, z: 0 })).toBe(true);
    expect(posInActiveSlice(iso("y", 6), { x: 0, y: 0, z: 0 })).toBe(false);
    expect(posInActiveSlice(iso("z", 3), { x: 0, y: 0, z: 3 })).toBe(true);
    expect(posInActiveSlice(iso("z", 3), { x: 0, y: 0, z: 0 })).toBe(false);
  });
});

describe("isoBuildDirection", () => {
  it("a and d are opposites along the horizontal in-plane axis", () => {
    for (const axis of ["x", "y", "z"] as const) {
      const d = isoBuildDirection("d", axis);
      const a = isoBuildDirection("a", axis);
      expect(a.tqecAxis).toBe(d.tqecAxis);
      expect(a.sign).toBe((-d.sign) as 1 | -1);
    }
  });

  it("w and s are opposites along the vertical in-plane axis", () => {
    for (const axis of ["x", "y", "z"] as const) {
      const w = isoBuildDirection("w", axis);
      const s = isoBuildDirection("s", axis);
      expect(s.tqecAxis).toBe(w.tqecAxis);
      expect(s.sign).toBe((-w.sign) as 1 | -1);
    }
  });

  it("arrowup and arrowdown are opposites along the depth axis", () => {
    for (const axis of ["x", "y", "z"] as const) {
      const up = isoBuildDirection("arrowup", axis);
      const down = isoBuildDirection("arrowdown", axis);
      expect(down.tqecAxis).toBe(up.tqecAxis);
      expect(down.sign).toBe((-up.sign) as 1 | -1);
    }
  });

  it("depth axis points out of screen toward the camera", () => {
    // Camera in iso y is at -TQEC Y, so arrowup (out-of-screen) must be -Y.
    expect(isoBuildDirection("arrowup", "y")).toEqual({ tqecAxis: 1, sign: -1 });
    // Camera in iso x is at +TQEC X, so arrowup must be +X.
    expect(isoBuildDirection("arrowup", "x")).toEqual({ tqecAxis: 0, sign: 1 });
    // Camera in iso z is at +TQEC Z, so arrowup must be +Z.
    expect(isoBuildDirection("arrowup", "z")).toEqual({ tqecAxis: 2, sign: 1 });
  });

  it("in-plane WASD axes are orthogonal to the depth axis", () => {
    for (const axis of ["x", "y", "z"] as const) {
      const d = isoBuildDirection("d", axis);
      const w = isoBuildDirection("w", axis);
      const out = isoBuildDirection("arrowup", axis);
      const axes = new Set([d.tqecAxis, w.tqecAxis, out.tqecAxis]);
      expect(axes.size).toBe(3);
    }
  });
});

describe("snapIsoPos", () => {
  const identity = (a: number, b: number) => ({ a, b });

  it("keeps the depth coord at the slice and maps in-plane axes for iso x", () => {
    const p = new THREE.Vector3(999, 4, -2); // x ignored, y → TQEC z, -z → TQEC y
    const out = snapIsoPos(iso("x", 6), p, false, identity);
    expect(out).toEqual({ x: 6, y: 2, z: 4 });
  });

  it("maps in-plane axes for iso y", () => {
    const p = new THREE.Vector3(5, 4, 999);
    const out = snapIsoPos(iso("y", 9), p, false, identity);
    expect(out).toEqual({ x: 5, y: 9, z: 4 });
  });

  it("maps in-plane axes for iso z", () => {
    const p = new THREE.Vector3(5, 999, -7);
    const out = snapIsoPos(iso("z", 12), p, false, identity);
    expect(out).toEqual({ x: 5, y: 7, z: 12 });
  });

  it("passes forPipe through to the snapInPlane callback", () => {
    let receivedForPipe = false;
    snapIsoPos(iso("x", 0), new THREE.Vector3(), true, (a, b, forPipe) => {
      receivedForPipe = forPipe;
      return { a, b };
    });
    expect(receivedForPipe).toBe(true);
  });
});
