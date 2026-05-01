import { describe, expect, it } from "vitest";
import {
  MATRICES,
  ROT_X_180,
  ROT_X_CCW,
  ROT_X_CW,
  ROT_Y_180,
  ROT_Y_CCW,
  ROT_Y_CW,
  ROT_Z_180,
  ROT_Z_CCW,
  ROT_Z_CW,
  rotateBlockAroundAxis,
  rotateBlockAroundZ,
  rotateBlockKind,
  rotateFaceKeyedRecordAroundZ,
  rotatePositionAroundAxis,
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

describe("rotateBlockKind — 90° X rotation", () => {
  it("rotates cube types correctly under X CCW (Y/Z columns swap)", () => {
    expect(rotateBlockKind("XZX", ROT_X_CCW)).toBe("XXZ");
    expect(rotateBlockKind("XXZ", ROT_X_CCW)).toBe("XZX");
    expect(rotateBlockKind("ZXZ", ROT_X_CCW)).toBe("ZZX");
    expect(rotateBlockKind("ZZX", ROT_X_CCW)).toBe("ZXZ");
    // Symmetric cubes are X-rotation invariant.
    expect(rotateBlockKind("XZZ", ROT_X_CCW)).toBe("XZZ");
    expect(rotateBlockKind("ZXX", ROT_X_CCW)).toBe("ZXX");
  });

  it("swaps O between Y- and Z-axis positions for pipes under X rotation", () => {
    expect(rotateBlockKind("ZOX", ROT_X_CCW)).toBe("ZXO");
    expect(rotateBlockKind("ZXO", ROT_X_CCW)).toBe("ZOX");
    // X-axis pipes stay X-open (just basis chars permute).
    expect(rotateBlockKind("OZX", ROT_X_CCW)).toBe("OXZ");
    expect(rotateBlockKind("OXZ", ROT_X_CCW)).toBe("OZX");
  });

  it("preserves the Hadamard suffix under X rotation", () => {
    expect(rotateBlockKind("OZXH", ROT_X_CCW)).toBe("OXZH");
    expect(rotateBlockKind("ZOXH", ROT_X_CCW)).toBe("ZXOH");
  });

  it("rejects Y blocks under X rotation", () => {
    expect(() => rotateBlockKind("Y", ROT_X_CCW)).toThrow(/can only rotate around the Z axis/);
    expect(() => rotateBlockKind("Y", ROT_X_CW)).toThrow(/can only rotate around the Z axis/);
  });
});

describe("rotateBlockKind — 90° Y rotation", () => {
  it("rotates cube types correctly under Y CCW (X/Z columns swap)", () => {
    expect(rotateBlockKind("XZZ", ROT_Y_CCW)).toBe("ZZX");
    expect(rotateBlockKind("ZZX", ROT_Y_CCW)).toBe("XZZ");
    expect(rotateBlockKind("ZXX", ROT_Y_CCW)).toBe("XXZ");
    expect(rotateBlockKind("XXZ", ROT_Y_CCW)).toBe("ZXX");
    // Symmetric cubes are Y-rotation invariant.
    expect(rotateBlockKind("ZXZ", ROT_Y_CCW)).toBe("ZXZ");
    expect(rotateBlockKind("XZX", ROT_Y_CCW)).toBe("XZX");
  });

  it("swaps O between X- and Z-axis positions for pipes under Y rotation", () => {
    expect(rotateBlockKind("OZX", ROT_Y_CCW)).toBe("XZO");
    expect(rotateBlockKind("XZO", ROT_Y_CCW)).toBe("OZX");
    // Y-axis pipes stay Y-open under Y rotation.
    expect(rotateBlockKind("ZOX", ROT_Y_CCW)).toBe("XOZ");
    expect(rotateBlockKind("XOZ", ROT_Y_CCW)).toBe("ZOX");
  });

  it("preserves the Hadamard suffix under Y rotation", () => {
    expect(rotateBlockKind("OZXH", ROT_Y_CCW)).toBe("XZOH");
    expect(rotateBlockKind("ZOXH", ROT_Y_CCW)).toBe("XOZH");
  });

  it("rejects Y blocks under Y rotation", () => {
    expect(() => rotateBlockKind("Y", ROT_Y_CCW)).toThrow(/can only rotate around the Z axis/);
    expect(() => rotateBlockKind("Y", ROT_Y_CW)).toThrow(/can only rotate around the Z axis/);
  });
});

describe("rotateBlockKind — 180° flips", () => {
  it("preserves cube type strings under flip on any axis", () => {
    // 180° matrices use abs values; basis chars are unchanged at each index.
    for (const cube of ["XZZ", "ZXZ", "ZXX", "XXZ", "ZZX", "XZX"]) {
      expect(rotateBlockKind(cube, ROT_X_180)).toBe(cube);
      expect(rotateBlockKind(cube, ROT_Y_180)).toBe(cube);
      expect(rotateBlockKind(cube, ROT_Z_180)).toBe(cube);
    }
  });

  it("preserves pipe type strings under same-axis flip", () => {
    // Flipping a pipe around its own open axis preserves its type.
    expect(rotateBlockKind("OZX", ROT_X_180)).toBe("OZX");
    expect(rotateBlockKind("ZOX", ROT_Y_180)).toBe("ZOX");
    expect(rotateBlockKind("ZXO", ROT_Z_180)).toBe("ZXO");
  });

  it("allows Y blocks under Z flip (Z direction preserved)", () => {
    expect(rotateBlockKind("Y", ROT_Z_180)).toBe("Y");
  });

  it("rejects Y blocks under X flip and Y flip (Z direction inverted)", () => {
    expect(() => rotateBlockKind("Y", ROT_X_180)).toThrow(/can only rotate around the Z axis/);
    expect(() => rotateBlockKind("Y", ROT_Y_180)).toThrow(/can only rotate around the Z axis/);
  });
});

describe("rotatePositionAroundAxis", () => {
  it("X CCW: Y → Z, Z → -Y, X fixed", () => {
    expect(rotatePositionAroundAxis({ x: 3, y: 0, z: 0 }, origin, "x", "ccw", false)).toEqual({ x: 3, y: 0, z: 0 });
    expect(rotatePositionAroundAxis({ x: 0, y: 3, z: 0 }, origin, "x", "ccw", false)).toEqual({ x: 0, y: 0, z: 3 });
    expect(rotatePositionAroundAxis({ x: 0, y: 0, z: 3 }, origin, "x", "ccw", false)).toEqual({ x: 0, y: -3, z: 0 });
  });

  it("Y CCW: Z → X, X → -Z, Y fixed", () => {
    expect(rotatePositionAroundAxis({ x: 0, y: 3, z: 0 }, origin, "y", "ccw", false)).toEqual({ x: 0, y: 3, z: 0 });
    expect(rotatePositionAroundAxis({ x: 0, y: 0, z: 3 }, origin, "y", "ccw", false)).toEqual({ x: 3, y: 0, z: 0 });
    expect(rotatePositionAroundAxis({ x: 3, y: 0, z: 0 }, origin, "y", "ccw", false)).toEqual({ x: 0, y: 0, z: -3 });
  });

  it("four CCW around X = identity for cube positions", () => {
    let p: Position3D = { x: 3, y: 6, z: 9 };
    for (let i = 0; i < 4; i++) p = rotatePositionAroundAxis(p, origin, "x", "ccw", false);
    expect(p).toEqual({ x: 3, y: 6, z: 9 });
  });

  it("four CCW around Y = identity for cube positions", () => {
    let p: Position3D = { x: 3, y: 6, z: 9 };
    for (let i = 0; i < 4; i++) p = rotatePositionAroundAxis(p, origin, "y", "ccw", false);
    expect(p).toEqual({ x: 3, y: 6, z: 9 });
  });

  it("canonicalizes pipe Y-coord under X CCW (z=1 → y=-1 → y=-2)", () => {
    // Z-axis pipe at (0, 0, 1) → X CCW about origin → (0, -1, 0). y=-1 ≡ 2 mod 3 → canonicalize to -2.
    expect(rotatePositionAroundAxis({ x: 0, y: 0, z: 1 }, origin, "x", "ccw", true)).toEqual({ x: 0, y: -2, z: 0 });
  });

  it("does not canonicalize cube positions (only pipes)", () => {
    expect(rotatePositionAroundAxis({ x: 0, y: 0, z: 1 }, origin, "x", "ccw", false)).toEqual({ x: 0, y: -1, z: 0 });
  });

  it("canonicalizes pipe X-coord under Y CCW (x=1 → z=-1 → z=-2)", () => {
    // X-axis pipe at (1, 0, 0) → Y CCW about origin → (0, 0, -1). z=-1 ≡ 2 mod 3 → canonicalize to -2.
    expect(rotatePositionAroundAxis({ x: 1, y: 0, z: 0 }, origin, "y", "ccw", true)).toEqual({ x: 0, y: 0, z: -2 });
  });

  it("180° flip around X: leaves X fixed, negates Y and Z", () => {
    expect(rotatePositionAroundAxis({ x: 3, y: 6, z: 9 }, origin, "x", "flip", false)).toEqual({ x: 3, y: -6, z: -9 });
  });

  it("180° flip canonicalizes both non-axis pipe coords when needed", () => {
    // Pipe at (3, 1, 0) flipped around X about origin → (3, -1, 0). y=-1 ≡ 2 mod 3 → canonicalize to -2.
    expect(rotatePositionAroundAxis({ x: 3, y: 1, z: 0 }, origin, "x", "flip", true)).toEqual({ x: 3, y: -2, z: 0 });
  });

  it("two flips around any axis = identity", () => {
    const p: Position3D = { x: 6, y: 3, z: 9 };
    for (const axis of ["x", "y", "z"] as const) {
      const once = rotatePositionAroundAxis(p, origin, axis, "flip", false);
      const twice = rotatePositionAroundAxis(once, origin, axis, "flip", false);
      expect(twice).toEqual(p);
    }
  });
});

describe("rotateBlockAroundAxis", () => {
  it("rotates a cube around X with type and position both transformed", () => {
    const block: Block = { pos: { x: 0, y: 3, z: 0 }, type: "XZX" };
    const rotated = rotateBlockAroundAxis(block, origin, "x", "ccw");
    expect(rotated.pos).toEqual({ x: 0, y: 0, z: 3 });
    expect(rotated.type).toBe("XXZ");
  });

  it("four CCW rotations around X = identity for a cube + pipe pair", () => {
    const cube: Block = { pos: { x: 0, y: 3, z: 0 }, type: "XZZ" };
    const pipe: Block = { pos: { x: 0, y: 1, z: 0 }, type: "ZOX" };
    const rotate4 = (b: Block, axis: "x" | "y" | "z"): Block => {
      let cur = b;
      for (let i = 0; i < 4; i++) cur = rotateBlockAroundAxis(cur, origin, axis, "ccw");
      return cur;
    };
    expect(rotate4(cube, "x")).toEqual(cube);
    expect(rotate4(pipe, "x")).toEqual(pipe);
  });

  it("two flips around any axis = identity for a cube + pipe pair", () => {
    const cube: Block = { pos: { x: 3, y: 6, z: 9 }, type: "XZZ" };
    const pipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZX" };
    for (const axis of ["x", "y", "z"] as const) {
      const onceCube = rotateBlockAroundAxis(cube, origin, axis, "flip");
      const twiceCube = rotateBlockAroundAxis(onceCube, origin, axis, "flip");
      expect(twiceCube).toEqual(cube);
      const oncePipe = rotateBlockAroundAxis(pipe, origin, axis, "flip");
      const twicePipe = rotateBlockAroundAxis(oncePipe, origin, axis, "flip");
      expect(twicePipe).toEqual(pipe);
    }
  });

  it("flips Hadamard direction under X flip (ZOXH at -Y → XOZH at +Y)", () => {
    // ZOXH is a Y-axis Hadamard pipe. X flip negates Y, so the pipe now points in
    // -Y; rotateBlockKind first produces ZOXH (abs-magnitude), then
    // adjustHadamardDirection swaps to its +Y equivalent XOZH.
    const pipe: Block = { pos: { x: 0, y: 1, z: 0 }, type: "ZOXH" };
    const rotated = rotateBlockAroundAxis(pipe, origin, "x", "flip");
    expect(rotated.type).toBe("XOZH");
  });

  it("flips Hadamard direction under Y flip (ZXOH at +Z → XZOH at -Z)", () => {
    // ZXOH is a Z-axis Hadamard pipe. Y flip negates Z, so the new pipe points
    // -Z and adjustHadamardDirection swaps via HDM_INVERSE: ZXOH → XZOH.
    const pipe: Block = { pos: { x: 0, y: 0, z: 1 }, type: "ZXOH" };
    const rotated = rotateBlockAroundAxis(pipe, origin, "y", "flip");
    expect(rotated.type).toBe("XZOH");
  });

  it("flips Hadamard direction under Z flip (OZXH at +X → OXZH at -X)", () => {
    // OZXH is an X-axis Hadamard pipe. Z flip negates X (Z stays positive), so
    // the new pipe points -X and adjustHadamardDirection swaps via HDM_INVERSE:
    // OZXH → OXZH.
    const pipe: Block = { pos: { x: 1, y: 0, z: 0 }, type: "OZXH" };
    const rotated = rotateBlockAroundAxis(pipe, origin, "z", "flip");
    expect(rotated.type).toBe("OXZH");
  });

  it("rejects rotation of Y blocks around X / Y axes", () => {
    const y: Block = { pos: { x: 0, y: 0, z: 0 }, type: "Y" };
    expect(() => rotateBlockAroundAxis(y, origin, "x", "ccw")).toThrow(/can only rotate around the Z axis/);
    expect(() => rotateBlockAroundAxis(y, origin, "y", "cw")).toThrow(/can only rotate around the Z axis/);
    expect(() => rotateBlockAroundAxis(y, origin, "x", "flip")).toThrow(/can only rotate around the Z axis/);
    expect(() => rotateBlockAroundAxis(y, origin, "y", "flip")).toThrow(/can only rotate around the Z axis/);
  });

  it("allows Y blocks under Z rotation and Z flip", () => {
    const y: Block = { pos: { x: 0, y: 3, z: 0 }, type: "Y" };
    expect(rotateBlockAroundAxis(y, origin, "z", "ccw").type).toBe("Y");
    expect(rotateBlockAroundAxis(y, origin, "z", "flip").type).toBe("Y");
  });
});

describe("MATRICES table", () => {
  it("has every (axis, operation) entry", () => {
    for (const axis of ["x", "y", "z"] as const) {
      for (const op of ["ccw", "cw", "flip"] as const) {
        expect(MATRICES[axis][op]).toBeDefined();
        expect(MATRICES[axis][op].length).toBe(3);
      }
    }
  });

  it("ccw and cw matrices are inverses (transposes)", () => {
    for (const axis of ["x", "y", "z"] as const) {
      const ccw = MATRICES[axis].ccw;
      const cw = MATRICES[axis].cw;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(ccw[i][j]).toBe(cw[j][i]);
        }
      }
    }
  });
});

describe("rotateFaceKeyedRecordAroundZ — generic face-keyed annotations", () => {
  it("permutes cube face indices CCW: 0→5, 1→4, 4→0, 5→1; Y faces (2,3) invariant", () => {
    const marks: Record<string, "X" | "Z"> = { "0": "X", "1": "Z", "2": "X", "3": "Z", "4": "X", "5": "Z" };
    const rotated = rotateFaceKeyedRecordAroundZ(marks, "XZZ", "ccw");
    expect(rotated).toEqual({ "5": "X", "4": "Z", "2": "X", "3": "Z", "0": "X", "1": "Z" });
  });

  it("permutes cube face indices CW: 0→4, 1→5, 4→1, 5→0", () => {
    const marks: Record<string, "X" | "Z"> = { "0": "X", "1": "X", "4": "Z", "5": "Z" };
    const rotated = rotateFaceKeyedRecordAroundZ(marks, "XZZ", "cw");
    expect(rotated).toEqual({ "4": "X", "5": "X", "1": "Z", "0": "Z" });
  });

  it("preserves value type T (works for paint colors as well as basis tags)", () => {
    const colors: Record<string, string> = { "0": "#ff0000", "1": "#00ff00" };
    const rotated = rotateFaceKeyedRecordAroundZ(colors, "XZZ", "ccw");
    expect(rotated).toEqual({ "5": "#ff0000", "4": "#00ff00" });
  });

  it("flips Hadamard below↔above on the open-axis when the open axis is X (TQEC X = Three.js X, threeOpen=0)", () => {
    // OZXH: X-open Hadamard pipe. Under CCW (TQEC X→Y, threeOpen=0 → flips).
    // The wall faces (not on the open axis) are Y/Z faces and -Y/-Z faces;
    // their below/above suffix tracks the open-axis position, which flips.
    const marks: Record<string, "X" | "Z"> = { "2:below": "X", "3:above": "Z" };
    const rotated = rotateFaceKeyedRecordAroundZ(marks, "OZXH", "ccw");
    // Face indices 2,3 are Y faces, invariant under Z-rotation. Strip flips.
    expect(rotated).toEqual({ "2:above": "X", "3:below": "Z" });
  });

  it("does NOT flip below/above on a vertical (Y-open) pipe under Z-rotation", () => {
    // ZXOH: Z-open in TQEC, which maps to Y-open in Three.js (threeOpen=1).
    // Vertical pipes are rotation-invariant for the strip suffix.
    const marks: Record<string, "X" | "Z"> = { "0:below": "X", "1:above": "Z" };
    const rotated = rotateFaceKeyedRecordAroundZ(marks, "ZXOH", "ccw");
    // Faces 0,1 (X faces) under CCW Z-rotation: 0→5, 1→4. Strips unchanged.
    expect(rotated).toEqual({ "5:below": "X", "4:above": "Z" });
  });

  it("flips Y-twist below↔above just like Hadamard (same open-axis convention)", () => {
    const marks: Record<string, "X" | "Z"> = { "2:below": "X", "2:above": "Z" };
    const rotated = rotateFaceKeyedRecordAroundZ(marks, "OZXY", "ccw");
    expect(rotated).toEqual({ "2:above": "X", "2:below": "Z" });
  });

  it("returns undefined for empty input", () => {
    expect(rotateFaceKeyedRecordAroundZ({}, "XZZ", "ccw")).toBeUndefined();
  });
});

describe("rotateBlockAroundZ — face-annotation propagation", () => {
  it("propagates faceCorrSurface through rotation with face-index permutation", () => {
    const block: Block = {
      pos: { x: 0, y: 0, z: 0 },
      type: "XZZ",
      faceCorrSurface: { "0": "X", "5": "Z" },
    };
    const rotated = rotateBlockAroundZ(block, origin, "ccw");
    expect(rotated.faceCorrSurface).toEqual({ "5": "X", "1": "Z" });
  });

  it("propagates faceColors and faceCorrSurface together with H/Y strip-flip semantics", () => {
    const block: Block = {
      pos: { x: 1, y: 0, z: 0 },
      type: "OZXH",
      faceColors: { "2:below": "#ff0000" },
      faceCorrSurface: { "3:above": "X" },
    };
    const rotated = rotateBlockAroundZ(block, origin, "ccw");
    // Strips flip on threeOpen=0 (X-open) under CCW.
    expect(rotated.faceColors).toEqual({ "2:above": "#ff0000" });
    expect(rotated.faceCorrSurface).toEqual({ "3:below": "X" });
  });

  it("four CCW rotations is identity on a block with marks", () => {
    const block: Block = {
      pos: { x: 3, y: 0, z: 0 },
      type: "XZZ",
      faceCorrSurface: { "0": "X", "4": "Z" },
    };
    let cur = block;
    for (let i = 0; i < 4; i++) cur = rotateBlockAroundZ(cur, origin, "ccw");
    expect(cur).toEqual(block);
  });
});
