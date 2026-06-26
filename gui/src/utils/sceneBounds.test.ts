import { describe, expect, it } from "vitest";
import type { Block } from "../types";
import { autoFitCamera } from "./sceneBounds";

function block(x: number, y: number, z: number): Block {
  return { pos: { x, y, z }, type: "XZZ" };
}

describe("autoFitCamera", () => {
  it("centers the target on the scene's bounding box", () => {
    // Two cubes spanning TQEC x in [0,3]; Three center x ≈ 2.
    const cam = autoFitCamera([block(0, 0, 0), block(3, 0, 0)]);
    expect(cam.kind).toBe("persp");
    expect(cam.target[0]).toBeCloseTo(2, 1);
    // Camera sits away from the target (non-zero distance, finite).
    const d = Math.hypot(
      cam.position[0] - cam.target[0],
      cam.position[1] - cam.target[1],
      cam.position[2] - cam.target[2],
    );
    expect(d).toBeGreaterThan(0);
    expect(Number.isFinite(d)).toBe(true);
  });

  it("frames a larger scene from farther away", () => {
    const near = autoFitCamera([block(0, 0, 0), block(3, 0, 0)]);
    const far = autoFitCamera([block(0, 0, 0), block(30, 0, 0)]);
    const dist = (c: typeof near) =>
      Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]);
    expect(dist(far)).toBeGreaterThan(dist(near));
  });

  it("falls back to a finite framing of the origin for an empty scene", () => {
    const cam = autoFitCamera([]);
    expect(cam.target).toEqual([0, 0, 0]);
    expect(cam.position.every(Number.isFinite)).toBe(true);
  });

  it("pushes the far plane past the camera distance for extreme-coordinate scenes", () => {
    // Coords up to ±1e6 are valid per the scene validator; the far plane must
    // clear the camera distance + scene radius or the whole scene clips away.
    const cam = autoFitCamera([block(-1_000_000, 0, 0), block(1_000_000, 0, 0)]);
    const dist = Math.hypot(
      cam.position[0] - cam.target[0],
      cam.position[1] - cam.target[1],
      cam.position[2] - cam.target[2],
    );
    expect(cam.far).toBeGreaterThan(dist);
    expect(Number.isFinite(cam.far)).toBe(true);
  });
});
