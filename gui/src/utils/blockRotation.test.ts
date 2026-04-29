import { describe, expect, it } from "vitest";
import {
  ROT_Z_CCW,
  ROT_Z_CW,
  rotateBlockAroundZ,
  rotateBlockKind,
  rotatePositionAroundZ,
} from "./blockRotation";
import type { Block, Position3D } from "../types";

const origin: Position3D = { x: 0, y: 0, z: 0 };

describe("rotateBlockKind — 90° Z rotation", () => {
  it("swaps X/Y basis chars in cube kinds", () => {
    expect(rotateBlockKind("XZZ", ROT_Z_CCW)).toBe("ZXZ");
    expect(rotateBlockKind("ZXZ", ROT_Z_CCW)).toBe("XZZ");
    expect(rotateBlockKind("ZXX", ROT_Z_CCW)).toBe("XZX");
    // Cubes where the first two basis chars already match are Z-rotation invariant.
    expect(rotateBlockKind("XXZ", ROT_Z_CCW)).toBe("XXZ");
    expect(rotateBlockKind("ZZX", ROT_Z_CCW)).toBe("ZZX");
  });

  it("CCW and CW produce the same kind name (differ only in position)", () => {
    expect(rotateBlockKind("XZZ", ROT_Z_CCW)).toBe(rotateBlockKind("XZZ", ROT_Z_CW));
  });

  it("swaps O between first two positions for pipes", () => {
    expect(rotateBlockKind("OZX", ROT_Z_CCW)).toBe("ZOX");
    expect(rotateBlockKind("OXZ", ROT_Z_CCW)).toBe("XOZ");
    expect(rotateBlockKind("ZOX", ROT_Z_CCW)).toBe("OZX");
  });

  it("preserves the Hadamard suffix", () => {
    expect(rotateBlockKind("OZXH", ROT_Z_CCW)).toBe("ZOXH");
    expect(rotateBlockKind("XOZH", ROT_Z_CCW)).toBe("OXZH");
  });

  it("preserves the Y-twist suffix", () => {
    expect(rotateBlockKind("OZXY", ROT_Z_CCW)).toBe("ZOXY");
    expect(rotateBlockKind("XOZY", ROT_Z_CCW)).toBe("OXZY");
    expect(rotateBlockKind("ZXOY", ROT_Z_CCW)).toBe("XZOY");
  });

  it("leaves Y blocks unchanged (Z rotation is legal)", () => {
    expect(rotateBlockKind("Y", ROT_Z_CCW)).toBe("Y");
    expect(rotateBlockKind("Y", ROT_Z_CW)).toBe("Y");
  });
});

describe("rotatePositionAroundZ", () => {
  it("rotates cubes 90° CCW around origin", () => {
    expect(rotatePositionAroundZ({ x: 3, y: 0, z: 0 }, origin, "ccw", false)).toEqual({ x: 0, y: 3, z: 0 });
    expect(rotatePositionAroundZ({ x: 0, y: 3, z: 0 }, origin, "ccw", false)).toEqual({ x: -3, y: 0, z: 0 });
  });

  it("rotates cubes 90° CW as the inverse of CCW", () => {
    const p = { x: 3, y: 6, z: 0 };
    const ccw = rotatePositionAroundZ(p, origin, "ccw", false);
    const back = rotatePositionAroundZ(ccw, origin, "cw", false);
    expect(back).toEqual(p);
  });

  it("canonicalizes pipe coord that lands at ≡ 2 (mod 3) after rotation", () => {
    // Pipe at (0, 1, 0) (Y-axis pipe, slot coord on y) rotated CCW around origin
    // lands at (-1, 0, 0) which has x mod 3 === 2; canonicalize to (-2, 0, 0).
    const rotated = rotatePositionAroundZ({ x: 0, y: 1, z: 0 }, origin, "ccw", true);
    expect(rotated).toEqual({ x: -2, y: 0, z: 0 });
  });

  it("canonicalizes a pipe rotated from the -y side to +x (coord 2 → 1)", () => {
    // Pipe at (0, -2, 0) → CCW around origin → (2, 0, 0). Canonicalize to (1, 0, 0).
    const rotated = rotatePositionAroundZ({ x: 0, y: -2, z: 0 }, origin, "ccw", true);
    expect(rotated).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("preserves z (pure Z-axis rotation)", () => {
    const p = { x: 3, y: 3, z: 9 };
    expect(rotatePositionAroundZ(p, origin, "ccw", false).z).toBe(9);
  });
});

describe("rotateBlockAroundZ", () => {
  it("rotates a cube position + type around a pivot", () => {
    const block: Block = { pos: { x: 3, y: 0, z: 0 }, type: "XZZ" };
    const rotated = rotateBlockAroundZ(block, origin, "ccw");
    expect(rotated.pos).toEqual({ x: 0, y: 3, z: 0 });
    expect(rotated.type).toBe("ZXZ");
  });

  it("four CCW rotations is identity on a cube-plus-pipe pair", () => {
    const cube: Block = { pos: { x: 3, y: 0, z: 0 }, type: "XZZ" };
    const pipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZX" };
    const rotate4 = (b: Block): Block => {
      let cur = b;
      for (let i = 0; i < 4; i++) cur = rotateBlockAroundZ(cur, origin, "ccw");
      return cur;
    };
    expect(rotate4(cube)).toEqual(cube);
    expect(rotate4(pipe)).toEqual(pipe);
  });

  it("CCW ∘ CW = identity on a pipe", () => {
    const pipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZX" };
    const ccw = rotateBlockAroundZ(pipe, origin, "ccw");
    const back = rotateBlockAroundZ(ccw, origin, "cw");
    expect(back).toEqual(pipe);
  });

  it("rotates a Y block without changing its type", () => {
    const y: Block = { pos: { x: 0, y: 3, z: 0 }, type: "Y" };
    const rotated = rotateBlockAroundZ(y, origin, "ccw");
    expect(rotated.type).toBe("Y");
    expect(rotated.pos).toEqual({ x: -3, y: 0, z: 0 });
  });

  it("flips Hadamard direction when a pipe rotates into a negative axis", () => {
    // OZXH is an X-axis pipe with Hadamard. Under CW rotation around Z, the
    // X basis maps to -Y, so the pipe is now a Y-axis pipe pointing -Y.
    // rotateBlockKind first produces ZOXH (same name as CCW, since the
    // matrix-abs convention is direction-agnostic); then
    // adjustHadamardDirection maps ZOXH → XOZH via HDM_INVERSE.
    const pipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZXH" };
    const rotated = rotateBlockAroundZ(pipe, origin, "cw");
    expect(rotated.type).toBe("XOZH");
  });

  it("flips Y-twist direction when a pipe rotates into a negative axis", () => {
    // Same direction-canonicalisation as Hadamard, but for Y-twist pipes.
    const pipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZXY" };
    const rotated = rotateBlockAroundZ(pipe, origin, "cw");
    expect(rotated.type).toBe("XOZY");
  });

  it("rotates around a non-origin pivot correctly", () => {
    const block: Block = { pos: { x: 6, y: 3, z: 0 }, type: "XZZ" };
    const pivot: Position3D = { x: 3, y: 3, z: 0 };
    // Relative (3, 0). CCW → (0, 3). Absolute → (3, 6).
    const rotated = rotateBlockAroundZ(block, pivot, "ccw");
    expect(rotated.pos).toEqual({ x: 3, y: 6, z: 0 });
  });
});

describe("ROT_Z_CCW / ROT_Z_CW", () => {
  it("are transposes of each other", () => {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(ROT_Z_CCW[i][j]).toBe(ROT_Z_CW[j][i]);
      }
    }
  });
});
