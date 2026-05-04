import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import type { Block } from "../types";
import {
  deriveSliceKey,
  emitSliceQuad,
  faceIndexToSliceAxis,
  migrateFaceKeysToAxisKeys,
  parseSliceKey,
} from "./corrSurfaceGeom";

/**
 * Compare two emitted quads (12 floats each). Vertex ordering may differ but
 * the unordered set of corners must match.
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

describe("parseSliceKey", () => {
  it("parses bare axis indices", () => {
    expect(parseSliceKey("0")).toEqual({ axis: 0, strip: null });
    expect(parseSliceKey("1")).toEqual({ axis: 1, strip: null });
    expect(parseSliceKey("2")).toEqual({ axis: 2, strip: null });
  });

  it("parses sub-strip keys", () => {
    expect(parseSliceKey("0:band")).toEqual({ axis: 0, strip: "band" });
    expect(parseSliceKey("1:below")).toEqual({ axis: 1, strip: "below" });
    expect(parseSliceKey("2:above")).toEqual({ axis: 2, strip: "above" });
  });

  it("strict-rejects out-of-range axes (axis must be 0/1/2)", () => {
    expect(parseSliceKey("3")).toBeNull();
    expect(parseSliceKey("5")).toBeNull();
    expect(parseSliceKey("-1")).toBeNull();
    expect(parseSliceKey("garbage")).toBeNull();
  });

  it("strict-rejects unknown strip suffixes (paint accepts these; corr does not)", () => {
    expect(parseSliceKey("0:foo")).toBeNull();
    expect(parseSliceKey("1:")).toBeNull();
  });
});

describe("faceIndexToSliceAxis", () => {
  it("collapses opposing face indices to one axis", () => {
    expect(faceIndexToSliceAxis(0)).toBe(0);
    expect(faceIndexToSliceAxis(1)).toBe(0);
    expect(faceIndexToSliceAxis(2)).toBe(1);
    expect(faceIndexToSliceAxis(3)).toBe(1);
    expect(faceIndexToSliceAxis(4)).toBe(2);
    expect(faceIndexToSliceAxis(5)).toBe(2);
  });
});

describe("migrateFaceKeysToAxisKeys (legacy translator)", () => {
  it("migrates simple face-keys to axis-keys", () => {
    const legacy = { "0": "X" as const, "5": "Z" as const };
    expect(migrateFaceKeysToAxisKeys(legacy)).toEqual({ "0": "X", "2": "Z" });
  });

  it("dedupes opposing faces (last entry wins)", () => {
    // face 2 and face 3 both → axis 1; second entry overwrites the first.
    const legacy = { "2": "X" as const, "3": "Z" as const };
    expect(migrateFaceKeysToAxisKeys(legacy)).toEqual({ "1": "Z" });
  });

  it("preserves Hadamard / Y-twist strip suffixes", () => {
    const legacy = {
      "2:band": "X" as const,
      "2:below": "Z" as const,
      "4:above": "X" as const,
    };
    expect(migrateFaceKeysToAxisKeys(legacy)).toEqual({
      "1:band": "X",
      "1:below": "Z",
      "2:above": "X",
    });
  });

  it("drops malformed face indices", () => {
    const legacy = { "9": "X" as const, "0": "Z" as const };
    expect(migrateFaceKeysToAxisKeys(legacy)).toEqual({ "0": "Z" });
  });

  it("drops malformed strip suffixes", () => {
    const legacy = { "0:foo": "X" as const, "1": "Z" as const };
    expect(migrateFaceKeysToAxisKeys(legacy)).toEqual({ "0": "Z" });
  });

  it("returns undefined when input has no valid entries", () => {
    expect(migrateFaceKeysToAxisKeys({})).toBeUndefined();
    expect(migrateFaceKeysToAxisKeys({ "9": "X" as const })).toBeUndefined();
  });
});

describe("emitSliceQuad — TQEC parity (axis-keyed input)", () => {
  // Reference scene: OZX pipe at TQEC (1,0,0). Three.js center (2, 0.5, -0.5),
  // half-extents (1, 0.5, 0.5). Open axis is Three.js X (axis 0).
  const ozxPipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZX" };

  it("axis 2 (Z-perpendicular) on OZX → TQEC's X-basis surface", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxPipe, 2, null);
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

  it("axis 1 (Y-perpendicular) on OZX → TQEC's Z-basis surface", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxPipe, 1, null);
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
  // OZXH at TQEC (1,0,0) — same dims as OZX. TQEC splits surface lengthwise
  // at the geometric center (Three.js x=2, no band-width gap).
  const ozxhPipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZXH" };

  it(":below clips axis 2 slice to [pipe-start, center]", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxhPipe, 2, "below");
    const tqecRef = [
      1, 0, -0.5,
      2, 0, -0.5,
      2, 1, -0.5,
      1, 1, -0.5,
    ];
    expect(sameQuad(positions, tqecRef)).toBe(true);
  });

  it(":above clips axis 2 slice to [center, pipe-end]", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxhPipe, 2, "above");
    const tqecRef = [
      2, 0, -0.5,
      3, 0, -0.5,
      3, 1, -0.5,
      2, 1, -0.5,
    ];
    expect(sameQuad(positions, tqecRef)).toBe(true);
  });

  it(":band emits a thin sliver at the center (no real TQEC surface)", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxhPipe, 2, "band");
    expect(positions[0]).toBeCloseTo(1.92, 5);
    expect(positions[3]).toBeCloseTo(2.08, 5);
    for (let i = 0; i < 4; i++) {
      expect(positions[i * 3 + 2]).toBeCloseTo(-0.5, 5);
    }
  });
});

describe("emitSliceQuad — cube and slab", () => {
  it("cube axis 0 (X-perpendicular) at center", () => {
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

  it("slab axis 1 (Y-perpendicular) — 2x2 slice at slab center", () => {
    const slab: Block = { pos: { x: 1, y: 1, z: 0 }, type: "slab" };
    // Slab at TQEC (1,1,0) is 2x2x1 → Three.js center (2, 0.5, -2),
    // half-extents [1, 0.5, 1]. Axis 1 → plane y=0.5. Spans x: 1→3, z: -1→-3.
    const positions: number[] = [];
    emitSliceQuad(positions, slab, 1, null);
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
  const ozxyPipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZXY" };

  it(":below clips at the geometric center (no band-width gap)", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxyPipe, 2, "below");
    const expected = [
      1, 0, -0.5,
      2, 0, -0.5,
      2, 1, -0.5,
      1, 1, -0.5,
    ];
    expect(sameQuad(positions, expected)).toBe(true);
  });

  it(":above clips at the geometric center", () => {
    const positions: number[] = [];
    emitSliceQuad(positions, ozxyPipe, 2, "above");
    const expected = [
      2, 0, -0.5,
      3, 0, -0.5,
      3, 1, -0.5,
      2, 1, -0.5,
    ];
    expect(sameQuad(positions, expected)).toBe(true);
  });
});

describe("deriveSliceKey", () => {
  // OZX pipe at TQEC (1,0,0). Three.js center (2, 0.5, -0.5).
  const ozxPipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZX" };

  it("clicking either +Y or -Y of a pipe produces the same axis-key '1'", () => {
    const yPlus = deriveSliceKey(ozxPipe, new Vector3(0, 1, 0), new Vector3(2, 1.0, -0.5));
    const yMinus = deriveSliceKey(ozxPipe, new Vector3(0, -1, 0), new Vector3(2, 0.0, -0.5));
    expect(yPlus).toBe("1");
    expect(yMinus).toBe("1");
  });

  it("clicking either +Z or -Z of a pipe produces axis-key '2'", () => {
    const zPlus = deriveSliceKey(ozxPipe, new Vector3(0, 0, 1), new Vector3(2, 0.5, 0));
    const zMinus = deriveSliceKey(ozxPipe, new Vector3(0, 0, -1), new Vector3(2, 0.5, -1));
    expect(zPlus).toBe("2");
    expect(zMinus).toBe("2");
  });

  it("clicking the open-axis end face of a pipe returns null (no slice exists)", () => {
    const plusX = deriveSliceKey(ozxPipe, new Vector3(1, 0, 0), new Vector3(3, 0.5, -0.5));
    const minusX = deriveSliceKey(ozxPipe, new Vector3(-1, 0, 0), new Vector3(1, 0.5, -0.5));
    expect(plusX).toBeNull();
    expect(minusX).toBeNull();
  });

  it("cube wall click → axis-key with no strip", () => {
    const cube: Block = { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" };
    expect(deriveSliceKey(cube, new Vector3(1, 0, 0), new Vector3(1, 0.5, -0.5))).toBe("0");
    expect(deriveSliceKey(cube, new Vector3(0, 1, 0), new Vector3(0.5, 1, -0.5))).toBe("1");
  });

  it("Hadamard pipe click derives :band/:below/:above axis-key", () => {
    const ozxh: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZXH" };
    // +Y wall, click at center → band
    expect(deriveSliceKey(ozxh, new Vector3(0, 1, 0), new Vector3(2.0, 1.0, -0.5))).toBe("1:band");
    // +Y wall, click far below band
    expect(deriveSliceKey(ozxh, new Vector3(0, 1, 0), new Vector3(1.1, 1.0, -0.5))).toBe("1:below");
    // +Y wall, click far above band
    expect(deriveSliceKey(ozxh, new Vector3(0, 1, 0), new Vector3(2.9, 1.0, -0.5))).toBe("1:above");
  });

  it("Y-twist pipe splits at center (below/above only, no band)", () => {
    const ozxy: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZXY" };
    expect(deriveSliceKey(ozxy, new Vector3(0, 1, 0), new Vector3(1.5, 1.0, -0.5))).toBe("1:below");
    expect(deriveSliceKey(ozxy, new Vector3(0, 1, 0), new Vector3(2.5, 1.0, -0.5))).toBe("1:above");
  });
});
