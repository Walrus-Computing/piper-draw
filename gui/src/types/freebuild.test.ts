import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  createBlockGeometry,
  createYDefectEdges,
  blockTqecSize,
  countAttachedPipes,
  getAdjacentPos,
  getAttachedPipeKeys,
  isFreeBuildBlock,
  isFreeBuildPipeSpec,
  isPipeType,
  isValidPipePos,
  isValidPos,
  flipBlockType,
  blockTypeCacheKey,
  pipeAxisFromPos,
  pipeOpenAxisOf,
  posKey,
  H_COLOR,
  X_COLOR,
  Z_COLOR,
  FB_PRESETS,
} from "./index";
import type { Block, BlockType, FBPreset, FreeBuildPipeSpec, Position3D } from "./index";
import { resolveFBSpecFromFace, resolvePipeTypeFromFace } from "../components/BlockInstances";

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

  it("half-swap FB pipe emits 4 half-length corners + 2 ring segments = 6", () => {
    // swapAxes "first": below midpoint, ca0/ca1 differ → 4 corners on the
    // lower half. Above midpoint, both walls share the same basis → no
    // corners. Ring at the defect only crosses the swapping (ca0) walls,
    // contributing 2 segments instead of 4.
    const halfSpec: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, swapAxes: "first" };
    expect(edgeCount(createYDefectEdges(halfSpec))).toBe(6);
  });

  it("half-swap FB pipe corner segments span only the lower half of the open axis", () => {
    const halfSpec: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, swapAxes: "first" };
    const arr = createYDefectEdges(halfSpec).getAttribute("position").array as Float32Array;
    // Z_OPEN_SPEC has Three.js openAxis = 1 (Y). Corner edges are the first 4
    // line segments; ring segments come last. Each segment is two 3-vec verts.
    // For a half-swap pipe, corner segments must run from the negative-Y end
    // to the midpoint (Y = 0), not all the way across.
    for (let i = 0; i < 4; i++) {
      const y0 = arr[i * 6 + 1];
      const y1 = arr[i * 6 + 4];
      const yMin = Math.min(y0, y1);
      const yMax = Math.max(y0, y1);
      expect(yMin).toBeLessThan(0);
      expect(yMax).toBeCloseTo(0, 6);
    }
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
    expect(blockTypeCacheKey(Z_OPEN_SPEC)).toBe("fb:2|Z|X|0.5|all");
    expect(blockTypeCacheKey(X_OPEN_SPEC)).toBe("fb:0|Z|X|0.5|all");
  });

  it("two structurally equal specs produce the same key", () => {
    const a: FreeBuildPipeSpec = { ...Z_OPEN_SPEC };
    const b: FreeBuildPipeSpec = { ...Z_OPEN_SPEC };
    expect(blockTypeCacheKey(a)).toBe(blockTypeCacheKey(b));
  });

  it("specs that differ only in swapAxes produce different keys", () => {
    const full: FreeBuildPipeSpec = { ...Z_OPEN_SPEC };
    const half: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, swapAxes: "first" };
    expect(blockTypeCacheKey(full)).not.toBe(blockTypeCacheKey(half));
  });
});

describe("FB_PRESETS", () => {
  it("all presets have a single Y defect at 0.5", () => {
    for (const p of FB_PRESETS) {
      expect(p.spec.kind).toBe("fb-pipe");
      expect(p.spec.defectPositions).toEqual([0.5]);
    }
  });

  it("the full presets are color-swap mirrors of each other (Z→X and X→Z)", () => {
    const zx = FB_PRESETS.find((p) => p.id === "swap-zx");
    const xz = FB_PRESETS.find((p) => p.id === "swap-xz");
    expect(zx).toBeDefined();
    expect(xz).toBeDefined();
    expect(zx!.spec.baseAtStart).toBe("Z");
    expect(zx!.spec.baseAtEnd).toBe("X");
    expect(xz!.spec.baseAtStart).toBe("X");
    expect(xz!.spec.baseAtEnd).toBe("Z");
    expect(zx!.spec.swapAxes ?? "all").toBe("all");
    expect(xz!.spec.swapAxes ?? "all").toBe("all");
  });

  it("ships half-swap presets that change only 2 opposite faces", () => {
    const halfZx = FB_PRESETS.find((p) => p.id === "half-zx");
    const halfXz = FB_PRESETS.find((p) => p.id === "half-xz");
    expect(halfZx).toBeDefined();
    expect(halfXz).toBeDefined();
    expect(halfZx!.spec.swapAxes).toBe("first");
    expect(halfXz!.spec.swapAxes).toBe("first");
    expect(halfZx!.spec.baseAtStart).toBe("Z");
    expect(halfZx!.spec.baseAtEnd).toBe("X");
    expect(halfXz!.spec.baseAtStart).toBe("X");
    expect(halfXz!.spec.baseAtEnd).toBe("Z");
  });
});

describe("FB pipe geometry honors swapAxes", () => {
  function vertexColors(geo: ReturnType<typeof createBlockGeometry>): { r: number; g: number; b: number }[] {
    const arr = geo.getAttribute("color").array as Float32Array;
    const out: { r: number; g: number; b: number }[] = [];
    for (let i = 0; i < arr.length; i += 3) out.push({ r: arr[i], g: arr[i + 1], b: arr[i + 2] });
    return out;
  }
  function colorEq(a: { r: number; g: number; b: number }, c: typeof X_COLOR): boolean {
    return Math.abs(a.r - c.r) < 1e-6 && Math.abs(a.g - c.g) < 1e-6 && Math.abs(a.b - c.b) < 1e-6;
  }

  it("full-swap pipe has each base color count balanced (all 4 walls swap)", () => {
    const colors = vertexColors(createBlockGeometry(Z_OPEN_SPEC));
    const xCount = colors.filter((c) => colorEq(c, X_COLOR)).length;
    const zCount = colors.filter((c) => colorEq(c, Z_COLOR)).length;
    // 4 walls × 2 strips × 4 verts = 32 colored verts; each base appears on
    // 4 strips (2 below + 2 above per axis pair), so counts are equal.
    expect(xCount).toBe(zCount);
    expect(xCount + zCount).toBe(32);
  });

  it("half-swap pipe biases toward the start-side base (3 strips of one color, 1 of the other)", () => {
    // Z→X half: closed axis 0 wall pair shows Z below + X above.
    //           closed axis 1 wall pair shows X below AND X above (no swap).
    // Total Z verts: 1 strip × 2 walls × 4 verts = 8.
    // Total X verts: 3 strips × 2 walls × 4 verts = 24.
    const halfSpec: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, swapAxes: "first" };
    const colors = vertexColors(createBlockGeometry(halfSpec));
    const xCount = colors.filter((c) => colorEq(c, X_COLOR)).length;
    const zCount = colors.filter((c) => colorEq(c, Z_COLOR)).length;
    expect(xCount).toBe(24);
    expect(zCount).toBe(8);
  });

  it("swapAxes 'second' mirrors 'first' on the other closed-axis pair", () => {
    // Z→X second-axis half: closed axis 0 wall pair stays Z (no swap).
    //                       closed axis 1 wall pair shows X below + Z above.
    // Total Z verts: 3 strips × 2 walls × 4 verts = 24.
    // Total X verts: 1 strip × 2 walls × 4 verts = 8.
    // Mirror of the "first" case above (swap on the opposite axis pair).
    const halfSpec: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, swapAxes: "second" };
    const colors = vertexColors(createBlockGeometry(halfSpec));
    const xCount = colors.filter((c) => colorEq(c, X_COLOR)).length;
    const zCount = colors.filter((c) => colorEq(c, Z_COLOR)).length;
    expect(xCount).toBe(8);
    expect(zCount).toBe(24);
  });

  it("swapAxes 'second' Y-defect ring lies on the second closed-axis wall pair", () => {
    // Z_OPEN_SPEC has Three.js openAxis=1 (Y), closedAxes=[0,2]=[X,Z].
    // swapAxes "second" → only the Z-axis wall pair (closed[1]) swaps. The
    // ring segments at the defect must therefore vary in X (i.e., run along
    // the X axis, lying on the Z-walls), not in Z. Total: 4 corners (lower
    // half) + 2 ring segments = 6 edges, mirroring the "first" case.
    const halfSpec: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, swapAxes: "second" };
    const arr = createYDefectEdges(halfSpec).getAttribute("position").array as Float32Array;
    expect(arr.length / 6).toBe(6);
    // Last 2 segments are the ring; verify they vary in X (Three.js axis 0)
    // and stay constant in Z (Three.js axis 2).
    for (let i = 4; i < 6; i++) {
      const x0 = arr[i * 6 + 0], x1 = arr[i * 6 + 3];
      const z0 = arr[i * 6 + 2], z1 = arr[i * 6 + 5];
      expect(Math.abs(x1 - x0)).toBeGreaterThan(0.5);
      expect(z0).toBeCloseTo(z1, 6);
    }
  });
});

// Regression: free-build pipes must snap to ports/blocks the same way regular
// pipes do. Before this fix, the gates in OpenPipeGhosts and BlockInstances
// only checked store.pipeVariant, so an armed FB preset fell through to the
// cube-placement path. resolveFBSpecFromFace is the FB-aware analogue of
// resolvePipeTypeFromFace and gives back BOTH the snapped slot and the spec
// with openAxis matching that slot's TQEC axis.
describe("resolveFBSpecFromFace (port-adjacent FB pipe snapping)", () => {
  const PRESET: FBPreset = FB_PRESETS[0]; // swap-zx, openAxis=2 in template
  const PORT: Position3D = { x: 0, y: 0, z: 0 };

  it("snaps to the +X pipe slot with +X face normal", () => {
    const r = resolveFBSpecFromFace(PORT, "XZZ", new Vector3(1, 0, 0), PRESET);
    expect(r).not.toBeNull();
    expect(r!.adj).toEqual({ x: 1, y: 0, z: 0 });
    expect(isValidPipePos(r!.adj)).toBe(true);
    expect(pipeAxisFromPos(r!.adj)).toBe(0);
    expect(r!.spec.openAxis).toBe(0);
    expect(r!.spec.kind).toBe("fb-pipe");
  });

  it("snaps to the -X pipe slot with -X face normal", () => {
    const r = resolveFBSpecFromFace(PORT, "XZZ", new Vector3(-1, 0, 0), PRESET);
    expect(r).not.toBeNull();
    expect(r!.adj).toEqual({ x: -2, y: 0, z: 0 });
    expect(r!.spec.openAxis).toBe(0);
  });

  it("snaps to a Z-axis pipe slot with Three +Y face normal (TQEC +Z)", () => {
    const r = resolveFBSpecFromFace(PORT, "XZZ", new Vector3(0, 1, 0), PRESET);
    expect(r).not.toBeNull();
    expect(r!.adj).toEqual({ x: 0, y: 0, z: 1 });
    expect(r!.spec.openAxis).toBe(2);
  });

  it("snaps to a Y-axis pipe slot with Three +Z face normal (TQEC -Y)", () => {
    const r = resolveFBSpecFromFace(PORT, "XZZ", new Vector3(0, 0, 1), PRESET);
    expect(r).not.toBeNull();
    expect(r!.adj).toEqual({ x: 0, y: -2, z: 0 });
    expect(r!.spec.openAxis).toBe(1);
  });

  it("preserves the preset's color/defect template, only overriding openAxis", () => {
    const r = resolveFBSpecFromFace(PORT, "XZZ", new Vector3(1, 0, 0), PRESET);
    expect(r).not.toBeNull();
    expect(r!.spec.baseAtStart).toBe(PRESET.spec.baseAtStart);
    expect(r!.spec.baseAtEnd).toBe(PRESET.spec.baseAtEnd);
    expect(r!.spec.defectPositions).toEqual(PRESET.spec.defectPositions);
  });

  it("computes the same adj position as resolvePipeTypeFromFace for every face direction", () => {
    // Snap parity: an FB preset hovering a port should land on the same grid slot
    // as a regular pipe variant — the only thing that differs is the resulting
    // block type (FB spec vs concrete PipeType).
    const port: Position3D = { x: 3, y: 6, z: 0 };
    const normals = [
      new Vector3(1, 0, 0),
      new Vector3(-1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),
      new Vector3(0, 0, 1),
      new Vector3(0, 0, -1),
    ];
    for (const n of normals) {
      const fb = resolveFBSpecFromFace(port, "XZZ", n, PRESET);
      const reg = resolvePipeTypeFromFace(port, "XZZ", n, "ZX");
      expect(fb).not.toBeNull();
      expect(reg).not.toBeNull();
      const regAdj = getAdjacentPos(port, "XZZ", n, reg!);
      expect(fb!.adj).toEqual(regAdj);
    }
  });
});

// FB pipes must participate in attached-pipe accounting so that cubes with FB
// pipes attached cascade-delete those pipes (instead of orphaning them as
// floating segments) and converting a junction cube to a port is refused.
describe("attached-pipe accounting recognizes FB pipes", () => {
  function makeBlocks(entries: Block[]): Map<string, Block> {
    const map = new Map<string, Block>();
    for (const b of entries) map.set(posKey(b.pos), b);
    return map;
  }

  it("pipeOpenAxisOf returns the spec axis for FB pipes and the O-index for TQEC pipes", () => {
    expect(pipeOpenAxisOf(X_OPEN_SPEC)).toBe(0);
    expect(pipeOpenAxisOf(Y_OPEN_SPEC)).toBe(1);
    expect(pipeOpenAxisOf(Z_OPEN_SPEC)).toBe(2);
    expect(pipeOpenAxisOf("OZX")).toBe(0);
    expect(pipeOpenAxisOf("ZOX")).toBe(1);
    expect(pipeOpenAxisOf("ZXO")).toBe(2);
    expect(pipeOpenAxisOf("OZXH")).toBe(0);
  });

  it("countAttachedPipes counts FB pipes alongside TQEC pipes", () => {
    // Cube at origin with one TQEC pipe on +X and one FB pipe on +Y.
    const blocks = makeBlocks([
      { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" },
      { pos: { x: 1, y: 0, z: 0 }, type: "OZX" },
      { pos: { x: 0, y: 1, z: 0 }, type: Y_OPEN_SPEC },
    ]);
    expect(countAttachedPipes({ x: 0, y: 0, z: 0 }, blocks)).toBe(2);
  });

  it("getAttachedPipeKeys returns FB pipe keys", () => {
    const blocks = makeBlocks([
      { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" },
      { pos: { x: 1, y: 0, z: 0 }, type: X_OPEN_SPEC },
      { pos: { x: 0, y: 0, z: 1 }, type: Z_OPEN_SPEC },
    ]);
    const keys = getAttachedPipeKeys({ x: 0, y: 0, z: 0 }, blocks);
    expect(keys.sort()).toEqual(["0,0,1", "1,0,0"]);
  });

  it("does not count an FB pipe whose open axis doesn't point at the cube", () => {
    // A Z-open FB pipe at (1,0,0) is NOT a +X-attached pipe of the cube at origin
    // (it occupies a Z-axis slot, but its position isn't even a valid pipe slot).
    // This is a parity check: regular pipes are filtered the same way.
    const blocks = makeBlocks([
      { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" },
      // Wrong-axis FB pipe at +X slot — open along Y, not X.
      { pos: { x: 1, y: 0, z: 0 }, type: Y_OPEN_SPEC },
    ]);
    expect(countAttachedPipes({ x: 0, y: 0, z: 0 }, blocks)).toBe(0);
  });
});
