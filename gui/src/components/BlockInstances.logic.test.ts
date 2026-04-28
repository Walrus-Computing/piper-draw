import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  decidePlaceModeClick,
  decidePlaceModeHover,
  resolveFBSpecFromFace,
  resolvePipeTypeFromFace,
  type PlaceModeState,
} from "./BlockInstances.logic";
import {
  buildSpatialIndex,
  FB_PRESETS,
  isFreeBuildPipeSpec,
  posKey,
} from "../types";
import type { Block, BlockType, CubeType, FBPreset, PipeVariant, Position3D } from "../types";
import type { ArmedTool } from "../stores/blockStore";

const FB_FREE_PIPE: FBPreset = FB_PRESETS[0];

function block(pos: Position3D, type: BlockType): Block {
  return { pos, type };
}

function makeState(opts: {
  armedTool: ArmedTool;
  cubeType?: CubeType | "Y";
  pipeVariant?: PipeVariant | null;
  fbPreset?: FBPreset | null;
  freeBuild?: boolean;
  blocks?: Block[];
}): PlaceModeState {
  const blockMap = new Map<string, Block>();
  for (const b of opts.blocks ?? []) blockMap.set(posKey(b.pos), b);
  return {
    armedTool: opts.armedTool,
    cubeType: opts.cubeType ?? "XZZ",
    pipeVariant: opts.pipeVariant ?? null,
    fbPreset: opts.fbPreset ?? null,
    freeBuild: opts.freeBuild ?? false,
    blocks: blockMap,
    spatialIndex: buildSpatialIndex(blockMap),
  };
}

describe("decidePlaceModeHover — armedTool === 'cube'", () => {
  it("returns cube-replace ghost when cubeType differs from hovered.type", () => {
    const cube = block({ x: 0, y: 0, z: 0 }, "ZXZ");
    const state = makeState({ armedTool: "cube", cubeType: "XZZ", blocks: [cube] });
    const intent = decidePlaceModeHover(state, cube, new Vector3(1, 0, 0));
    expect(intent.kind).toBe("ghost");
    if (intent.kind !== "ghost") return;
    expect(intent.pos).toEqual({ x: 0, y: 0, z: 0 });
    expect(intent.type).toBe("XZZ");
    expect(intent.invalid).toBe(false);
    expect(intent.replace).toBe(true);
  });

  it("clears ghost when cubeType === hovered.type (face-based fallback fails on cube-pipe-slot mismatch)", () => {
    // adj = (1,0,0) is a pipe slot, not a valid cube position, so face-based clears.
    const cube = block({ x: 0, y: 0, z: 0 }, "XZZ");
    const state = makeState({ armedTool: "cube", cubeType: "XZZ", blocks: [cube] });
    const intent = decidePlaceModeHover(state, cube, new Vector3(1, 0, 0));
    expect(intent.kind).toBe("clear");
  });

});

describe("decidePlaceModeHover — armedTool === 'pipe' + fbPreset (FB snap regression)", () => {
  it("never enters cube-replace; returns FB pipe ghost in adj slot regardless of cubeType", () => {
    // Before the fix this case rendered a CUBE ghost at the cube position.
    const cube = block({ x: 0, y: 0, z: 0 }, "ZXZ");
    const state = makeState({
      armedTool: "pipe",
      cubeType: "XZZ", // different from hovered.type — would have triggered cube-replace
      fbPreset: FB_FREE_PIPE,
      freeBuild: true,
      blocks: [cube],
    });
    const intent = decidePlaceModeHover(state, cube, new Vector3(1, 0, 0));
    expect(intent.kind).toBe("ghost");
    if (intent.kind !== "ghost") return;
    expect(isFreeBuildPipeSpec(intent.type)).toBe(true);
    expect(intent.pos).toEqual({ x: 1, y: 0, z: 0 });
    expect(intent.invalid).toBe(false);
  });

  it("places FB pipe in adj slot for every face direction tested (cube hover)", () => {
    const cube = block({ x: 0, y: 0, z: 0 }, "ZXZ");
    const state = makeState({
      armedTool: "pipe",
      cubeType: "XZZ",
      fbPreset: FB_FREE_PIPE,
      freeBuild: true,
      blocks: [cube],
    });
    const cases: { normal: Vector3; expected: Position3D }[] = [
      { normal: new Vector3(1, 0, 0), expected: { x: 1, y: 0, z: 0 } },
      { normal: new Vector3(-1, 0, 0), expected: { x: -2, y: 0, z: 0 } },
      { normal: new Vector3(0, 1, 0), expected: { x: 0, y: 0, z: 1 } },
      { normal: new Vector3(0, 0, 1), expected: { x: 0, y: -2, z: 0 } },
    ];
    for (const { normal, expected } of cases) {
      const intent = decidePlaceModeHover(state, cube, normal);
      expect(intent.kind).toBe("ghost");
      if (intent.kind !== "ghost") continue;
      expect(intent.pos).toEqual(expected);
      expect(isFreeBuildPipeSpec(intent.type)).toBe(true);
    }
  });

  it("clears when face resolution fails (no faceNormal)", () => {
    const cube = block({ x: 0, y: 0, z: 0 }, "ZXZ");
    const state = makeState({
      armedTool: "pipe",
      cubeType: "XZZ",
      fbPreset: FB_FREE_PIPE,
      freeBuild: true,
      blocks: [cube],
    });
    const intent = decidePlaceModeHover(state, cube, null);
    expect(intent.kind).toBe("clear");
  });
});

describe("decidePlaceModeHover — armedTool === 'pipe' + pipeVariant (TQEC)", () => {
  it("returns TQEC pipe ghost in adj slot", () => {
    const cube = block({ x: 0, y: 0, z: 0 }, "XZZ");
    const state = makeState({
      armedTool: "pipe",
      cubeType: "XZZ",
      pipeVariant: "ZX",
      blocks: [cube],
    });
    const intent = decidePlaceModeHover(state, cube, new Vector3(1, 0, 0));
    expect(intent.kind).toBe("ghost");
    if (intent.kind !== "ghost") return;
    expect(intent.pos).toEqual({ x: 1, y: 0, z: 0 });
    // X-open ZX pipe at this slot is "OZX"
    expect(intent.type).toBe("OZX");
  });

  it("adj slot matches the FB-equivalent path (parity)", () => {
    const cube = block({ x: 0, y: 0, z: 0 }, "ZXZ");
    const tqecState = makeState({
      armedTool: "pipe",
      cubeType: "XZZ",
      pipeVariant: "ZX",
      blocks: [cube],
    });
    const fbState = makeState({
      armedTool: "pipe",
      cubeType: "XZZ",
      fbPreset: FB_FREE_PIPE,
      freeBuild: true,
      blocks: [cube],
    });
    for (const normal of [
      new Vector3(1, 0, 0),
      new Vector3(-1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
    ]) {
      const tqec = decidePlaceModeHover(tqecState, cube, normal);
      const fb = decidePlaceModeHover(fbState, cube, normal);
      expect(tqec.kind).toBe("ghost");
      expect(fb.kind).toBe("ghost");
      if (tqec.kind !== "ghost" || fb.kind !== "ghost") continue;
      expect(fb.pos).toEqual(tqec.pos);
    }
  });
});

describe("decidePlaceModeClick", () => {
  it("returns place-at hovered.pos when cube tool replaces a different-type cube", () => {
    const cube = block({ x: 0, y: 0, z: 0 }, "ZXZ");
    const state = makeState({ armedTool: "cube", cubeType: "XZZ", blocks: [cube] });
    const action = decidePlaceModeClick(state, cube, new Vector3(1, 0, 0));
    expect(action).toEqual({ kind: "place-at", pos: cube.pos });
  });

  it("FB-armed click on a different-type cube places at adj pipe slot, not at cube pos (REGRESSION)", () => {
    const cube = block({ x: 0, y: 0, z: 0 }, "ZXZ");
    const state = makeState({
      armedTool: "pipe",
      cubeType: "XZZ",
      fbPreset: FB_FREE_PIPE,
      freeBuild: true,
      blocks: [cube],
    });
    const action = decidePlaceModeClick(state, cube, new Vector3(1, 0, 0));
    expect(action).toEqual({ kind: "place-at", pos: { x: 1, y: 0, z: 0 } });
  });

  it("returns noop when no face normal and no cube-replace path applies", () => {
    const cube = block({ x: 0, y: 0, z: 0 }, "XZZ");
    const state = makeState({
      armedTool: "pipe",
      cubeType: "XZZ",
      fbPreset: FB_FREE_PIPE,
      freeBuild: true,
      blocks: [cube],
    });
    const action = decidePlaceModeClick(state, cube, null);
    expect(action).toEqual({ kind: "noop" });
  });

  it("FB-click adj position equals TQEC-click adj position for the same hover (parity)", () => {
    const cube = block({ x: 0, y: 0, z: 0 }, "ZXZ");
    const tqecState = makeState({
      armedTool: "pipe",
      cubeType: "XZZ",
      pipeVariant: "ZX",
      blocks: [cube],
    });
    const fbState = makeState({
      armedTool: "pipe",
      cubeType: "XZZ",
      fbPreset: FB_FREE_PIPE,
      freeBuild: true,
      blocks: [cube],
    });
    for (const normal of [
      new Vector3(1, 0, 0),
      new Vector3(-1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
    ]) {
      const tqec = decidePlaceModeClick(tqecState, cube, normal);
      const fb = decidePlaceModeClick(fbState, cube, normal);
      expect(tqec.kind).toBe("place-at");
      expect(fb.kind).toBe("place-at");
      if (tqec.kind !== "place-at" || fb.kind !== "place-at") continue;
      expect(fb.pos).toEqual(tqec.pos);
    }
  });
});

// Sanity: the resolution helpers are re-exported from the logic module so
// other components (OpenPipeGhosts) can import from one place. Cover the
// re-exports so the surface is stable.
describe("resolution helpers (sanity)", () => {
  it("resolveFBSpecFromFace returns a valid pipe slot", () => {
    const r = resolveFBSpecFromFace({ x: 0, y: 0, z: 0 }, "XZZ", new Vector3(1, 0, 0), FB_FREE_PIPE);
    expect(r).not.toBeNull();
    expect(r!.adj).toEqual({ x: 1, y: 0, z: 0 });
    expect(r!.spec.openAxis).toBe(0);
  });

  it("resolvePipeTypeFromFace agrees with FB on adj slot", () => {
    const tqec = resolvePipeTypeFromFace({ x: 0, y: 0, z: 0 }, "XZZ", new Vector3(1, 0, 0), "ZX");
    expect(tqec).toBe("OZX");
  });
});
