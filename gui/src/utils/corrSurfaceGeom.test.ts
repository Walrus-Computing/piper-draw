import { describe, expect, it } from "vitest";
import type { Block } from "../types";
import { emitSliceQuad, parseFaceKey } from "./corrSurfaceGeom";

/**
 * Compare my emitted quad against a reference TQEC quad (12 floats).
 * Both quads describe the same flat rectangle, but their corner orderings
 * may differ. We compare by the set of corners (treating each as a string).
 */
function sameQuad(a: number[], b: number[]): boolean {
  if (a.length !== 12 || b.length !== 12) return false;
  const pts = (xs: number[]) =>
    [0, 1, 2, 3]
      .map((i) => `${xs[i * 3].toFixed(4)},${xs[i * 3 + 1].toFixed(4)},${xs[i * 3 + 2].toFixed(4)}`)
      .sort()
      .join("|");
  return pts(a) === pts(b);
}

describe("parseFaceKey", () => {
  it("parses simple face indices", () => {
    expect(parseFaceKey("0")).toEqual({ faceIdx: 0, strip: null });
    expect(parseFaceKey("5")).toEqual({ faceIdx: 5, strip: null });
  });

  it("parses sub-strip keys", () => {
    expect(parseFaceKey("2:band")).toEqual({ faceIdx: 2, strip: "band" });
    expect(parseFaceKey("3:below")).toEqual({ faceIdx: 3, strip: "below" });
    expect(parseFaceKey("4:above")).toEqual({ faceIdx: 4, strip: "above" });
  });

  it("rejects malformed keys", () => {
    expect(parseFaceKey("garbage")).toBeNull();
    expect(parseFaceKey("9")).toBeNull();
    expect(parseFaceKey("-1")).toBeNull();
  });

  it("treats unknown strip suffix as null (renders full extent)", () => {
    expect(parseFaceKey("2:foo")).toEqual({ faceIdx: 2, strip: null });
  });
});

describe("emitSliceQuad — TQEC parity", () => {
  // Reference scene: OZX pipe at TQEC (1,0,0). Three.js center (2, 0.5, -0.5),
  // half-extents (1, 0.5, 0.5). Open axis is Three.js X.
  // Click on +Z face (faceIdx 4) should produce the X-basis surface that
  // TQEC's /api/flows returns.
  const ozxPipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZX" };

  it("matches TQEC's X-basis surface for OZX (+Z face click → constant-Z slice)", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxPipe, 4, null);
    // TQEC reference (verified via /api/flows POST):
    //   [1, 0, -0.5], [3, 0, -0.5], [3, 1, -0.5], [1, 1, -0.5]
    // Plane z=-0.5 (centerline of Three.js Z), full pipe length 1→3, full y 0→1.
    const tqecRef = [
      1, 0, -0.5,
      3, 0, -0.5,
      3, 1, -0.5,
      1, 1, -0.5,
    ];
    expect(sameQuad(positions, tqecRef)).toBe(true);
  });

  it("face 5 (-Z) on OZX produces the same Z-axis slice as face 4 (+Z)", () => {
    const a: number[] = [];
    const b: number[] = [];
    emitSliceQuad(a, ozxPipe, 4, null);
    emitSliceQuad(b, ozxPipe, 5, null);
    expect(sameQuad(a, b)).toBe(true);
  });

  it("matches TQEC's Z-basis surface for OZX (+Y face click → constant-Y slice)", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxPipe, 2, null);
    // TQEC reference: [1, 0.5, 0], [3, 0.5, 0], [3, 0.5, -1], [1, 0.5, -1]
    const tqecRef = [
      1, 0.5, 0,
      3, 0.5, 0,
      3, 0.5, -1,
      1, 0.5, -1,
    ];
    expect(sameQuad(positions, tqecRef)).toBe(true);
  });
});

describe("emitSliceQuad — Hadamard pipe sub-strip clipping", () => {
  // Hadamard pipe OZXH at TQEC (1,0,0). Same dimensions as OZX, but TQEC
  // splits the surface lengthwise at the center: below half is one basis,
  // above half is the other. Verified via /api/flows.
  const ozxhPipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZXH" };

  it("clicking +Z face with :below clips to [pipe-start, center]", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxhPipe, 4, "below");
    // TQEC reference for OZXH below-half X-basis:
    //   [1, 0, -0.5], [2, 0, -0.5], [2, 1, -0.5], [1, 1, -0.5]
    const tqecRef = [
      1, 0, -0.5,
      2, 0, -0.5,
      2, 1, -0.5,
      1, 1, -0.5,
    ];
    expect(sameQuad(positions, tqecRef)).toBe(true);
  });

  it("clicking +Z face with :above clips to [center, pipe-end]", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxhPipe, 4, "above");
    // TQEC reference for OZXH above-half Z-basis:
    //   [2, 0, -0.5], [3, 0, -0.5], [3, 1, -0.5], [2, 1, -0.5]
    const tqecRef = [
      2, 0, -0.5,
      3, 0, -0.5,
      3, 1, -0.5,
      2, 1, -0.5,
    ];
    expect(sameQuad(positions, tqecRef)).toBe(true);
  });

  it(":band produces a thin sliver at center for visualisation", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxhPipe, 4, "band");
    // Expected: a sliver of width 2 * H_BAND_HALF_HEIGHT = 0.16 around x=2,
    // in plane z=-0.5. So vertices at x ≈ 1.92 and 2.08.
    expect(positions[0]).toBeCloseTo(1.92, 5);
    expect(positions[3]).toBeCloseTo(2.08, 5);
    // All vertices on z=-0.5
    for (let i = 0; i < 4; i++) {
      expect(positions[i * 3 + 2]).toBeCloseTo(-0.5, 5);
    }
  });
});

describe("emitSliceQuad — cube and slab", () => {
  it("cube (XZZ) +X face click produces a centerline slice perpendicular to X", () => {
    const cube: Block = { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" };
    const positions: number[] = [];
    emitSliceQuad(positions, cube, 0, null);
    // Cube center (0.5, 0.5, -0.5), half-extents (0.5, 0.5, 0.5).
    // Slice axis 0 → plane x=0.5. Spans y: 0→1, z: 0→-1.
    const expected = [
      0.5, 0, 0,
      0.5, 1, 0,
      0.5, 1, -1,
      0.5, 0, -1,
    ];
    expect(sameQuad(positions, expected)).toBe(true);
  });

  it("slab top face (+Y) produces a 2x2 slice through the slab's vertical center", () => {
    const slab: Block = { pos: { x: 1, y: 1, z: 0 }, type: "slab" };
    // Slab at TQEC (1,1,0) is 2x2x1 → Three.js center (2, 0.5, -2),
    // half-extents [1, 0.5, 1].
    const positions: number[] = [];
    emitSliceQuad(positions, slab, 2, null);
    // Slice axis 1 (Y) → plane y=0.5. Spans x: 1→3, z: -1→-3.
    const expected = [
      1, 0.5, -1,
      3, 0.5, -1,
      3, 0.5, -3,
      1, 0.5, -3,
    ];
    expect(sameQuad(positions, expected)).toBe(true);
  });
});

describe("emitSliceQuad — Y-twist pipe (no band gap)", () => {
  // Y-twist pipe OZXY at TQEC (1,0,0). deriveFaceKey produces only "below"
  // and "above" strips for Y-twist (no band, since the colour-flip seam is
  // the single point at center 0).
  const ozxyPipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZXY" };

  it(":below splits at geometric center exactly (matches Hadamard convention)", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxyPipe, 4, "below");
    // Below half: x ranges 1→2 (Three.js).
    const expected = [
      1, 0, -0.5,
      2, 0, -0.5,
      2, 1, -0.5,
      1, 1, -0.5,
    ];
    expect(sameQuad(positions, expected)).toBe(true);
  });

  it(":above produces the [center, end] half", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxyPipe, 4, "above");
    const expected = [
      2, 0, -0.5,
      3, 0, -0.5,
      3, 1, -0.5,
      2, 1, -0.5,
    ];
    expect(sameQuad(positions, expected)).toBe(true);
  });
});
