import { describe, expect, it } from "vitest";
import { createBlockGeometry, getHiddenFaceMaskForPos, FACE_NEG_Y, FACE_NEG_Z, FACE_POS_Y, FACE_POS_Z, isValidPipePos, isValidPos, isValidBlockPos, pipeAxisFromPos, resolvePipeType, getAdjacentPos, snapGroundPos } from "./index";
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
