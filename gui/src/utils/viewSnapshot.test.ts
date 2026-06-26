import { describe, expect, it } from "vitest";
import type { Block } from "../types";
import type { SceneSnapshotV1 } from "./sceneSnapshot";
import type { CameraStateV1, ViewSnapshotV1 } from "./viewSnapshot";
import { buildViewSnapshot, captureCameraState, isViewSnapshotV1 } from "./viewSnapshot";

function scene(blocks: Array<[string, Block]> = []): SceneSnapshotV1 {
  return { v: 1, blocks, portMeta: [], portPositions: [] };
}

const PERSP_CAM: CameraStateV1 = {
  kind: "persp",
  position: [14, 14, -14],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fov: 35,
  near: 0.1,
  far: 100000,
};

function validView(over: Partial<ViewSnapshotV1> = {}): ViewSnapshotV1 {
  return buildViewSnapshot({
    scene: scene([["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }]]),
    flowVizMode: false,
    selectedFlow: null,
    viewMode: { kind: "persp" },
    camera: PERSP_CAM,
    showGrid: false,
    background: "#CBDFC6",
    ...over,
  });
}

describe("captureCameraState", () => {
  it("reads a perspective OrbitControls instance", () => {
    const controls = {
      object: {
        isOrthographicCamera: false,
        position: { x: 1, y: 2, z: 3 },
        up: { x: 0, y: 1, z: 0 },
        fov: 35,
        near: 0.1,
        far: 100,
      },
      target: { x: 4, y: 5, z: 6 },
    };
    expect(captureCameraState(controls)).toEqual({
      kind: "persp",
      position: [1, 2, 3],
      target: [4, 5, 6],
      up: [0, 1, 0],
      fov: 35,
      near: 0.1,
      far: 100,
    });
  });

  it("reads an orthographic camera with zoom (no fov)", () => {
    const controls = {
      object: {
        isOrthographicCamera: true,
        position: { x: 1000, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        zoom: 30,
        near: 0.1,
        far: 100,
      },
      target: { x: 0, y: 0, z: 0 },
    };
    const cam = captureCameraState(controls);
    expect(cam?.kind).toBe("ortho");
    expect(cam?.zoom).toBe(30);
    expect(cam?.fov).toBeUndefined();
  });

  it("returns null when controls/camera are not mounted", () => {
    expect(captureCameraState(null)).toBeNull();
    expect(captureCameraState({})).toBeNull();
  });
});

describe("isViewSnapshotV1", () => {
  it("accepts a freshly built snapshot (round-trips through JSON)", () => {
    const view = validView();
    expect(isViewSnapshotV1(view)).toBe(true);
    expect(isViewSnapshotV1(JSON.parse(JSON.stringify(view)))).toBe(true);
  });

  it("accepts an iso viewMode + ortho camera with an embedded flow", () => {
    const view = validView({
      flowVizMode: true,
      viewMode: { kind: "iso", axis: "z", slice: 3 },
      camera: { ...PERSP_CAM, kind: "ortho", zoom: 30, fov: undefined },
      selectedFlow: {
        inputs: { P1: "in" },
        outputs: { P2: "out" },
        surfaces: [{ basis: "X", vertices: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] }],
      },
    });
    expect(isViewSnapshotV1(view)).toBe(true);
  });

  it("accepts a null camera (viewer auto-fits)", () => {
    const view = validView({ camera: null });
    expect(isViewSnapshotV1(view)).toBe(true);
    expect(isViewSnapshotV1(JSON.parse(JSON.stringify(view)))).toBe(true);
  });

  it("rejects an undefined camera", () => {
    const view = validView();
    // @ts-expect-error intentionally drop the camera
    delete view.camera;
    expect(isViewSnapshotV1(view)).toBe(false);
  });

  it("rejects the wrong schema version", () => {
    expect(isViewSnapshotV1({ ...validView(), vv: 2 })).toBe(false);
  });

  it("rejects a non-finite camera coordinate", () => {
    const view = validView({ camera: { ...PERSP_CAM, position: [Infinity, 0, 0] } });
    expect(isViewSnapshotV1(view)).toBe(false);
  });

  it("rejects a malformed scene", () => {
    const view = validView();
    // @ts-expect-error intentionally corrupt the nested scene
    view.scene = { v: 2 };
    expect(isViewSnapshotV1(view)).toBe(false);
  });

  it("rejects a malformed viewMode", () => {
    const view = validView();
    // @ts-expect-error intentionally corrupt the viewMode
    view.viewMode = { kind: "iso", axis: "q", slice: 0 };
    expect(isViewSnapshotV1(view)).toBe(false);
  });

  it("rejects a flow with a non-finite surface vertex", () => {
    const view = validView({
      flowVizMode: true,
      selectedFlow: {
        inputs: {},
        outputs: {},
        surfaces: [{ basis: "Z", vertices: [0, 0, NaN] }],
      },
    });
    expect(isViewSnapshotV1(view)).toBe(false);
  });
});
