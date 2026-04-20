import { describe, expect, it } from "vitest";
import { X_COLOR, Z_COLOR } from "../types";
import {
  FOLD_ANGLE,
  colorForCubeFaceThreeAxis,
  faceOrientationEuler,
  foldRotationEuler,
  isoTopThreeAxis,
} from "./isoFoldOut";

describe("FOLD_ANGLE", () => {
  it("is a small positive angle (less than pi/2 so the side face never hits the top)", () => {
    expect(FOLD_ANGLE).toBeGreaterThan(0);
    expect(FOLD_ANGLE).toBeLessThan(Math.PI / 2);
  });
});

describe("isoTopThreeAxis", () => {
  it("maps each iso axis to the Three.js axis facing the camera", () => {
    // Iso x → camera along +X → top face = Three X.
    expect(isoTopThreeAxis("x")).toBe(0);
    // Iso z → camera along +Y (Three) → top face = Three Y.
    expect(isoTopThreeAxis("z")).toBe(1);
    // Iso y → camera along -Y (Three Z) → top face = Three Z.
    expect(isoTopThreeAxis("y")).toBe(2);
  });
});

describe("colorForCubeFaceThreeAxis", () => {
  it("reads the X/Z character from the block type at the matching TQEC axis", () => {
    // TQEC_AXIS_FOR_THREE = [0, 2, 1]. For "XZZ": x=X, y=Z, z=Z.
    // threeAxis 0 → tqec 0 → "X"
    // threeAxis 1 → tqec 2 → "Z"
    // threeAxis 2 → tqec 1 → "Z"
    expect(colorForCubeFaceThreeAxis("XZZ", 0)).toBe(X_COLOR);
    expect(colorForCubeFaceThreeAxis("XZZ", 1)).toBe(Z_COLOR);
    expect(colorForCubeFaceThreeAxis("XZZ", 2)).toBe(Z_COLOR);
  });

  it("resolves the other pattern correctly", () => {
    // ZXX → x=Z, y=X, z=X.
    // threeAxis 0 → tqec 0 → "Z"
    // threeAxis 1 → tqec 2 → "X"
    // threeAxis 2 → tqec 1 → "X"
    expect(colorForCubeFaceThreeAxis("ZXX", 0)).toBe(Z_COLOR);
    expect(colorForCubeFaceThreeAxis("ZXX", 1)).toBe(X_COLOR);
    expect(colorForCubeFaceThreeAxis("ZXX", 2)).toBe(X_COLOR);
  });
});

describe("faceOrientationEuler", () => {
  it("rotates about the correct axis for each face", () => {
    // axis 0 (±X normal) → rotate about Y.
    expect(faceOrientationEuler(0, 1)).toEqual([0, Math.PI / 2, 0]);
    expect(faceOrientationEuler(0, -1)).toEqual([0, -Math.PI / 2, 0]);
    // axis 1 (±Y normal) → rotate about X.
    expect(faceOrientationEuler(1, 1)).toEqual([-Math.PI / 2, 0, 0]);
    expect(faceOrientationEuler(1, -1)).toEqual([Math.PI / 2, 0, 0]);
    // axis 2 (±Z normal) → either identity or flip about Y.
    expect(faceOrientationEuler(2, 1)).toEqual([0, 0, 0]);
    expect(faceOrientationEuler(2, -1)).toEqual([0, Math.PI, 0]);
  });

  it("negative sign reverses the face direction for axis 0 and 1 (opposite-sign euler)", () => {
    const pos = faceOrientationEuler(0, 1);
    const neg = faceOrientationEuler(0, -1);
    expect(neg[1]).toBe(-pos[1]);
  });
});

describe("foldRotationEuler", () => {
  it("returns zero when sideAxis equals topAxis (degenerate, no fold axis)", () => {
    expect(foldRotationEuler(0, 1, 0, 0.5)).toEqual([0, 0, 0]);
  });

  it("produces a rotation about the third axis perpendicular to both side and top", () => {
    // side=+X (0), top=+Y (1): cross = (0,0,1) → fold about Z.
    expect(foldRotationEuler(0, 1, 1, 0.5)).toEqual([0, 0, 0.5]);
    // side=+Y, top=+X: cross = (0,0,-1) → fold about -Z.
    expect(foldRotationEuler(1, 1, 0, 0.5)).toEqual([0, 0, -0.5]);
    // side=+Z, top=+X: cross = (0,1,0) → fold about +Y.
    expect(foldRotationEuler(2, 1, 0, 0.5)).toEqual([0, 0.5, 0]);
  });

  it("negating sideSign negates the fold rotation", () => {
    const pos = foldRotationEuler(0, 1, 1, 0.5);
    const neg = foldRotationEuler(0, -1, 1, 0.5);
    // Use toBeCloseTo to avoid JS `-0` vs `0` strictness in toBe/toEqual.
    expect(neg[0]).toBeCloseTo(-pos[0]);
    expect(neg[1]).toBeCloseTo(-pos[1]);
    expect(neg[2]).toBeCloseTo(-pos[2]);
  });

  it("scales linearly with the angle", () => {
    const r1 = foldRotationEuler(0, 1, 1, 0.5);
    const r2 = foldRotationEuler(0, 1, 1, 1.0);
    expect(r2).toEqual([r1[0] * 2, r1[1] * 2, r1[2] * 2]);
  });
});
