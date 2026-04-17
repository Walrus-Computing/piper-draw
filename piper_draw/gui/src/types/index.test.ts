import { describe, expect, it } from "vitest";
import { createBlockGeometry, getHiddenFaceMaskForPos, FACE_NEG_Y, FACE_NEG_Z, FACE_POS_Y, FACE_POS_Z, isValidPipePos, isValidPos, isValidBlockPos, pipeAxisFromPos, resolvePipeType, getAdjacentPos, snapGroundPos, hasPipeColorConflict, hasCubeColorConflict, hasYCubePipeAxisConflict, wasdToBuildDirection } from "./index";
import type { PipeType, CubeType } from "./index";
import type { BlockType } from "./index";
import { Vector3 } from "three";

function makeBlocks(entries: Array<{ x: number; y: number; z: number; type: BlockType }>) {
  const blocks = new Map<string, { pos: { x: number; y: number; z: number }; type: BlockType }>();
  for (const entry of entries) {
    blocks.set(`${entry.x},${entry.y},${entry.z}`, {
      pos: { x: entry.x, y: entry.y, z: entry.z },
      type: entry.type,
    });
  }
  return blocks;
}

describe("getHiddenFaceMaskForPos", () => {
  it("hides the top face of a block when a pipe is directly on top", () => {
    const blocks = makeBlocks([
      { x: 0, y: 0, z: 0, type: "XZZ" },
      { x: 0, y: 0, z: 1, type: "OZX" },
    ]);

    expect(getHiddenFaceMaskForPos({ x: 0, y: 0, z: 0 }, "XZZ", blocks)).toBe(FACE_POS_Y);
    expect(getHiddenFaceMaskForPos({ x: 0, y: 0, z: 1 }, "OZX", blocks)).toBe(FACE_NEG_Y);
  });

  it("uses strict overlap checks (edge-only touch does not hide faces)", () => {
    const blocks = makeBlocks([
      { x: 0, y: 0, z: 0, type: "XZZ" },
      { x: 1, y: 1, z: 0, type: "XZZ" },
    ]);

    expect(getHiddenFaceMaskForPos({ x: 0, y: 0, z: 0 }, "XZZ", blocks)).toBe(0);
  });

  it("hides the correct TQEC-Y-side face", () => {
    const blocks = makeBlocks([
      { x: 0, y: 0, z: 0, type: "XZZ" },
      { x: 0, y: 1, z: 0, type: "XZZ" },
    ]);

    // Source cube should hide the -Z face when another block is at +Y.
    expect(getHiddenFaceMaskForPos({ x: 0, y: 0, z: 0 }, "XZZ", blocks)).toBe(FACE_NEG_Z);
  });

  it("hides multiple opposite faces for stacked and offset neighbors", () => {
    const blocks = makeBlocks([
      { x: 0, y: 0, z: 0, type: "XZZ" },
      { x: 0, y: -1, z: 0, type: "ZXO" },
      { x: 0, y: 0, z: -1, type: "OZX" },
    ]);

    expect(getHiddenFaceMaskForPos({ x: 0, y: 0, z: 0 }, "XZZ", blocks)).toBe(FACE_POS_Z | FACE_NEG_Y);
  });

  it("returns zero when a neighbor only overlaps in area but not on a face", () => {
    const blocks = makeBlocks([
      { x: 0, y: 0, z: 0, type: "XZZ" },
      { x: 2, y: 0, z: 0, type: "XZZ" },
    ]);

    expect(getHiddenFaceMaskForPos({ x: 0, y: 0, z: 0 }, "XZZ", blocks)).toBe(0);
  });
});

describe("pipe placement on negative coordinates", () => {
  it("accepts pipe slots in the negative direction", () => {
    expect(isValidPipePos({ x: -2, y: 0, z: 0 })).toBe(true);
    expect(isValidPipePos({ x: 0, y: 0, z: -2 })).toBe(true);
    expect(isValidPipePos({ x: 0, y: -2, z: 0 })).toBe(true);
    expect(isValidPipePos({ x: -1, y: 0, z: 0 })).toBe(false);
  });

  it("resolves pipe variant from a negative-toward face-adjacent position", () => {
    const negativeYNeighbor = getAdjacentPos({ x: 0, y: 0, z: 0 }, "XZZ", new Vector3(0, 0, 1), "ZOX");
    const positiveYNeighbor = getAdjacentPos({ x: 0, y: 0, z: 0 }, "XZZ", new Vector3(0, 0, -1), "ZOX");

    expect(negativeYNeighbor).toEqual({ x: 0, y: -2, z: 0 });
    expect(positiveYNeighbor).toEqual({ x: 0, y: 1, z: 0 });
    expect(isValidPipePos(negativeYNeighbor)).toBe(true);
    expect(isValidPipePos(positiveYNeighbor)).toBe(true);
    expect(pipeAxisFromPos(negativeYNeighbor)).toBe(1);
    expect(resolvePipeType("ZX", negativeYNeighbor)).toBe("ZOX");
  });

  it("snaps pipe placement on the negative side to the -2 slot", () => {
    expect(snapGroundPos(-0.2, 0.0, true)).toEqual({ x: 1, y: 0, z: 0 });
    expect(snapGroundPos(-1.6, 0.0, true)).toEqual({ x: -2, y: 0, z: 0 });
    expect(snapGroundPos(0.0, -0.2, true).x).toBe(1);
    expect(Math.abs(snapGroundPos(0.0, -0.2, true).y)).toBe(0);
    expect(snapGroundPos(0.0, -1.6, true)).toEqual({ x: 0, y: -2, z: 0 });
  });
});

describe("placement validation", () => {
  it("only treats true slot cells as valid pipe positions", () => {
    expect(isValidPipePos({ x: 1, y: 0, z: 0 })).toBe(true);
    expect(isValidPipePos({ x: -2, y: 0, z: 0 })).toBe(true);
    expect(isValidPipePos({ x: 0, y: 0, z: 2 })).toBe(false);
    expect(isValidPipePos({ x: 1, y: 1, z: 0 })).toBe(false);
    expect(isValidPipePos({ x: 0, y: 0, z: 0 })).toBe(false);
  });

  it("routes validation correctly by block type", () => {
    expect(isValidPos({ x: 1, y: 0, z: 0 }, "XZZ")).toBe(false);
    expect(isValidPos({ x: 1, y: 0, z: 0 }, "OZX")).toBe(true);
    expect(isValidBlockPos({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(isValidBlockPos({ x: 1, y: 0, z: 0 })).toBe(false);
  });
});

describe("pipe snapping and adjacency consistency", () => {
  it("chooses block-cell snapping when not placing pipe", () => {
    expect(snapGroundPos(-1.6, 0.0, false)).toEqual({ x: -3, y: 0, z: 0 });
    expect(snapGroundPos(2.1, 1.9, false)).toEqual({ x: 3, y: 3, z: 0 });
  });

  it("keeps adjacency results in valid slot positions for all canonical Y-neighbor faces", () => {
    const south = getAdjacentPos({ x: 0, y: 0, z: 0 }, "XZZ", new Vector3(0, 0, 1), "ZOX");
    const north = getAdjacentPos({ x: 0, y: 0, z: 0 }, "XZZ", new Vector3(0, 0, -1), "ZOX");

    const southSnap = snapGroundPos(south.x + 0.08, south.y + 0.08, true);
    const northSnap = snapGroundPos(north.x + 0.08, north.y + 0.08, true);

    expect(isValidPipePos(south)).toBe(true);
    expect(isValidPipePos(north)).toBe(true);
    expect(isValidPipePos(southSnap)).toBe(true);
    expect(isValidPipePos(northSnap)).toBe(true);
    expect(southSnap.x === south.x || southSnap.y === south.y).toBe(true);
    expect(northSnap.x === north.x || northSnap.y === north.y).toBe(true);
  });
});

describe("hasPipeColorConflict", () => {
  it("allows pipe when closed-axis colors match the adjacent cube", () => {
    // Pipe "OXZ" (open X): axis 1='X', axis 2='Z'
    // Cube "ZXZ": axis 1='X', axis 2='Z' → match
    const blocks = makeBlocks([{ x: 0, y: 0, z: 0, type: "ZXZ" }]);
    expect(hasPipeColorConflict("OXZ" as PipeType, { x: 1, y: 0, z: 0 }, blocks)).toBe(false);
  });

  it("rejects pipe when closed-axis colors don't match", () => {
    // Pipe "OZX" (open X): axis 1='Z', axis 2='X'
    // Cube "XZZ": axis 1='Z', axis 2='Z' → mismatch on axis 2
    const blocks = makeBlocks([{ x: 0, y: 0, z: 0, type: "XZZ" }]);
    expect(hasPipeColorConflict("OZX" as PipeType, { x: 1, y: 0, z: 0 }, blocks)).toBe(true);
  });

  it("allows pipe with no adjacent cubes", () => {
    const blocks = makeBlocks([]);
    expect(hasPipeColorConflict("OZX" as PipeType, { x: 1, y: 0, z: 0 }, blocks)).toBe(false);
  });

  it("skips Y-type neighbors", () => {
    const blocks = makeBlocks([{ x: 0, y: 0, z: 0, type: "Y" }]);
    expect(hasPipeColorConflict("OZX" as PipeType, { x: 1, y: 0, z: 0 }, blocks)).toBe(false);
  });

  it("checks both ends of the pipe", () => {
    // Pipe "ZOX" (open Y) at (0,1,0): start neighbor at (0,0,0), far neighbor at (0,3,0)
    // Both cubes must match axis 0='Z', axis 2='X'
    const blocks = makeBlocks([
      { x: 0, y: 0, z: 0, type: "ZZX" },
      { x: 0, y: 3, z: 0, type: "ZZX" },
    ]);
    expect(hasPipeColorConflict("ZOX" as PipeType, { x: 0, y: 1, z: 0 }, blocks)).toBe(false);
  });

  it("rejects when far-end cube doesn't match", () => {
    const blocks = makeBlocks([
      { x: 0, y: 0, z: 0, type: "ZZX" },  // matches
      { x: 0, y: 3, z: 0, type: "XZZ" },  // axis 0: 'X' vs 'Z' → mismatch
    ]);
    expect(hasPipeColorConflict("ZOX" as PipeType, { x: 0, y: 1, z: 0 }, blocks)).toBe(true);
  });
});

describe("hasPipeColorConflict — Hadamard", () => {
  it("uses swapped colors at the far end for X-open pipes", () => {
    // Pipe "OZXH" (open X): base "OZX", axis 1='Z', axis 2='X'
    // Far end (+2 offset, x=3): swapped → axis 1='X', axis 2='Z'
    // Cube at x=3 with axis 1='X', axis 2='Z' should match
    const blocks = makeBlocks([{ x: 3, y: 0, z: 0, type: "ZXZ" }]);
    expect(hasPipeColorConflict("OZXH" as PipeType, { x: 1, y: 0, z: 0 }, blocks)).toBe(false);
  });

  it("rejects far-end cube with unswapped colors for X-open Hadamard", () => {
    // Same pipe, but cube has original (unswapped) colors
    const blocks = makeBlocks([{ x: 3, y: 0, z: 0, type: "ZZX" }]);
    expect(hasPipeColorConflict("OZXH" as PipeType, { x: 1, y: 0, z: 0 }, blocks)).toBe(true);
  });

  it("allows Y-open Hadamard when start-end cube matches head colors", () => {
    // Pipe "XOZH" (open Y): base "XOZ", head at y=0 (not swapped): axis 0='X', axis 2='Z'
    // Cube "XZZ" at (0,0,0): axis 0='X', axis 2='Z' → match
    const blocks = makeBlocks([{ x: 0, y: 0, z: 0, type: "XZZ" }]);
    expect(hasPipeColorConflict("XOZH" as PipeType, { x: 0, y: 1, z: 0 }, blocks)).toBe(false);
  });

  it("rejects Y-open Hadamard when start-end cube doesn't match head colors", () => {
    // Pipe "XOZH" head at y=0 (not swapped): axis 0='X', axis 2='Z'
    // Cube "ZZX" at (0,0,0): axis 0='Z' → mismatch
    const blocks = makeBlocks([{ x: 0, y: 0, z: 0, type: "ZZX" }]);
    expect(hasPipeColorConflict("XOZH" as PipeType, { x: 0, y: 1, z: 0 }, blocks)).toBe(true);
  });

  it("uses swapped colors at far end for Y-open Hadamard", () => {
    // Pipe "XOZH" far end (y=3, swapped): axis 0='Z', axis 2='X'
    // Cube "ZZX" at (0,3,0): axis 0='Z', axis 2='X' → match
    const blocks = makeBlocks([{ x: 0, y: 3, z: 0, type: "ZZX" }]);
    expect(hasPipeColorConflict("XOZH" as PipeType, { x: 0, y: 1, z: 0 }, blocks)).toBe(false);
  });
});

describe("hasCubeColorConflict", () => {
  it("allows cube when adjacent pipe colors match", () => {
    // Pipe "OXZ" at (1,0,0): axis 1='X', axis 2='Z'
    // Cube "ZXZ": axis 1='X', axis 2='Z' → match
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OXZ" as BlockType }]);
    expect(hasCubeColorConflict("ZXZ" as CubeType, { x: 0, y: 0, z: 0 }, blocks)).toBe(false);
  });

  it("rejects cube when adjacent pipe colors don't match", () => {
    // Pipe "OZX" at (1,0,0): axis 1='Z', axis 2='X'
    // Cube "XZZ": axis 1='Z' ✓, axis 2='Z' vs pipe 'X' → mismatch
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OZX" as BlockType }]);
    expect(hasCubeColorConflict("XZZ" as CubeType, { x: 0, y: 0, z: 0 }, blocks)).toBe(true);
  });

  it("rejects cube when pipe on the -2 side doesn't match", () => {
    // Pipe "OZX" at (-2,0,0) (open X): far end faces cube at (0,0,0)
    // axis 1='Z', axis 2='X'. Cube "XZZ": axis 1='Z' ✓, axis 2='Z' vs 'X' → mismatch
    const blocks = makeBlocks([{ x: -2, y: 0, z: 0, type: "OZX" as BlockType }]);
    expect(hasCubeColorConflict("XZZ" as CubeType, { x: 0, y: 0, z: 0 }, blocks)).toBe(true);
  });

  it("uses swapped colors for Hadamard pipe's far end facing cube", () => {
    // Pipe "OZXH" at (-2,0,0): far end (+2 = x=0) faces the cube
    // base "OZX", swapped at far end: axis 1='X', axis 2='Z'
    // Cube "ZXZ": axis 1='X', axis 2='Z' → match
    const blocks = makeBlocks([{ x: -2, y: 0, z: 0, type: "OZXH" as BlockType }]);
    expect(hasCubeColorConflict("ZXZ" as CubeType, { x: 0, y: 0, z: 0 }, blocks)).toBe(false);
  });

  it("allows cube when Y-open Hadamard pipe head colors match", () => {
    // Pipe "XOZH" at (0,1,0): cube at (0,0,0) is at head (not swapped)
    // Head: axis 0='X', axis 2='Z'
    // Cube "XZZ": axis 0='X', axis 2='Z' → match
    const blocks = makeBlocks([{ x: 0, y: 1, z: 0, type: "XOZH" as BlockType }]);
    expect(hasCubeColorConflict("XZZ" as CubeType, { x: 0, y: 0, z: 0 }, blocks)).toBe(false);
  });

  it("rejects cube when Y-open Hadamard pipe head colors don't match", () => {
    // Pipe "XOZH" at (0,1,0): cube at (0,0,0) is at head (not swapped)
    // Head: axis 0='X', axis 2='Z'
    // Cube "ZZX": axis 0='Z' → mismatch
    const blocks = makeBlocks([{ x: 0, y: 1, z: 0, type: "XOZH" as BlockType }]);
    expect(hasCubeColorConflict("ZZX" as CubeType, { x: 0, y: 0, z: 0 }, blocks)).toBe(true);
  });

  it("skips pipes not oriented toward the cube", () => {
    // Pipe "ZOX" (open Y) at (1,0,0): openAxis=1 but offset axis=0 → skip
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "ZOX" as BlockType }]);
    expect(hasCubeColorConflict("XZZ" as CubeType, { x: 0, y: 0, z: 0 }, blocks)).toBe(false);
  });
});

describe("hasYCubePipeAxisConflict", () => {
  it("rejects Y cube next to an X-open pipe", () => {
    // X-open pipe "OZX" at (1,0,0), Y cube at (0,0,0)
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OZX" as BlockType }]);
    expect(hasYCubePipeAxisConflict("Y", { x: 0, y: 0, z: 0 }, blocks)).toBe(true);
  });

  it("rejects Y cube next to a Y-open pipe", () => {
    // Y-open pipe "ZOX" at (0,1,0), Y cube at (0,0,0)
    const blocks = makeBlocks([{ x: 0, y: 1, z: 0, type: "ZOX" as BlockType }]);
    expect(hasYCubePipeAxisConflict("Y", { x: 0, y: 0, z: 0 }, blocks)).toBe(true);
  });

  it("allows Y cube next to a Z-open pipe", () => {
    // Z-open pipe "ZXO" at (0,0,1), Y cube at (0,0,0)
    const blocks = makeBlocks([{ x: 0, y: 0, z: 1, type: "ZXO" as BlockType }]);
    expect(hasYCubePipeAxisConflict("Y", { x: 0, y: 0, z: 0 }, blocks)).toBe(false);
  });

  it("rejects Y cube next to an X-open Hadamard pipe", () => {
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OZXH" as BlockType }]);
    expect(hasYCubePipeAxisConflict("Y", { x: 0, y: 0, z: 0 }, blocks)).toBe(true);
  });

  it("allows Y cube with no adjacent pipes", () => {
    const blocks = makeBlocks([]);
    expect(hasYCubePipeAxisConflict("Y", { x: 0, y: 0, z: 0 }, blocks)).toBe(false);
  });

  it("rejects Y cube on the far side (-2 offset) of an X-open pipe", () => {
    // X-open pipe at (1,0,0), Y cube at (3,0,0) — far endpoint
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OXZ" as BlockType }]);
    expect(hasYCubePipeAxisConflict("Y", { x: 3, y: 0, z: 0 }, blocks)).toBe(true);
  });

  it("rejects X-open pipe when Y cube is at endpoint", () => {
    // Y cube at (0,0,0), placing X-open pipe "OZX" at (1,0,0)
    const blocks = makeBlocks([{ x: 0, y: 0, z: 0, type: "Y" }]);
    expect(hasYCubePipeAxisConflict("OZX" as BlockType, { x: 1, y: 0, z: 0 }, blocks)).toBe(true);
  });

  it("rejects Y-open pipe when Y cube is at endpoint", () => {
    const blocks = makeBlocks([{ x: 0, y: 0, z: 0, type: "Y" }]);
    expect(hasYCubePipeAxisConflict("ZOX" as BlockType, { x: 0, y: 1, z: 0 }, blocks)).toBe(true);
  });

  it("allows Z-open pipe next to a Y cube", () => {
    const blocks = makeBlocks([{ x: 0, y: 0, z: 0, type: "Y" }]);
    expect(hasYCubePipeAxisConflict("ZXO" as BlockType, { x: 0, y: 0, z: 1 }, blocks)).toBe(false);
  });

  it("does not affect regular cube placement", () => {
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OZX" as BlockType }]);
    expect(hasYCubePipeAxisConflict("XZZ" as BlockType, { x: 0, y: 0, z: 0 }, blocks)).toBe(false);
  });
});

describe("wasdToBuildDirection", () => {
  it("axis-absolute: W/S map to TQEC X axis, A/D to TQEC Y axis", () => {
    // Camera azimuth should be ignored in axis-absolute mode.
    expect(wasdToBuildDirection("w", 1.3, true)).toEqual({ tqecAxis: 0, sign: 1 });
    expect(wasdToBuildDirection("s", -2.7, true)).toEqual({ tqecAxis: 0, sign: -1 });
    expect(wasdToBuildDirection("a", 0.5, true)).toEqual({ tqecAxis: 1, sign: 1 });
    expect(wasdToBuildDirection("d", 3.14, true)).toEqual({ tqecAxis: 1, sign: -1 });
  });

  it("axis-absolute: arrow keys still map to vertical (Z) axis", () => {
    expect(wasdToBuildDirection("arrowup", 0, true)).toEqual({ tqecAxis: 2, sign: 1 });
    expect(wasdToBuildDirection("arrowdown", 0, true)).toEqual({ tqecAxis: 2, sign: -1 });
  });

  it("camera-relative (default): forward depends on camera azimuth quadrant", () => {
    // Azimuth 0 → camera on +Z, W = build +Y
    expect(wasdToBuildDirection("w", 0)).toEqual({ tqecAxis: 1, sign: 1 });
    // Azimuth π/2 → W = build -X
    expect(wasdToBuildDirection("w", Math.PI / 2)).toEqual({ tqecAxis: 0, sign: -1 });
  });
});

describe("createBlockGeometry", () => {
  it("removes one face from cube geometry when hidden", () => {
    const full = createBlockGeometry("XZZ");
    const hidden = createBlockGeometry("XZZ", FACE_POS_Y);

    expect(full.getIndex()?.count).toBe(36);
    expect(hidden.getIndex()?.count).toBe(30);
  });

  it("removes one face from pipe geometry when hidden", () => {
    const full = createBlockGeometry("OZX");
    const hidden = createBlockGeometry("OZX", FACE_POS_Z);

    expect((full.getIndex()?.count ?? 0) - (hidden.getIndex()?.count ?? 0)).toBe(6);
  });
});
