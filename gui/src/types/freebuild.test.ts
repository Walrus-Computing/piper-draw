import { describe, expect, it } from "vitest";
import {
  createBlockGeometry,
  createYDefectEdges,
  blockTqecSize,
  isFreeBuildBlock,
  isFreeBuildPipeSpec,
  isPipeType,
  isValidPos,
  flipBlockType,
  blockTypeCacheKey,
  H_COLOR,
  X_COLOR,
  Z_COLOR,
  FB_PRESETS,
} from "./index";
import type { Block, BlockType, FreeBuildPipeSpec } from "./index";

const Z_OPEN_SPEC: FreeBuildPipeSpec = {
  kind: "fb-pipe",
  openAxis: 2,
  baseAtStart: "Z",
  baseAtEnd: "X",
  defectPositions: [0.5],
};

const X_OPEN_SPEC: FreeBuildPipeSpec = {
  kind: "fb-pipe",
  openAxis: 0,
  baseAtStart: "Z",
  baseAtEnd: "X",
  defectPositions: [0.5],
};

const Y_OPEN_SPEC: FreeBuildPipeSpec = {
  kind: "fb-pipe",
  openAxis: 1,
  baseAtStart: "Z",
  baseAtEnd: "X",
  defectPositions: [0.5],
};

describe("isFreeBuildBlock / isFreeBuildPipeSpec", () => {
  it("recognizes FB pipe blocks", () => {
    const fb: Block = { pos: { x: 0, y: 0, z: 1 }, type: Z_OPEN_SPEC };
    expect(isFreeBuildBlock(fb)).toBe(true);
  });

  it("returns false for TQEC blocks", () => {
    const tqec: Block = { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" };
    expect(isFreeBuildBlock(tqec)).toBe(false);
  });

  it("FB specs are not detected by isPipeType (which is TQEC-string-only)", () => {
    expect(isPipeType(Z_OPEN_SPEC)).toBe(false);
    expect(isFreeBuildPipeSpec(Z_OPEN_SPEC)).toBe(true);
  });
});

describe("blockTqecSize for FB pipes", () => {
  it("X-open FB pipe = [2, 1, 1]", () => {
    expect(blockTqecSize(X_OPEN_SPEC)).toEqual([2, 1, 1]);
  });
  it("Y-open FB pipe = [1, 2, 1]", () => {
    expect(blockTqecSize(Y_OPEN_SPEC)).toEqual([1, 2, 1]);
  });
  it("Z-open FB pipe = [1, 1, 2]", () => {
    expect(blockTqecSize(Z_OPEN_SPEC)).toEqual([1, 1, 2]);
  });
});

describe("isValidPos for FB pipes", () => {
  it("accepts a valid pipe slot position", () => {
    // Z-open pipe slot: z ≡ 1 mod 3, x and y ≡ 0 mod 3
    expect(isValidPos({ x: 0, y: 0, z: 1 }, Z_OPEN_SPEC)).toBe(true);
  });
  it("rejects a non-pipe-slot position", () => {
    expect(isValidPos({ x: 0, y: 0, z: 0 }, Z_OPEN_SPEC)).toBe(false);
  });
});

describe("createBlockGeometry for FB pipes", () => {
  function vertexColors(geo: ReturnType<typeof createBlockGeometry>): { r: number; g: number; b: number }[] {
    const arr = geo.getAttribute("color").array as Float32Array;
    const out: { r: number; g: number; b: number }[] = [];
    for (let i = 0; i < arr.length; i += 3) out.push({ r: arr[i], g: arr[i + 1], b: arr[i + 2] });
    return out;
  }

  it("emits no yellow (H_COLOR) vertices — FB has no Hadamard band", () => {
    const geo = createBlockGeometry(Z_OPEN_SPEC);
    const colors = vertexColors(geo);
    for (const c of colors) {
      // Yellow Hadamard band would be (H_COLOR.r, H_COLOR.g, H_COLOR.b).
      const isYellow =
        Math.abs(c.r - H_COLOR.r) < 1e-6 &&
        Math.abs(c.g - H_COLOR.g) < 1e-6 &&
        Math.abs(c.b - H_COLOR.b) < 1e-6;
      expect(isYellow).toBe(false);
    }
  });

  it("contains both X_COLOR and Z_COLOR vertices (color swap at midpoint)", () => {
    const geo = createBlockGeometry(Z_OPEN_SPEC);
    const colors = vertexColors(geo);
    const sameAs = (a: { r: number; g: number; b: number }, c: typeof X_COLOR) =>
      Math.abs(a.r - c.r) < 1e-6 && Math.abs(a.g - c.g) < 1e-6 && Math.abs(a.b - c.b) < 1e-6;
    expect(colors.some((c) => sameAs(c, X_COLOR))).toBe(true);
    expect(colors.some((c) => sameAs(c, Z_COLOR))).toBe(true);
  });
});

describe("createYDefectEdges for FB pipes", () => {
  function edgeCount(geo: ReturnType<typeof createYDefectEdges>): number {
    const arr = geo.getAttribute("position").array as Float32Array;
    return arr.length / 6;
  }

  it("FB pipe with one defect emits 4 corner edges + 4 ring segments = 8", () => {
    expect(edgeCount(createYDefectEdges(Z_OPEN_SPEC))).toBe(8);
    expect(edgeCount(createYDefectEdges(X_OPEN_SPEC))).toBe(8);
    expect(edgeCount(createYDefectEdges(Y_OPEN_SPEC))).toBe(8);
  });

  it("FB pipe with no defects emits only the 4 corner edges (no ring)", () => {
    const noDefects: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, defectPositions: [] };
    expect(edgeCount(createYDefectEdges(noDefects))).toBe(4);
  });

  it("FB pipe with two defects emits 4 corners + 2 rings × 4 = 12", () => {
    const twoDefects: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, defectPositions: [0.33, 0.67] };
    expect(edgeCount(createYDefectEdges(twoDefects))).toBe(12);
  });
});

describe("flipBlockType on FB pipes", () => {
  it("swaps baseAtStart and baseAtEnd between X and Z, leaving defects unchanged", () => {
    const flipped = flipBlockType(Z_OPEN_SPEC) as FreeBuildPipeSpec;
    expect(flipped.kind).toBe("fb-pipe");
    expect(flipped.baseAtStart).toBe("X");
    expect(flipped.baseAtEnd).toBe("Z");
    expect(flipped.defectPositions).toEqual([0.5]);
    expect(flipped.openAxis).toBe(2);
  });

  it("is an involution on FB pipes (flip twice = original)", () => {
    const once = flipBlockType(Z_OPEN_SPEC) as FreeBuildPipeSpec;
    const twice = flipBlockType(once) as FreeBuildPipeSpec;
    expect(twice.baseAtStart).toBe(Z_OPEN_SPEC.baseAtStart);
    expect(twice.baseAtEnd).toBe(Z_OPEN_SPEC.baseAtEnd);
  });
});

describe("blockTypeCacheKey", () => {
  it("returns the string itself for TQEC types", () => {
    expect(blockTypeCacheKey("OZX" as BlockType)).toBe("OZX");
    expect(blockTypeCacheKey("Y" as BlockType)).toBe("Y");
  });

  it("returns a deterministic content-based key for FB specs", () => {
    expect(blockTypeCacheKey(Z_OPEN_SPEC)).toBe("fb:2|Z|X|0.5");
    expect(blockTypeCacheKey(X_OPEN_SPEC)).toBe("fb:0|Z|X|0.5");
  });

  it("two structurally equal specs produce the same key", () => {
    const a: FreeBuildPipeSpec = { ...Z_OPEN_SPEC };
    const b: FreeBuildPipeSpec = { ...Z_OPEN_SPEC };
    expect(blockTypeCacheKey(a)).toBe(blockTypeCacheKey(b));
  });
});

describe("FB_PRESETS", () => {
  it("ships exactly two presets in v1", () => {
    expect(FB_PRESETS).toHaveLength(2);
  });

  it("all presets have a single Y defect at 0.5", () => {
    for (const p of FB_PRESETS) {
      expect(p.spec.kind).toBe("fb-pipe");
      expect(p.spec.defectPositions).toEqual([0.5]);
    }
  });

  it("the two presets are color-swap mirrors of each other (Z→X and X→Z)", () => {
    const zx = FB_PRESETS.find((p) => p.id === "swap-zx");
    const xz = FB_PRESETS.find((p) => p.id === "swap-xz");
    expect(zx).toBeDefined();
    expect(xz).toBeDefined();
    expect(zx!.spec.baseAtStart).toBe("Z");
    expect(zx!.spec.baseAtEnd).toBe("X");
    expect(xz!.spec.baseAtStart).toBe("X");
    expect(xz!.spec.baseAtEnd).toBe("Z");
  });
});
