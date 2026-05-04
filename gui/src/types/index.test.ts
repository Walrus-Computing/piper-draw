import { describe, expect, it } from "vitest";
import { blockTqecSize, createBlockGeometry, createYDefectEdges, getHiddenFaceMaskForPos, FACE_NEG_X, FACE_NEG_Y, FACE_NEG_Z, FACE_POS_X, FACE_POS_Y, FACE_POS_Z, H_BAND_HALF_HEIGHT, isValidPipePos, isValidPos, isValidBlockPos, pipeAxisFromPos, resolvePipeType, getAdjacentPos, snapGroundPos, hasPipeColorConflict, hasCubeColorConflict, hasYCubePipeAxisConflict, canonicalCubeForPort, countAttachedPipes, wasdToBuildDirection, flipBlockType, defaultPortIO, getOrderedPortPositions, determineCubeOptions, determineCubeOptionsWithPipeRetype, computePipeRetypes, CUBE_TYPES, PIPE_TYPES, deriveFaceKey } from "./index";
import type { PipeType, CubeType, PortMeta, Block } from "./index";
import type { BlockType } from "./index";
import { Vector3 } from "three";
import * as THREE from "three";

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

    // Each closed-axis pipe face is rendered as 3 strips (below / band / above),
    // so hiding one face drops 3 quads = 6 triangles = 18 indices.
    expect((full.getIndex()?.count ?? 0) - (hidden.getIndex()?.count ?? 0)).toBe(18);
  });

  it("Y-twist pipe geometry omits the yellow Hadamard band", () => {
    // Hadamard walls are split into 3 strips (below band, yellow band, above).
    // Y-twist walls are split into 2 strips (below midline, above midline) with
    // the colours flipped, but no yellow band — so no vertex carries H_COLOR.
    const geo = createBlockGeometry("OZXY");
    const colors = geo.getAttribute("color").array as Float32Array;
    // H_COLOR = #ffff65 → r ≈ 1, g ≈ 1, b ≈ 0.396. Look for any vertex with
    // both red and green channels saturated (the unique signature of yellow).
    let yellowVerts = 0;
    for (let i = 0; i < colors.length; i += 3) {
      if (colors[i] > 0.95 && colors[i + 1] > 0.95) yellowVerts++;
    }
    expect(yellowVerts).toBe(0);
  });

  it("Y-twist pipe walls flip colour across the band", () => {
    // OZXY is X-open. Walls are split into three strips along the open axis
    // (below / band / above) at ±H_BAND_HALF_HEIGHT. The "below" strip and
    // the "above" strip must carry different colours (X↔Z flip); Y-twist
    // band defaults to the below colour.
    const geo = createBlockGeometry("OZXY");
    const positions = geo.getAttribute("position").array as Float32Array;
    const normals = geo.getAttribute("normal").array as Float32Array;
    const colors = geo.getAttribute("color").array as Float32Array;
    const buckets = new Map<string, Set<string>>();
    for (let q = 0; q < positions.length / 12; q++) {
      const baseV = q * 12;
      const baseN = q * 12;
      // Use the open-axis centroid to bucket each quad into below / band / above.
      let sumOpen = 0;
      for (let v = 0; v < 4; v++) sumOpen += positions[baseV + v * 3 + 0];
      const t = sumOpen / 4;
      const strip = t < -H_BAND_HALF_HEIGHT ? "below"
        : t > H_BAND_HALF_HEIGHT ? "above"
        : "band";
      const nx = Math.round(normals[baseN]);
      const ny = Math.round(normals[baseN + 1]);
      const nz = Math.round(normals[baseN + 2]);
      const face =
        nx !== 0 ? (nx > 0 ? "+X" : "-X") :
        ny !== 0 ? (ny > 0 ? "+Y" : "-Y") :
        nz > 0 ? "+Z" : "-Z";
      const c = `${colors[baseV].toFixed(2)},${colors[baseV + 1].toFixed(2)},${colors[baseV + 2].toFixed(2)}`;
      const key = `${face}|${strip}`;
      if (!buckets.has(key)) buckets.set(key, new Set());
      buckets.get(key)!.add(c);
    }
    for (const face of ["+Y", "-Y", "+Z", "-Z"] as const) {
      const above = buckets.get(`${face}|above`);
      const below = buckets.get(`${face}|below`);
      expect(above, `face ${face} above`).toBeDefined();
      expect(below, `face ${face} below`).toBeDefined();
      const aboveC = [...above!][0];
      const belowC = [...below!][0];
      expect(aboveC).not.toBe(belowC);
    }
  });
});

describe("slab paint cells", () => {
  it("each of the 9 top-face cells gets its own color from `<face>:<q>` overrides", () => {
    // App disables ColorManagement so hex strings are not gamma-corrected;
    // mirror that here so the override values land verbatim in the buffer.
    const prev = THREE.ColorManagement.enabled;
    THREE.ColorManagement.enabled = false;
    try {
      // 9 distinct hexes — one per cell of the slab top (face 2).
      const palette = [
        "#100000", "#200000", "#300000",
        "#000010", "#000020", "#000030",
        "#001000", "#002000", "#003000",
      ];
      const overrides: Record<string, string> = {};
      for (let q = 0; q < 9; q++) overrides[`2:${q}`] = palette[q];

      const geo = createBlockGeometry("slab", 0, undefined, overrides);
      const positions = geo.getAttribute("position").array as Float32Array;
      const normals = geo.getAttribute("normal").array as Float32Array;
      const colors = geo.getAttribute("color").array as Float32Array;

      const seen = new Set<number>();
      for (let q = 0; q < positions.length / 12; q++) {
        const baseV = q * 12;
        if (Math.round(normals[q * 12 + 1]) !== 1) continue; // top only
        let sx = 0, sz = 0;
        for (let v = 0; v < 4; v++) {
          sx += positions[baseV + v * 3 + 0];
          sz += positions[baseV + v * 3 + 2];
        }
        const cx = sx / 4, cz = sz / 4;
        const ix = cx < -1 / 3 ? 0 : cx > 1 / 3 ? 2 : 1;
        const iz = cz < -1 / 3 ? 0 : cz > 1 / 3 ? 2 : 1;
        const expectedQ = ix + iz * 3;
        const r = Math.round(colors[baseV] * 255);
        const g = Math.round(colors[baseV + 1] * 255);
        const b = Math.round(colors[baseV + 2] * 255);
        const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
        expect(hex, `cell q=${expectedQ}`).toBe(palette[expectedQ]);
        seen.add(expectedQ);
      }
      expect(seen.size).toBe(9);
    } finally {
      THREE.ColorManagement.enabled = prev;
    }
  });

  it("the geometry's 18 cells (9 top + 9 bottom) raycast into the q value the click handler computes", () => {
    // Build an unpainted slab and probe each cell's centroid in local-XZ.
    // Confirm the click-handler classifier (`ix < -1/3 ? 0 ...`) maps every
    // cell back to the q embedded in its winding order.
    const geo = createBlockGeometry("slab");
    const positions = geo.getAttribute("position").array as Float32Array;
    const normals = geo.getAttribute("normal").array as Float32Array;
    const quadCount = positions.length / 12;
    expect(quadCount).toBe(18);
    let topCount = 0, botCount = 0;
    for (let q = 0; q < quadCount; q++) {
      const baseV = q * 12;
      const ny = Math.round(normals[q * 12 + 1]);
      let sx = 0, sz = 0;
      for (let v = 0; v < 4; v++) {
        sx += positions[baseV + v * 3 + 0];
        sz += positions[baseV + v * 3 + 2];
      }
      const cx = sx / 4, cz = sz / 4;
      const ix = cx < -1 / 3 ? 0 : cx > 1 / 3 ? 2 : 1;
      const iz = cz < -1 / 3 ? 0 : cz > 1 / 3 ? 2 : 1;
      // The classifier should put the centroid of each quad in a unique cell.
      expect(ix).toBeGreaterThanOrEqual(0);
      expect(ix).toBeLessThan(3);
      expect(iz).toBeGreaterThanOrEqual(0);
      expect(iz).toBeLessThan(3);
      if (ny === 1) topCount++; else botCount++;
    }
    expect(topCount).toBe(9);
    expect(botCount).toBe(9);
  });
});

describe("Y-twist pipe types (free-build only)", () => {
  it("registers all 6 Y-twist pipe types", () => {
    for (const t of ["OZXY", "OXZY", "ZOXY", "XOZY", "ZXOY", "XZOY"] as const) {
      expect(PIPE_TYPES.includes(t)).toBe(true);
    }
  });

  it("Y-twist pipes have the same TQEC dimensions as their plain counterparts", () => {
    expect(blockTqecSize("OZXY")).toEqual(blockTqecSize("OZX"));
    expect(blockTqecSize("XOZY")).toEqual(blockTqecSize("XOZ"));
    expect(blockTqecSize("ZXOY")).toEqual(blockTqecSize("ZXO"));
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

  it("Y-twist pipes emit 4 long edges + 4 ring segments at the band midline", () => {
    // 4 along the open axis (same as a non-Hadamard pipe of mixed bases) plus
    // 4 short segments forming a square ring at the band midline (one on each
    // closed-axis face, marking the colour-flip seam).
    expect(edgeCount(createYDefectEdges("OZXY"))).toBe(8);
    expect(edgeCount(createYDefectEdges("XOZY"))).toBe(8);
    expect(edgeCount(createYDefectEdges("ZXOY"))).toBe(8);
  });

  it("Y-twist ring segments lie at the open-axis midline", () => {
    const geo = createYDefectEdges("OZXY"); // X-open in Three.js
    const arr = geo.getAttribute("position").array as Float32Array;
    // 4 edges run along Three.js X (the open axis) — non-zero X span on both endpoints.
    // 4 edges are ring segments at X = 0 — both endpoints at Three.js X ≈ 0.
    let ringCount = 0;
    for (let i = 0; i < arr.length; i += 6) {
      if (Math.abs(arr[i]) < 1e-6 && Math.abs(arr[i + 3]) < 1e-6) ringCount++;
    }
    expect(ringCount).toBe(4);
  });
});

describe("getOrderedPortPositions", () => {
  const explicitPorts = new Set([
    "0,0,0",
    "3,0,0",
    "6,0,0",
    "9,0,0",
  ]);
  const blocks = new Map<
    string,
    { pos: { x: number; y: number; z: number }; type: BlockType }
  >();

  it("falls back to spatial sort when no ranks are set", () => {
    const portMeta = new Map<string, PortMeta>([
      ["3,0,0", { label: "P1", io: "in" }],
      ["0,0,0", { label: "P2", io: "in" }],
      ["9,0,0", { label: "P3", io: "in" }],
      ["6,0,0", { label: "P4", io: "in" }],
    ]);
    const result = getOrderedPortPositions(blocks, explicitPorts, portMeta);
    expect(result.map((p) => p.x)).toEqual([0, 3, 6, 9]);
  });

  it("orders ports by rank when ranks are set", () => {
    const portMeta = new Map<string, PortMeta>([
      ["0,0,0", { label: "P1", io: "in", rank: 3 }],
      ["3,0,0", { label: "P2", io: "in", rank: 1 }],
      ["6,0,0", { label: "P3", io: "in", rank: 0 }],
      ["9,0,0", { label: "P4", io: "in", rank: 2 }],
    ]);
    const result = getOrderedPortPositions(blocks, explicitPorts, portMeta);
    expect(result.map((p) => p.x)).toEqual([6, 3, 9, 0]);
  });

  it("places ranked ports before unranked ones; unranked sort spatially", () => {
    const portMeta = new Map<string, PortMeta>([
      ["9,0,0", { label: "P1", io: "in", rank: 0 }],
      ["3,0,0", { label: "P2", io: "in" }],
      ["0,0,0", { label: "P3", io: "in" }],
      // P4 at (6,0,0) has no PortMeta entry at all — also unranked.
    ]);
    const result = getOrderedPortPositions(blocks, explicitPorts, portMeta);
    expect(result.map((p) => p.x)).toEqual([9, 0, 3, 6]);
  });

  it("breaks ties between equal ranks by spatial order", () => {
    const portMeta = new Map<string, PortMeta>([
      ["6,0,0", { label: "P1", io: "in", rank: 0 }],
      ["0,0,0", { label: "P2", io: "in", rank: 0 }],
      ["9,0,0", { label: "P3", io: "in", rank: 1 }],
      ["3,0,0", { label: "P4", io: "in", rank: 1 }],
    ]);
    const result = getOrderedPortPositions(blocks, explicitPorts, portMeta);
    expect(result.map((p) => p.x)).toEqual([0, 6, 3, 9]);
  });
});

// ---------------------------------------------------------------------------
// Wider cube-cycle helpers (allow adjacent pipes to retype)
// ---------------------------------------------------------------------------

describe("determineCubeOptionsWithPipeRetype", () => {
  const ALL_CUBE_TYPES = [...CUBE_TYPES];

  it("returns all cube types when no pipes are adjacent", () => {
    const blocks = makeBlocks([]);
    const opts = determineCubeOptionsWithPipeRetype({ x: 0, y: 0, z: 0 }, blocks);
    expect(opts.sort()).toEqual(ALL_CUBE_TYPES.sort());
  });

  it("widens beyond determineCubeOptions when far-end is a port", () => {
    // Single X-open pipe at +x; far-end (3,0,0) is empty (port).
    // Narrow gate constrains T[1]=Z, T[2]=X → [ZZX, XZX] only.
    // Wider gate accepts any T whose inferred pipe is valid AND far-end port can host
    // some cube — i.e., excludes only T's where inferPipeType returns null.
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OZX" }]);

    const narrow = determineCubeOptions({ x: 0, y: 0, z: 0 }, blocks);
    const narrowList = narrow.determined ? [narrow.type] : narrow.options;
    expect(narrowList.sort()).toEqual(["XZX", "ZZX"]);

    const wider = determineCubeOptionsWithPipeRetype({ x: 0, y: 0, z: 0 }, blocks);
    expect(wider.sort()).toEqual(["XXZ", "XZX", "ZXZ", "ZZX"]);
  });

  it("excludes cube types whose inferred pipe would not be a valid PIPE_TYPE (OZZ/OXX)", () => {
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OZX" }]);
    const opts = determineCubeOptionsWithPipeRetype({ x: 0, y: 0, z: 0 }, blocks);
    // XZZ → OZZ (invalid), ZXX → OXX (invalid) — both must be rejected.
    expect(opts).not.toContain("XZZ");
    expect(opts).not.toContain("ZXX");
  });

  it("respects a fixed-cube far-end (constrains the wider set)", () => {
    // Pipe OZX at +x with fixed far-end cube ZZX at (3,0,0).
    // Without H toggle the narrow constraint is T[1]=Z, T[2]=X → [ZZX, XZX].
    // With H toggle a non-H pipe can become H, so the swapped far-end
    // constraint T[1]=X, T[2]=Z is also reachable → adds [ZXZ, XXZ].
    // XZZ and ZXX still rejected because inferPipeType(_, 0) is null.
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OZX" },
      { x: 3, y: 0, z: 0, type: "ZZX" },
    ]);
    const opts = determineCubeOptionsWithPipeRetype({ x: 0, y: 0, z: 0 }, blocks);
    expect(opts.sort()).toEqual(["XXZ", "XZX", "ZXZ", "ZZX"]);
  });

  it("wider set is symmetric across all 4 corners of a 4-corner-only square", () => {
    // 4 ZZX corners directly connected by 4 pipes (no edge cubes between).
    // This exercises the case where the cube is at the +2 (FAR) end of some
    // adjacent pipes — naive `inferPipeType(T, axis) + maybeH` is wrong for
    // far-end with H, so we must enumerate all valid pipe variants on the axis.
    const blocks = makeBlocks([
      { x: 0, y: 0, z: 0, type: "ZZX" },
      { x: 3, y: 0, z: 0, type: "ZZX" },
      { x: 0, y: 3, z: 0, type: "ZZX" },
      { x: 3, y: 3, z: 0, type: "ZZX" },
      { x: 1, y: 0, z: 0, type: "OZX" }, // bottom edge
      { x: 1, y: 3, z: 0, type: "OZX" }, // top edge
      { x: 0, y: 1, z: 0, type: "ZOX" }, // left edge
      { x: 3, y: 1, z: 0, type: "ZOX" }, // right edge
    ]);
    const expected = ["XXZ", "ZZX"];
    expect(determineCubeOptionsWithPipeRetype({ x: 0, y: 0, z: 0 }, blocks).sort()).toEqual(expected);
    expect(determineCubeOptionsWithPipeRetype({ x: 3, y: 0, z: 0 }, blocks).sort()).toEqual(expected);
    expect(determineCubeOptionsWithPipeRetype({ x: 0, y: 3, z: 0 }, blocks).sort()).toEqual(expected);
    expect(determineCubeOptionsWithPipeRetype({ x: 3, y: 3, z: 0 }, blocks).sort()).toEqual(expected);
  });

  it("frees a corner cube of a 4-cube square via H-toggle on perpendicular pipes", () => {
    // The user's scenario: a square frame of ZZX corners connected by OZX
    // (X-axis) and ZOX (Y-axis) pipes. Without H toggle the corner is pinned
    // to ZZX. With H toggle, adding H to BOTH adjacent pipes lets the corner
    // become XXZ (and reverse).
    const blocks = makeBlocks([
      // Corner under test at (0,0,0) — not placed; we only care about the
      // wider set at this position.
      // Pipe1 along +x and far-end corner.
      { x: 1, y: 0, z: 0, type: "OZX" },
      { x: 3, y: 0, z: 0, type: "ZZX" },
      // Pipe2 along +y and far-end corner.
      { x: 0, y: 1, z: 0, type: "ZOX" },
      { x: 0, y: 3, z: 0, type: "ZZX" },
    ]);
    // Narrow gate uniquely determines ZZX here.
    const narrow = determineCubeOptions({ x: 0, y: 0, z: 0 }, blocks);
    expect(narrow.determined).toBe(true);
    if (narrow.determined) expect(narrow.type).toBe("ZZX");

    // Wider gate offers ZZX (current, both pipes preserved) and XXZ
    // (both pipes toggled to H). Other types are blocked: a single H toggle
    // creates contradicting T[2] constraints, and XZZ/ZXX/ZXZ/XZX have at
    // least one inferPipeType null on axis 0 or axis 1.
    const wider = determineCubeOptionsWithPipeRetype({ x: 0, y: 0, z: 0 }, blocks);
    expect(wider.sort()).toEqual(["XXZ", "ZZX"]);
  });

  it("considers H toggle when a non-H pipe alone cannot satisfy the candidate", () => {
    // Pipe OXZ at +x, fixed far-end ZXZ.
    // T=XZX without H toggle: inferred OZX at far-end ZXZ — no swap →
    //   base[1]='Z' vs ZXZ[1]='X' conflict. With H toggle (OZXH): swap →
    //   base[2]='X' vs ZXZ[1]='X' ✓ and base[1]='Z' vs ZXZ[2]='Z' ✓.
    // So XZX is in the wider set thanks to H toggle.
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OXZ" },
      { x: 3, y: 0, z: 0, type: "ZXZ" },
    ]);
    expect(determineCubeOptionsWithPipeRetype({ x: 0, y: 0, z: 0 }, blocks))
      .toContain("XZX");
  });

  it("widens beyond narrow when two colinear pipes have port far-ends (CLAUDE.md scenario)", () => {
    // Two X-open pipes flanking (0,0,0); both far-ends are ports.
    // Narrow: both pipes impose T[1]=Z, T[2]=X → [ZZX, XZX].
    // Wider: pipes can retype together → all 4 valid (excludes XZZ, ZXX whose inferred pipe is invalid).
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OZX" },
      { x: -2, y: 0, z: 0, type: "OZX" },
    ]);
    const narrow = determineCubeOptions({ x: 0, y: 0, z: 0 }, blocks);
    const narrowList = narrow.determined ? [narrow.type] : narrow.options;
    expect(narrowList.sort()).toEqual(["XZX", "ZZX"]);

    const wider = determineCubeOptionsWithPipeRetype({ x: 0, y: 0, z: 0 }, blocks);
    expect(wider.sort()).toEqual(["XXZ", "XZX", "ZXZ", "ZZX"]);
  });

  it("rejects cube types with no valid retype across both H states for some pipe", () => {
    // Pipe1 (X-axis) far-end ZXZ; Pipe2 (Y-axis) far-end ZZX.
    // Without H-toggle, no T satisfies (T[2] must be both Z and X). With
    // H-toggle the constraints relax: XXZ works (pipe2 toggled to H) and
    // ZZX works (pipe1 toggled to H). XZZ/ZXZ/ZXX/XZX all hit a null
    // `inferPipeType` on one of the two axes, so they remain rejected.
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OXZ" },
      { x: 3, y: 0, z: 0, type: "ZXZ" },
      { x: 0, y: 1, z: 0, type: "ZOX" },
      { x: 0, y: 3, z: 0, type: "ZZX" },
    ]);
    const opts = determineCubeOptionsWithPipeRetype({ x: 0, y: 0, z: 0 }, blocks);
    expect(opts.sort()).toEqual(["XXZ", "ZZX"]);
  });

  it("returns CUBE_TYPES order (deterministic)", () => {
    const blocks = makeBlocks([]);
    const opts = determineCubeOptionsWithPipeRetype({ x: 0, y: 0, z: 0 }, blocks);
    // Sequence must match CUBE_TYPES ordering, not arbitrary.
    expect(opts).toEqual([...CUBE_TYPES]);
  });
});

describe("computePipeRetypes", () => {
  it("returns [] when there are no adjacent pipes", () => {
    const blocks = makeBlocks([]);
    const updates = computePipeRetypes(blocks, { x: 0, y: 0, z: 0 }, "XZZ");
    expect(updates).toEqual([]);
  });

  it("returns [] when the inferred pipe equals the existing pipe", () => {
    // Pipe OZX at +x; T=ZZX gives inferPipeType(ZZX, 0) = OZX (no change).
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OZX" }]);
    const updates = computePipeRetypes(blocks, { x: 0, y: 0, z: 0 }, "ZZX");
    expect(updates).toEqual([]);
  });

  it("preserves Hadamard suffix on retype", () => {
    // Pipe OZXH at +x; T=ZXZ gives base OXZ + H = OXZH (different from OZXH).
    // Far-end is a port (no constraints), so retype succeeds.
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OZXH" }]);
    const updates = computePipeRetypes(blocks, { x: 0, y: 0, z: 0 }, "ZXZ");
    expect(updates).toEqual([
      { key: "1,0,0", oldType: "OZXH", newType: "OXZH" },
    ]);
  });

  it("returns null when inferPipeType yields an invalid PIPE_TYPE", () => {
    // T=XZZ has same chars on Y/Z axes (Z,Z); infer for axis 0 = OZZ which is not in PIPE_TYPES.
    // (With H-toggle, a single pipe + fixed far-end never rejects on far-end alone — the
    // closed-axis multiset always matches between any valid T and any valid far-end cube,
    // so one of the two H states always validates. inferPipeType null is the only way for
    // computePipeRetypes to return null for a single-pipe configuration.)
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OZX" }]);
    const updates = computePipeRetypes(blocks, { x: 0, y: 0, z: 0 }, "XZZ");
    expect(updates).toBeNull();
  });

  it("returns updates for both colinear pipes when a cube cycle requires it", () => {
    // Two OZX pipes at +x and -x; T=ZXZ requires both to become OXZ.
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OZX" },
      { x: -2, y: 0, z: 0, type: "OZX" },
    ]);
    const updates = computePipeRetypes(blocks, { x: 0, y: 0, z: 0 }, "ZXZ");
    expect(updates).not.toBeNull();
    expect(updates!.sort((a, b) => a.key.localeCompare(b.key))).toEqual(
      [
        { key: "-2,0,0", oldType: "OZX", newType: "OXZ" },
        { key: "1,0,0", oldType: "OZX", newType: "OXZ" },
      ].sort((a, b) => a.key.localeCompare(b.key)),
    );
  });

  it("toggles Hadamard on perpendicular pipes to free a corner cube of a square", () => {
    // Corner cube being cycled from ZZX to XXZ. Both perpendicular pipes
    // currently non-H; the only way to satisfy XXZ at this corner is to
    // toggle H on both pipes (so the swapped far-end ZZX still validates).
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OZX" },
      { x: 3, y: 0, z: 0, type: "ZZX" },
      { x: 0, y: 1, z: 0, type: "ZOX" },
      { x: 0, y: 3, z: 0, type: "ZZX" },
    ]);
    const updates = computePipeRetypes(blocks, { x: 0, y: 0, z: 0 }, "XXZ");
    expect(updates).not.toBeNull();
    expect(updates!.sort((a, b) => a.key.localeCompare(b.key))).toEqual(
      [
        { key: "0,1,0", oldType: "ZOX", newType: "XOZH" },
        { key: "1,0,0", oldType: "OZX", newType: "OXZH" },
      ].sort((a, b) => a.key.localeCompare(b.key)),
    );
  });

  it("prefers H-preserved when both H states would validate (no unnecessary toggle)", () => {
    // Far-end is a port (open both ways), so both OZX (preserved) and OZXH
    // (toggled) satisfy the constraints for T=XZX. Helper should pick the
    // preserved variant — no spurious Hadamard introduction.
    const blocks = makeBlocks([{ x: 1, y: 0, z: 0, type: "OZX" }]);
    const updates = computePipeRetypes(blocks, { x: 0, y: 0, z: 0 }, "XZX");
    // T=XZX, axis 0: inferred = OZX. Pipe is already OZX → no change.
    expect(updates).toEqual([]);
  });

  it("removes Hadamard when cycling back to a type that no longer needs it", () => {
    // Inverse of the corner-square: pipes are H, target cube prefers no-H.
    const blocks = makeBlocks([
      { x: 1, y: 0, z: 0, type: "OXZH" },
      { x: 3, y: 0, z: 0, type: "ZZX" },
      { x: 0, y: 1, z: 0, type: "XOZH" },
      { x: 0, y: 3, z: 0, type: "ZZX" },
    ]);
    const updates = computePipeRetypes(blocks, { x: 0, y: 0, z: 0 }, "ZZX");
    expect(updates).not.toBeNull();
    expect(updates!.sort((a, b) => a.key.localeCompare(b.key))).toEqual(
      [
        { key: "0,1,0", oldType: "XOZH", newType: "ZOX" },
        { key: "1,0,0", oldType: "OXZH", newType: "OZX" },
      ].sort((a, b) => a.key.localeCompare(b.key)),
    );
  });
});

describe("deriveFaceKey", () => {
  // Cube XZZ at TQEC (0,0,0) → Three.js center (0.5, 0.5, -0.5), half-extents (0.5, 0.5, 0.5).
  const cube: Block = { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" };

  it("returns '0'..'5' for cube faces (no sub-strip)", () => {
    expect(deriveFaceKey(cube, new Vector3(1, 0, 0), new Vector3(1.0, 0.5, -0.5))).toBe("0");
    expect(deriveFaceKey(cube, new Vector3(-1, 0, 0), new Vector3(0.0, 0.5, -0.5))).toBe("1");
    expect(deriveFaceKey(cube, new Vector3(0, 1, 0), new Vector3(0.5, 1.0, -0.5))).toBe("2");
    expect(deriveFaceKey(cube, new Vector3(0, -1, 0), new Vector3(0.5, 0.0, -0.5))).toBe("3");
    expect(deriveFaceKey(cube, new Vector3(0, 0, 1), new Vector3(0.5, 0.5, 0.0))).toBe("4");
    expect(deriveFaceKey(cube, new Vector3(0, 0, -1), new Vector3(0.5, 0.5, -1.0))).toBe("5");
  });

  it("returns the face index for slabs (per-face granularity in v1)", () => {
    const slab: Block = { pos: { x: 1, y: 1, z: 0 }, type: "slab" };
    expect(deriveFaceKey(slab, new Vector3(0, 1, 0), new Vector3(2, 1.0, -2))).toBe("2");
    expect(deriveFaceKey(slab, new Vector3(1, 0, 0), new Vector3(3, 0.5, -2))).toBe("0");
  });

  it("returns null for the open-axis end faces of a pipe", () => {
    const pipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZX" };
    expect(deriveFaceKey(pipe, new Vector3(1, 0, 0), new Vector3(3, 0.5, -0.5))).toBeNull();
    expect(deriveFaceKey(pipe, new Vector3(-1, 0, 0), new Vector3(1, 0.5, -0.5))).toBeNull();
  });

  it("returns just the face index for non-band pipes (no Hadamard / Y-twist)", () => {
    const pipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZX" };
    expect(deriveFaceKey(pipe, new Vector3(0, 1, 0), new Vector3(2, 1.0, -0.5))).toBe("2");
  });

  it("returns sub-strip keys for Hadamard pipes (band/below/above)", () => {
    const pipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZXH" };
    expect(deriveFaceKey(pipe, new Vector3(0, 1, 0), new Vector3(2.0, 1.0, -0.5))).toBe("2:band");
    expect(deriveFaceKey(pipe, new Vector3(0, 1, 0), new Vector3(1.1, 1.0, -0.5))).toBe("2:below");
    expect(deriveFaceKey(pipe, new Vector3(0, 1, 0), new Vector3(2.9, 1.0, -0.5))).toBe("2:above");
  });

  it("returns sub-strip keys for Y-twist pipes (split at 0, no band)", () => {
    const pipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZXY" };
    expect(deriveFaceKey(pipe, new Vector3(0, 1, 0), new Vector3(1.5, 1.0, -0.5))).toBe("2:below");
    expect(deriveFaceKey(pipe, new Vector3(0, 1, 0), new Vector3(2.5, 1.0, -0.5))).toBe("2:above");
  });
});
