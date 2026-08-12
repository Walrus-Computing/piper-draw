// Unit tests for bgraphResponseToBlocks — the helper that converts a
// /api/bgraph_import response into a piper-draw Block Map and applies
// sandwich-cube canonicalization (via daeImport's canonicaliseImportedCubes).

import { describe, expect, it } from "vitest";

import type { BgraphImportResponse } from "../types/bgraph";
import { bgraphResponseToBlocks } from "./bgraphImportToBlocks";

function makeResp(
  blocks: Array<{ pos: [number, number, number]; type: string }>,
  portLabels: Array<{ pos: [number, number, number]; label: string }> = [],
): BgraphImportResponse {
  return { blocks, port_labels: portLabels, mode: "load" };
}

describe("bgraphResponseToBlocks", () => {
  it("converts a single-cube response to a Block Map", () => {
    const result = bgraphResponseToBlocks(
      makeResp([{ pos: [0, 0, 0], type: "ZXZ" }]),
    );
    expect(result.blocks.size).toBe(1);
    const b = result.blocks.get("0,0,0")!;
    expect(b.type).toBe("ZXZ");
    expect(b.pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("converts port labels into Position3D objects", () => {
    const result = bgraphResponseToBlocks(
      makeResp(
        [{ pos: [0, 0, 0], type: "ZXZ" }],
        [{ pos: [3, 0, 0], label: "out" }],
      ),
    );
    expect(result.portLabels).toEqual([
      { pos: { x: 3, y: 0, z: 0 }, label: "out" },
    ]);
  });

  it("returns normalizedCount = 0 when no canonicalization is needed", () => {
    // Single isolated cube: no adjacent pipes → no normalization.
    const result = bgraphResponseToBlocks(
      makeResp([{ pos: [0, 0, 0], type: "XZX" }]),
    );
    expect(result.normalizedCount).toBe(0);
  });

  it("canonicalizes a sandwich cube and returns the count", () => {
    // Cube at (0,0,0) sandwiched between two X-axis pipes on either side.
    // Pipes at (1,0,0) and (-2,0,0). The cube's open axis is X — two valid
    // ZXCube options exist (XZZ vs XZX); first-in-CUBE_TYPES wins ("XZZ").
    // If the input declares "XZX", canonicalization should normalize to "XZZ".
    const result = bgraphResponseToBlocks(
      makeResp([
        // Left pipe: between cubes at (-3,0,0) and (0,0,0).
        { pos: [-2, 0, 0], type: "OZX" },
        // Sandwich cube — input type is the non-canonical XZX.
        { pos: [0, 0, 0], type: "XZX" },
        // Right pipe: between (0,0,0) and (3,0,0).
        { pos: [1, 0, 0], type: "OZX" },
        // Right cube to anchor the right pipe.
        { pos: [3, 0, 0], type: "ZXZ" },
        // Left cube to anchor the left pipe.
        { pos: [-3, 0, 0], type: "ZXZ" },
      ]),
    );
    // The middle cube should now be the first-CUBE_TYPES-order valid option,
    // not the original "XZX".
    expect(result.blocks.get("0,0,0")?.type).not.toBe("XZX");
    // And the normalizedCount should be >= 1.
    expect(result.normalizedCount).toBeGreaterThanOrEqual(1);
  });

  it("handles empty response gracefully", () => {
    const result = bgraphResponseToBlocks(makeResp([], []));
    expect(result.blocks.size).toBe(0);
    expect(result.portLabels).toHaveLength(0);
    expect(result.normalizedCount).toBe(0);
  });
});
