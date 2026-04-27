import { describe, expect, it } from "vitest";
import { createBlockGeometry, createYDefectEdges, getHiddenFaceMaskForPos, FACE_NEG_X, FACE_NEG_Y, FACE_NEG_Z, FACE_POS_X, FACE_POS_Y, FACE_POS_Z, isValidPipePos, isValidPos, isValidBlockPos, pipeAxisFromPos, resolvePipeType, getAdjacentPos, snapGroundPos, hasPipeColorConflict, hasCubeColorConflict, hasYCubePipeAxisConflict, canonicalCubeForPort, countAttachedPipes, wasdToBuildDirection, flipBlockType, defaultPortIO, CUBE_TYPES, PIPE_TYPES } from "./index";
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

  it("snapGroundPos(_, _, true) always produces a valid pipe position", () => {
    // Regression guard: a pipe placed via the ground-plane snapper must never
    // land half-on-a-cube. Sweep a dense grid of raw inputs including points
    // exactly on block corners, pipe-slot midpoints, and between them.
    for (let x = -6; x <= 6; x += 0.05) {
      for (let y = -6; y <= 6; y += 0.05) {
        const snapped = snapGroundPos(x, y, true);
        expect(isValidPipePos(snapped)).toBe(true);
      }
    }
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

describe("countAttachedPipes", () => {
  it("counts 0 when no adjacent pipes", () => {
    const blocks = makeBlocks([]);
    expect(countAttachedPipes({ x: 0, y: 0, z: 0 }, blocks)).toBe(0);
  });

  it("counts 1 for a single adjacent pipe on an axis", () => {
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OZX" }]);
    expect(countAttachedPipes({ x: 0, y: 0, z: 0 }, blocks)).toBe(1);
  });

  it("counts 2 for pipes on opposite sides of the same axis (colinear)", () => {
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OZX" },
      { x: -2, y: 0, z: 0, type: "OZX" },
    ]);
    expect(countAttachedPipes({ x: 0, y: 0, z: 0 }, blocks)).toBe(2);
  });

  it("counts pipes on multiple axes", () => {
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OZX" },
      { x: 0, y: 1, z: 0, type: "ZOX" },
    ]);
    expect(countAttachedPipes({ x: 0, y: 0, z: 0 }, blocks)).toBe(2);
  });

  it("ignores pipes whose open axis is not along the offset axis", () => {
    // Pipe at (1,0,0) but Y-open: offset axis is X, open axis is Y → don't count.
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "ZOX" }]);
    expect(countAttachedPipes({ x: 0, y: 0, z: 0 }, blocks)).toBe(0);
  });

  it("ignores non-pipe neighbors", () => {
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "XZZ" }]);
    expect(countAttachedPipes({ x: 0, y: 0, z: 0 }, blocks)).toBe(0);
  });
});

describe("canonicalCubeForPort", () => {
  it("returns null for 0 attached pipes", () => {
    const blocks = makeBlocks([]);
    expect(canonicalCubeForPort({ x: 0, y: 0, z: 0 }, blocks)).toBeNull();
  });

  it("returns null for 1 attached pipe (stays a port)", () => {
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OZX" }]);
    expect(canonicalCubeForPort({ x: 0, y: 0, z: 0 }, blocks)).toBeNull();
  });

  it("returns the unique type when 2 pipes on different axes fully determine", () => {
    // Pipe OZX at +X: axis1='Z', axis2='X'
    // Pipe ZOX at +Y: axis0='Z', axis2='X'
    // Combined: axis0='Z', axis1='Z', axis2='X' → ZZX uniquely
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OZX" },
      { x: 0, y: 1, z: 0, type: "ZOX" },
    ]);
    expect(canonicalCubeForPort({ x: 0, y: 0, z: 0 }, blocks)).toBe("ZZX");
  });

  it("canonicalises the colinear-pipe ambiguity deterministically", () => {
    // Two X-axis OZX pipes → axis1='Z', axis2='X', axis0 free.
    // Valid options: ZZX (index 4) and XZX (index 5). Canonical = ZZX.
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OZX" },
      { x: -2, y: 0, z: 0, type: "OZX" },
    ]);
    expect(canonicalCubeForPort({ x: 0, y: 0, z: 0 }, blocks)).toBe("ZZX");
  });

  it("canonical pick is stable across equivalent pipe orderings", () => {
    const a = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OXZ" },
      { x: -2, y: 0, z: 0, type: "OXZ" },
    ]);
    const b = makeBlocks([
      { x: -2, y: 0, z: 0, type: "OXZ" },
      { x: 1, y: 0, z: 0, type: "OXZ" },
    ]);
    expect(canonicalCubeForPort({ x: 0, y: 0, z: 0 }, a)).toBe(
      canonicalCubeForPort({ x: 0, y: 0, z: 0 }, b),
    );
  });

  it("returns null when 2 pipes give conflicting constraints", () => {
    // OZX at +X: axis1='Z', axis2='X'. OXZ at -X: axis1='X', axis2='Z'. Conflict on both axes.
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OZX" },
      { x: -2, y: 0, z: 0, type: "OXZ" },
    ]);
    expect(canonicalCubeForPort({ x: 0, y: 0, z: 0 }, blocks)).toBeNull();
  });

  it("resolves 3 pipes (2 colinear + 1 perpendicular) to the fully-determined type", () => {
    // Two X-axis OZX pipes (axis1='Z', axis2='X') + one Y-axis ZOX pipe (axis0='Z', axis2='X')
    // → axis0='Z', axis1='Z', axis2='X' → ZZX
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OZX" },
      { x: -2, y: 0, z: 0, type: "OZX" },
      { x: 0, y: 1, z: 0, type: "ZOX" },
    ]);
    expect(canonicalCubeForPort({ x: 0, y: 0, z: 0 }, blocks)).toBe("ZZX");
  });

  it("handles Hadamard pipe at the swap end", () => {
    // OZXH at (-2,0,0): cube at (0,0,0) is at pipe's +2 (swap) end.
    // Swapped constraints: axis1='X', axis2='Z'.
    // Combined with OZXH at (1,0,0) (cube at -1, no swap): axis1='Z', axis2='X'.
    // Conflict on both axes.
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OZXH" },
      { x: -2, y: 0, z: 0, type: "OZXH" },
    ]);
    expect(canonicalCubeForPort({ x: 0, y: 0, z: 0 }, blocks)).toBeNull();
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

describe("flipBlockType", () => {
  it("swaps X↔Z in cube types", () => {
    expect(flipBlockType("XZZ")).toBe("ZXX");
    expect(flipBlockType("ZXZ")).toBe("XZX");
    expect(flipBlockType("XXZ")).toBe("ZZX");
  });

  it("swaps closed-axis characters on pipes (preserving O and H)", () => {
    expect(flipBlockType("OXZ")).toBe("OZX");
    expect(flipBlockType("XOZH")).toBe("ZOXH");
    expect(flipBlockType("ZXOH")).toBe("XZOH");
  });

  it("leaves Y unchanged", () => {
    expect(flipBlockType("Y")).toBe("Y");
  });

  it("maps every cube and pipe type to another valid type", () => {
    for (const ct of CUBE_TYPES) {
      expect(CUBE_TYPES).toContain(flipBlockType(ct));
    }
    for (const pt of PIPE_TYPES) {
      expect(PIPE_TYPES).toContain(flipBlockType(pt));
    }
  });

  it("is an involution", () => {
    for (const ct of CUBE_TYPES) expect(flipBlockType(flipBlockType(ct))).toBe(ct);
    for (const pt of PIPE_TYPES) expect(flipBlockType(flipBlockType(pt))).toBe(pt);
  });
});

describe("defaultPortIO", () => {
  it("port at +z end of a Z-axis pipe defaults to 'out'", () => {
    // ZXO is Z-axis pipe (third char 'O') at z=1; ports at z=0 and z=3.
    const blocks = makeBlocks([{ x: 0, y: 0, z: 1, type: "ZXO" }]);
    expect(defaultPortIO({ x: 0, y: 0, z: 3 }, blocks)).toBe("out");
  });

  it("port at -z end of a Z-axis pipe defaults to 'in'", () => {
    const blocks = makeBlocks([{ x: 0, y: 0, z: 1, type: "ZXO" }]);
    expect(defaultPortIO({ x: 0, y: 0, z: 0 }, blocks)).toBe("in");
  });

  it("Hadamard variant ZXOH still infers from the Z geometry", () => {
    const blocks = makeBlocks([{ x: 0, y: 0, z: 1, type: "ZXOH" }]);
    expect(defaultPortIO({ x: 0, y: 0, z: 3 }, blocks)).toBe("out");
    expect(defaultPortIO({ x: 0, y: 0, z: 0 }, blocks)).toBe("in");
  });

  it("ports of an X-axis pipe both default to 'in'", () => {
    // OXZ is X-axis (first char 'O'); ports at x=0 and x=3 of pipe at x=1.
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OXZ" }]);
    expect(defaultPortIO({ x: 0, y: 0, z: 0 }, blocks)).toBe("in");
    expect(defaultPortIO({ x: 3, y: 0, z: 0 }, blocks)).toBe("in");
  });

  it("port with no surrounding pipe defaults to 'in'", () => {
    expect(defaultPortIO({ x: 0, y: 0, z: 0 }, makeBlocks([]))).toBe("in");
  });
});

describe("createYDefectEdges", () => {
  function edgeCount(geo: ReturnType<typeof createYDefectEdges>): number {
    const arr = geo.getAttribute("position").array as Float32Array;
    // 2 endpoints × 3 coords = 6 floats per edge
    return arr.length / 6;
  }

  it("Y blocks have no Y-defect edges (single basis)", () => {
    expect(edgeCount(createYDefectEdges("Y"))).toBe(0);
  });

  it.each(CUBE_TYPES)("cube %s emits 8 Y-defect edges (12 - 4 same-basis)", (cube) => {
    expect(edgeCount(createYDefectEdges(cube))).toBe(8);
  });

  it("non-Hadamard ZX pipe emits 4 Y-defect edges along the open axis", () => {
    expect(edgeCount(createYDefectEdges("OZX"))).toBe(4);
    expect(edgeCount(createYDefectEdges("ZOX"))).toBe(4);
    expect(edgeCount(createYDefectEdges("ZXO"))).toBe(4);
  });

  it("Hadamard pipes emit the same 4 wall-meeting edges (band ring is v1 follow-up)", () => {
    expect(edgeCount(createYDefectEdges("OZXH"))).toBe(4);
    expect(edgeCount(createYDefectEdges("XZOH"))).toBe(4);
  });

  it("skips every edge adjacent to a hidden face (continuous surface across the join)", () => {
    // XZZ cube: +X face is X-basis (red); ±Y, ±Z all Z-basis (blue).
    // 8 Y-defect edges total: 4 around +X face, 4 around -X face.
    // Hiding +X removes those 4 edges (the seam-side defects vanish because
    // the neighboring pipe/cube extends the surrounding Z faces seamlessly).
    expect(edgeCount(createYDefectEdges("XZZ", FACE_POS_X))).toBe(4);
    // Hiding +X plus a Z face: +X removes 4; the +Y face additionally hides
    // the +Y/-X edge (a defect not yet skipped), giving 8 - 5 = 3.
    expect(edgeCount(createYDefectEdges("XZZ", FACE_POS_X | FACE_POS_Y))).toBe(3);
    expect(edgeCount(createYDefectEdges("XZZ", FACE_POS_X | FACE_POS_Z))).toBe(3);
    // Hiding two same-basis faces (+Y and +Z) skips their 4 unique adjacent
    // defects: ±X/+Y and ±X/+Z, leaving the four around -X.
    expect(edgeCount(createYDefectEdges("XZZ", FACE_POS_Y | FACE_POS_Z))).toBe(4);
    // Hiding the whole +X side: skips 4 (+X-adjacent) + 1 (-X/+Y from +Y)
    // + 1 (-X/+Z from +Z) = 6. Remaining: 2 (the -X/-Y and -X/-Z edges).
    expect(edgeCount(createYDefectEdges("XZZ", FACE_POS_X | FACE_POS_Y | FACE_POS_Z))).toBe(2);
    // Sanity: hiding everything yields zero edges.
    const all = FACE_POS_X | FACE_NEG_X | FACE_POS_Y | FACE_NEG_Y | FACE_POS_Z | FACE_NEG_Z;
    expect(edgeCount(createYDefectEdges("XZZ", all))).toBe(0);
  });
});
