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
  FB_DEFAULT_FACES,
  migrateLegacyFBSpec,
  normalizeFBSpec,
  validFBPipeVariantsForCubePair,
} from "./index";
import type { Block, BlockType, FBPreset, FreeBuildPipeSpec, Position3D } from "./index";
import { resolveFBSpecFromFace, resolvePipeTypeFromFace } from "../components/BlockInstances.logic";

// Z-open full-swap reference (matches legacy `baseAtStart:Z, baseAtEnd:X` semantics
// for Z-open pipes: ca0=X-axis takes Z-below + X-above; ca1=Z-axis takes X-below + Z-above).
const Z_OPEN_SPEC: FreeBuildPipeSpec = {
  kind: "fb-pipe",
  openAxis: 2,
  defectPositions: [0.5],
  faces: ["ZX", "ZX", "XZ", "XZ"],
};

const X_OPEN_SPEC: FreeBuildPipeSpec = {
  kind: "fb-pipe",
  openAxis: 0,
  defectPositions: [0.5],
  faces: ["ZX", "ZX", "XZ", "XZ"],
};

// Legacy Y-open spec mirrored the start/end pair (tail-orientation flip), so the
// equivalent new spec puts XZ on ca0 (X-axis Three.js) and ZX on ca1 (Y-axis Three.js).
const Y_OPEN_SPEC: FreeBuildPipeSpec = {
  kind: "fb-pipe",
  openAxis: 1,
  defectPositions: [0.5],
  faces: ["XZ", "XZ", "ZX", "ZX"],
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
  function colorEq(a: { r: number; g: number; b: number }, c: typeof X_COLOR): boolean {
    return Math.abs(a.r - c.r) < 1e-6 && Math.abs(a.g - c.g) < 1e-6 && Math.abs(a.b - c.b) < 1e-6;
  }

  it("emits no yellow (H_COLOR) vertices — FB has no Hadamard band", () => {
    const geo = createBlockGeometry(Z_OPEN_SPEC);
    const colors = vertexColors(geo);
    for (const c of colors) {
      const isYellow =
        Math.abs(c.r - H_COLOR.r) < 1e-6 &&
        Math.abs(c.g - H_COLOR.g) < 1e-6 &&
        Math.abs(c.b - H_COLOR.b) < 1e-6;
      expect(isYellow).toBe(false);
    }
  });

  it("contains both X_COLOR and Z_COLOR vertices when a wall swaps", () => {
    const geo = createBlockGeometry(Z_OPEN_SPEC);
    const colors = vertexColors(geo);
    expect(colors.some((c) => colorEq(c, X_COLOR))).toBe(true);
    expect(colors.some((c) => colorEq(c, Z_COLOR))).toBe(true);
  });

  it("solid-X pipe has only X_COLOR vertices on every wall", () => {
    const solid: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, faces: ["X", "X", "X", "X"] };
    const colors = vertexColors(createBlockGeometry(solid));
    for (const c of colors) {
      // All non-zero color verts must be red (X) — open-axis faces are stripped.
      if (c.r === 0 && c.g === 0 && c.b === 0) continue;
      expect(colorEq(c, X_COLOR)).toBe(true);
    }
  });

  it("each FaceConfig produces the expected (below, above) basis pair", () => {
    // Each wall has 2 strips × 4 verts = 8 colored verts. Build a single-wall
    // probe: vary one face at a time, leave the other 3 as solid X.
    const cases: Array<{ fc: "XZ" | "ZX" | "X" | "Z"; below: typeof X_COLOR; above: typeof X_COLOR }> = [
      { fc: "X", below: X_COLOR, above: X_COLOR },
      { fc: "Z", below: Z_COLOR, above: Z_COLOR },
      { fc: "XZ", below: X_COLOR, above: Z_COLOR },
      { fc: "ZX", below: Z_COLOR, above: X_COLOR },
    ];
    for (const { fc, below, above } of cases) {
      const spec: FreeBuildPipeSpec = {
        ...Z_OPEN_SPEC,
        faces: [fc, "X", "X", "X"],
      };
      const colors = vertexColors(createBlockGeometry(spec));
      // The first wall (face 0 = +ca0) emits 2 strips × 4 verts. With ca0 = X
      // (Three.js axis 0), the +ca0 wall verts can be identified by x-coord
      // > 0. Below-strip verts have y < 0; above-strip verts have y > 0
      // (Three.js openAxis = 1 for Z-open). We pull both strips and check.
      const positions = createBlockGeometry(spec).getAttribute("position").array as Float32Array;
      let belowFound = false;
      let aboveFound = false;
      for (let i = 0; i < positions.length / 3; i++) {
        const px = positions[i * 3];
        const py = positions[i * 3 + 1];
        if (px <= 0) continue;
        const c = colors[i];
        if (py < 0 && colorEq(c, below)) belowFound = true;
        if (py > 0 && colorEq(c, above)) aboveFound = true;
      }
      expect(belowFound).toBe(true);
      expect(aboveFound).toBe(true);
    }
  });
});

describe("createYDefectEdges for FB pipes (per-face)", () => {
  function edgeCount(geo: ReturnType<typeof createYDefectEdges>): number {
    const arr = geo.getAttribute("position").array as Float32Array;
    return arr.length / 6;
  }

  it("full-swap pipe (all 4 walls swap) emits 4 corner edges + 4 ring segments = 8", () => {
    expect(edgeCount(createYDefectEdges(Z_OPEN_SPEC))).toBe(8);
    expect(edgeCount(createYDefectEdges(X_OPEN_SPEC))).toBe(8);
    expect(edgeCount(createYDefectEdges(Y_OPEN_SPEC))).toBe(8);
  });

  it("solid pipe (every face same basis) emits no Y-defect edges", () => {
    const solid: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, faces: ["X", "X", "X", "X"] };
    expect(edgeCount(createYDefectEdges(solid))).toBe(0);
  });

  it("one swapping face puts a ring on that face plus corner cylinders on its 2 adjacent corners", () => {
    // Faces: [+ca0=XZ, -ca0=X, +ca1=X, -ca1=X]. Below: +ca0 X = -ca0 X = +ca1 X = -ca1 X (no diff).
    // Above: +ca0 Z, others X — corners (+ca0,±ca1) light up above. So 2 above-half corners
    // + 1 ring on the swapping face = 3 edges total.
    const spec: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, faces: ["XZ", "X", "X", "X"] };
    expect(edgeCount(createYDefectEdges(spec))).toBe(3);
  });

  it("half-swap pipe (one pair swaps, the other stays solid X) emits 4 half-corners + 2 rings = 6", () => {
    // Migrating the legacy {baseAtStart:Z, swapAxes:"first"} → faces=["ZX","ZX","X","X"].
    const halfSpec: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, faces: ["ZX", "ZX", "X", "X"] };
    expect(edgeCount(createYDefectEdges(halfSpec))).toBe(6);
  });

  it("pipe with no defects: corner cylinder appears iff bases differ across the whole length", () => {
    // Solid faces only — different colors on opposite walls give 4 corners (no rings, no defect).
    const noDefects: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, defectPositions: [], faces: ["X", "X", "Z", "Z"] };
    expect(edgeCount(createYDefectEdges(noDefects))).toBe(4);
  });

  it("opposite-direction swaps on a pair (XZ vs ZX) light up Y-defects on both halves", () => {
    // ca0 +face XZ (X→Z), ca0 -face ZX (Z→X). At the corner with the orthogonal wall (X solid):
    //   below: +ca0 = X vs ca1 = X — no diff
    //   above: +ca0 = Z vs ca1 = X — diff → cylinder above
    //   below: -ca0 = Z vs ca1 = X — diff → cylinder below
    //   above: -ca0 = X vs ca1 = X — no diff
    // Both ca0 walls swap → 2 ring segments. Total: 2 above-corners + 2 below-corners + 2 rings = 6.
    const spec: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, faces: ["XZ", "ZX", "X", "X"] };
    expect(edgeCount(createYDefectEdges(spec))).toBe(6);
  });
});

describe("flipBlockType on FB pipes", () => {
  it("flips X↔Z on every face config (X↔Z, XZ↔ZX), leaving openAxis/defects unchanged", () => {
    const flipped = flipBlockType(Z_OPEN_SPEC) as FreeBuildPipeSpec;
    expect(flipped.kind).toBe("fb-pipe");
    expect(flipped.openAxis).toBe(2);
    expect(flipped.defectPositions).toEqual([0.5]);
    // Z_OPEN_SPEC.faces = ["ZX","ZX","XZ","XZ"] → ["XZ","XZ","ZX","ZX"]
    expect(flipped.faces).toEqual(["XZ", "XZ", "ZX", "ZX"]);
  });

  it("is an involution on FB pipes (flip twice = original)", () => {
    const once = flipBlockType(Z_OPEN_SPEC) as FreeBuildPipeSpec;
    const twice = flipBlockType(once) as FreeBuildPipeSpec;
    expect(twice.faces).toEqual(Z_OPEN_SPEC.faces);
  });

  it("solid faces flip too: X→Z, Z→X", () => {
    const solid: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, faces: ["X", "Z", "X", "Z"] };
    const flipped = flipBlockType(solid) as FreeBuildPipeSpec;
    expect(flipped.faces).toEqual(["Z", "X", "Z", "X"]);
  });
});

describe("blockTypeCacheKey", () => {
  it("returns the string itself for TQEC types", () => {
    expect(blockTypeCacheKey("OZX" as BlockType)).toBe("OZX");
    expect(blockTypeCacheKey("Y" as BlockType)).toBe("Y");
  });

  it("returns a deterministic content-based key for FB specs", () => {
    expect(blockTypeCacheKey(Z_OPEN_SPEC)).toBe("fb:2|ZXZXXZXZ|0.5");
    expect(blockTypeCacheKey(X_OPEN_SPEC)).toBe("fb:0|ZXZXXZXZ|0.5");
  });

  it("two structurally equal specs produce the same key", () => {
    const a: FreeBuildPipeSpec = { ...Z_OPEN_SPEC };
    const b: FreeBuildPipeSpec = { ...Z_OPEN_SPEC };
    expect(blockTypeCacheKey(a)).toBe(blockTypeCacheKey(b));
  });

  it("specs that differ in any face produce different keys", () => {
    const a: FreeBuildPipeSpec = { ...Z_OPEN_SPEC };
    const b: FreeBuildPipeSpec = { ...Z_OPEN_SPEC, faces: ["X", "X", "X", "X"] };
    expect(blockTypeCacheKey(a)).not.toBe(blockTypeCacheKey(b));
  });
});

describe("FB_PRESETS", () => {
  it("ships a single Free Pipe preset (variants are picked from the side panel)", () => {
    expect(FB_PRESETS).toHaveLength(1);
    const fp = FB_PRESETS[0];
    expect(fp.id).toBe("free-pipe");
    expect(fp.spec.kind).toBe("fb-pipe");
    expect(fp.spec.defectPositions).toEqual([0.5]);
    expect(fp.spec.faces).toEqual(FB_DEFAULT_FACES);
  });
});

describe("legacy FB spec migration", () => {
  it("converts {baseAtStart:Z, baseAtEnd:X, swapAxes:'all'} to per-face equivalent", () => {
    const legacy = {
      kind: "fb-pipe" as const,
      openAxis: 2 as const,
      baseAtStart: "Z" as const,
      baseAtEnd: "X" as const,
      defectPositions: [0.5],
    };
    const migrated = migrateLegacyFBSpec(legacy);
    expect(migrated.faces).toEqual(["ZX", "ZX", "XZ", "XZ"]);
    expect(migrated.openAxis).toBe(2);
    expect(migrated.defectPositions).toEqual([0.5]);
  });

  it("converts swapAxes:'first' (only ca0 pair flips)", () => {
    const legacy = {
      kind: "fb-pipe" as const,
      openAxis: 2 as const,
      baseAtStart: "Z" as const,
      baseAtEnd: "X" as const,
      defectPositions: [0.5],
      swapAxes: "first" as const,
    };
    const migrated = migrateLegacyFBSpec(legacy);
    expect(migrated.faces).toEqual(["ZX", "ZX", "X", "X"]);
  });

  it("converts swapAxes:'second' (only ca1 pair flips)", () => {
    const legacy = {
      kind: "fb-pipe" as const,
      openAxis: 2 as const,
      baseAtStart: "Z" as const,
      baseAtEnd: "X" as const,
      defectPositions: [0.5],
      swapAxes: "second" as const,
    };
    const migrated = migrateLegacyFBSpec(legacy);
    expect(migrated.faces).toEqual(["Z", "Z", "XZ", "XZ"]);
  });

  it("Y-open mirror: legacy code flipped wallColors, so migration applies the same flip", () => {
    const legacy = {
      kind: "fb-pipe" as const,
      openAxis: 1 as const,
      baseAtStart: "Z" as const,
      baseAtEnd: "X" as const,
      defectPositions: [0.5],
    };
    const migrated = migrateLegacyFBSpec(legacy);
    expect(migrated.faces).toEqual(["XZ", "XZ", "ZX", "ZX"]);
  });

  it("normalizeFBSpec passes through new-shape specs untouched", () => {
    const newSpec: FreeBuildPipeSpec = { ...Z_OPEN_SPEC };
    expect(normalizeFBSpec(newSpec)).toBe(newSpec);
  });

  it("normalizeFBSpec migrates a legacy spec", () => {
    const legacy = {
      kind: "fb-pipe",
      openAxis: 2,
      baseAtStart: "Z",
      baseAtEnd: "X",
      defectPositions: [0.5],
    };
    const out = normalizeFBSpec(legacy);
    expect(out).not.toBeNull();
    expect(out!.faces).toEqual(["ZX", "ZX", "XZ", "XZ"]);
  });

  it("normalizeFBSpec rejects non-FB inputs", () => {
    expect(normalizeFBSpec(null)).toBeNull();
    expect(normalizeFBSpec({ kind: "other" })).toBeNull();
    expect(normalizeFBSpec("OZX")).toBeNull();
  });
});

// Regression: free-build pipes must snap to ports/blocks the same way regular
// pipes do. Before this fix, the gates in OpenPipeGhosts and BlockInstances
// only checked store.pipeVariant, so an armed FB preset fell through to the
// cube-placement path. resolveFBSpecFromFace is the FB-aware analogue of
// resolvePipeTypeFromFace and gives back BOTH the snapped slot and the spec
// with openAxis matching that slot's TQEC axis.
describe("resolveFBSpecFromFace (port-adjacent FB pipe snapping)", () => {
  const PRESET: FBPreset = FB_PRESETS[0];
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

  it("preserves the preset's faces/defects template, only overriding openAxis", () => {
    const r = resolveFBSpecFromFace(PORT, "XZZ", new Vector3(1, 0, 0), PRESET);
    expect(r).not.toBeNull();
    expect(r!.spec.faces).toEqual(PRESET.spec.faces);
    expect(r!.spec.defectPositions).toEqual(PRESET.spec.defectPositions);
  });

  it("computes the same adj position as resolvePipeTypeFromFace for every face direction", () => {
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
    const blocks = makeBlocks([
      { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" },
      { pos: { x: 1, y: 0, z: 0 }, type: Y_OPEN_SPEC },
    ]);
    expect(countAttachedPipes({ x: 0, y: 0, z: 0 }, blocks)).toBe(0);
  });
});

describe("validFBPipeVariantsForCubePair", () => {
  function makeBlocks(entries: Block[]): Map<string, Block> {
    const map = new Map<string, Block>();
    for (const b of entries) map.set(posKey(b.pos), b);
    return map;
  }

  // X-axis cases ----------------------------------------------------------
  const X_PIPE_POS: Position3D = { x: 1, y: 0, z: 0 };
  const X_NEG_POS: Position3D = { x: 0, y: 0, z: 0 };
  const X_POS_POS: Position3D = { x: 3, y: 0, z: 0 };
  const FB_X_PIPE: Block = { pos: X_PIPE_POS, type: X_OPEN_SPEC };

  it("XZZ–XZZ along X yields all-Z (both closed axes Z=Z)", () => {
    const blocks = makeBlocks([
      { pos: X_NEG_POS, type: "XZZ" },
      FB_X_PIPE,
      { pos: X_POS_POS, type: "XZZ" },
    ]);
    const r = validFBPipeVariantsForCubePair(FB_X_PIPE, blocks);
    expect(r).not.toBeNull();
    expect(r!.faces).toEqual([["Z", "Z", "Z", "Z"]]);
    expect(r!.negType).toBe("XZZ");
    expect(r!.posType).toBe("XZZ");
    expect(r!.openAxis).toBe(0);
  });

  it("ZXX–XZZ along X yields all-XZ (X-below → Z-above on both closed axes)", () => {
    const blocks = makeBlocks([
      { pos: X_NEG_POS, type: "ZXX" },
      FB_X_PIPE,
      { pos: X_POS_POS, type: "XZZ" },
    ]);
    const r = validFBPipeVariantsForCubePair(FB_X_PIPE, blocks);
    expect(r!.faces).toEqual([["XZ", "XZ", "XZ", "XZ"]]);
    expect(r!.negType).toBe("ZXX");
    expect(r!.posType).toBe("XZZ");
  });

  it("XZZ–ZXX along X (reversed) yields all-ZX", () => {
    const blocks = makeBlocks([
      { pos: X_NEG_POS, type: "XZZ" },
      FB_X_PIPE,
      { pos: X_POS_POS, type: "ZXX" },
    ]);
    const r = validFBPipeVariantsForCubePair(FB_X_PIPE, blocks);
    expect(r!.faces).toEqual([["ZX", "ZX", "ZX", "ZX"]]);
  });

  it("XZZ–ZXZ along X yields different face configs on the two closed axes", () => {
    // XZZ closed (Y,Z) = (Z,Z); ZXZ closed (Y,Z) = (X,Z).
    // Y-axis: Z→X = "ZX". Z-axis: Z→Z = "Z".
    // ca0 (Three.js X→TQEC X is open; ca0=Three Y=TQEC Z): faces[0,1] = "Z".
    // ca1 (Three.js Z→TQEC Y): faces[2,3] = "ZX".
    const blocks = makeBlocks([
      { pos: X_NEG_POS, type: "XZZ" },
      FB_X_PIPE,
      { pos: X_POS_POS, type: "ZXZ" },
    ]);
    const r = validFBPipeVariantsForCubePair(FB_X_PIPE, blocks);
    expect(r!.faces).toEqual([["Z", "Z", "ZX", "ZX"]]);
  });

  it("ZXZ–ZXX along X yields a mix of solid X and ZX swap", () => {
    // ZXZ closed (Y,Z) = (X,Z); ZXX closed (Y,Z) = (X,X).
    // Y-axis: X→X = "X". Z-axis: Z→X = "ZX".
    // ca0 (TQEC Z): faces[0,1] = "ZX". ca1 (TQEC Y): faces[2,3] = "X".
    const blocks = makeBlocks([
      { pos: X_NEG_POS, type: "ZXZ" },
      FB_X_PIPE,
      { pos: X_POS_POS, type: "ZXX" },
    ]);
    const r = validFBPipeVariantsForCubePair(FB_X_PIPE, blocks);
    expect(r!.faces).toEqual([["ZX", "ZX", "X", "X"]]);
  });

  // Y-axis ---------------------------------------------------------------
  it("XZZ–XZZ along Y yields all-X (closed axes X=X both ends)", () => {
    // openAxis=1 (Y). Closed TQEC axes: X (0) and Z (2). Both ends XZZ.
    // X-axis basis: X. Z-axis basis: Z. Both same below=above. So solid X on
    // one ca and solid Z on the other.
    // ca0 (Three.js X = TQEC X): "X". ca1 (Three.js Y = TQEC Z): "Z".
    const fbY: Block = { pos: { x: 0, y: 1, z: 0 }, type: Y_OPEN_SPEC };
    const blocks = makeBlocks([
      { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" },
      fbY,
      { pos: { x: 0, y: 3, z: 0 }, type: "XZZ" },
    ]);
    const r = validFBPipeVariantsForCubePair(fbY, blocks);
    expect(r!.faces).toEqual([["X", "X", "Z", "Z"]]);
    expect(r!.openAxis).toBe(1);
  });

  it("ZXZ–XZZ along Y yields a swap on the X-axis closed wall and solid Z on the Z-axis wall", () => {
    // ZXZ closed (X,Z) = (Z,Z); XZZ closed (X,Z) = (X,Z).
    // X-axis: Z→X = "ZX". Z-axis: Z→Z = "Z".
    // ca0 = TQEC X: "ZX". ca1 = TQEC Z: "Z".
    const fbY: Block = { pos: { x: 0, y: 1, z: 0 }, type: Y_OPEN_SPEC };
    const blocks = makeBlocks([
      { pos: { x: 0, y: 0, z: 0 }, type: "ZXZ" },
      fbY,
      { pos: { x: 0, y: 3, z: 0 }, type: "XZZ" },
    ]);
    const r = validFBPipeVariantsForCubePair(fbY, blocks);
    expect(r!.faces).toEqual([["ZX", "ZX", "Z", "Z"]]);
  });

  // Z-axis ---------------------------------------------------------------
  it("XZZ–XZZ along Z yields one solid X wall and one solid Z wall", () => {
    // openAxis=2 (Z). Closed TQEC axes: X (0) and Y (1).
    // XZZ X=X, XZZ Y=Z. Both ends same. ca0=TQEC X→"X", ca1=TQEC Y→"Z".
    const fbZ: Block = { pos: { x: 0, y: 0, z: 1 }, type: Z_OPEN_SPEC };
    const blocks = makeBlocks([
      { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" },
      fbZ,
      { pos: { x: 0, y: 0, z: 3 }, type: "XZZ" },
    ]);
    const r = validFBPipeVariantsForCubePair(fbZ, blocks);
    expect(r!.faces).toEqual([["X", "X", "Z", "Z"]]);
    expect(r!.openAxis).toBe(2);
  });

  it("ZXX–XXZ along Z yields a swap on each closed-axis wall", () => {
    // ZXX (X=Z, Y=X); XXZ (X=X, Y=X). X-axis: Z→X = "ZX". Y-axis: X→X = "X".
    const fbZ: Block = { pos: { x: 0, y: 0, z: 1 }, type: Z_OPEN_SPEC };
    const blocks = makeBlocks([
      { pos: { x: 0, y: 0, z: 0 }, type: "ZXX" },
      fbZ,
      { pos: { x: 0, y: 0, z: 3 }, type: "XXZ" },
    ]);
    const r = validFBPipeVariantsForCubePair(fbZ, blocks);
    expect(r!.faces).toEqual([["ZX", "ZX", "X", "X"]]);
  });

  // Null-returning cases -------------------------------------------------
  it("returns null when the −openAxis neighbour is missing", () => {
    const blocks = makeBlocks([FB_X_PIPE, { pos: X_POS_POS, type: "XZZ" }]);
    expect(validFBPipeVariantsForCubePair(FB_X_PIPE, blocks)).toBeNull();
  });

  it("returns null when the +openAxis neighbour is missing", () => {
    const blocks = makeBlocks([{ pos: X_NEG_POS, type: "XZZ" }, FB_X_PIPE]);
    expect(validFBPipeVariantsForCubePair(FB_X_PIPE, blocks)).toBeNull();
  });

  it("returns null when a neighbour is a Y block", () => {
    const blocks = makeBlocks([
      { pos: X_NEG_POS, type: "XZZ" },
      FB_X_PIPE,
      { pos: X_POS_POS, type: "Y" },
    ]);
    expect(validFBPipeVariantsForCubePair(FB_X_PIPE, blocks)).toBeNull();
  });

  it("returns null when a neighbour is an FB pipe (only plain cubes count)", () => {
    // Hypothetical FB pipe at X_POS_POS — block positions can't legally hold a
    // pipe, but the rule should reject any non-cube neighbour regardless.
    const blocks = makeBlocks([
      { pos: X_NEG_POS, type: "XZZ" },
      FB_X_PIPE,
      { pos: X_POS_POS, type: X_OPEN_SPEC },
    ]);
    expect(validFBPipeVariantsForCubePair(FB_X_PIPE, blocks)).toBeNull();
  });

  it("returns null when the input block is not an FB pipe", () => {
    const cube: Block = { pos: X_NEG_POS, type: "XZZ" };
    const blocks = makeBlocks([cube]);
    expect(validFBPipeVariantsForCubePair(cube, blocks)).toBeNull();
  });
});
