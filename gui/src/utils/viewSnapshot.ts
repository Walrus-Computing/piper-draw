// ---------------------------------------------------------------------------
// viewSnapshot — the serialisable "frozen view" baked into a standalone HTML
// export (see utils/htmlExport.ts and src/viewer/). Extends SceneSnapshotV1
// with just enough render state to reproduce the editor's current look:
// flow-viz dimming + the selected correlation surface, the view mode (for
// iso slab-dimming), and the camera framing used as the embed's opening view.
//
// Pure module: no store/React imports. Callers pass state in (the component
// layer reads useBlockStore + the OrbitControls ref and hands it here).
// ---------------------------------------------------------------------------

import type { SceneSnapshotV1 } from "./sceneSnapshot";
import { isSceneSnapshotV1 } from "./sceneSnapshot";
import type { Flow } from "./flows";
import type { ViewMode } from "../types";

export const VIEW_SCHEMA_VERSION = 1;

const COORD_BOUND = 1_000_000;

export interface CameraStateV1 {
  kind: "persp" | "ortho";
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov?: number; // perspective only
  zoom?: number; // orthographic only
  near: number;
  far: number;
}

export interface ViewSnapshotV1 {
  vv: 1;
  scene: SceneSnapshotV1; // blocks + ports, reuses captureSnapshot/isSceneSnapshotV1
  flowVizMode: boolean; // drives BlockInstances dimming (DIMMED_OPACITY)
  selectedFlow: Flow | null; // only the selected flow's surfaces; collapses to flows[0]
  viewMode: ViewMode; // persp / iso(axis,slice) — iso reproduces slab dimming
  camera: CameraStateV1 | null; // opening view; null → viewer auto-fits the scene
  showGrid: boolean; // grid excluded from embeds by default
  background: string; // matches App's <color> background
}

/**
 * Read the current camera framing off an OrbitControls instance. `controls`
 * is the drei OrbitControls ref: `.object` is the live camera, `.target` the
 * orbit pivot. Returns null if controls/camera aren't mounted yet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function captureCameraState(controls: any): CameraStateV1 | null {
  const cam = controls?.object;
  const target = controls?.target;
  if (!cam || !target) return null;
  const ortho = cam.isOrthographicCamera === true;
  return {
    kind: ortho ? "ortho" : "persp",
    position: [cam.position.x, cam.position.y, cam.position.z],
    target: [target.x, target.y, target.z],
    up: [cam.up.x, cam.up.y, cam.up.z],
    ...(ortho ? { zoom: cam.zoom } : { fov: cam.fov }),
    near: cam.near,
    far: cam.far,
  };
}

export function buildViewSnapshot(args: {
  scene: SceneSnapshotV1;
  flowVizMode: boolean;
  selectedFlow: Flow | null;
  viewMode: ViewMode;
  camera: CameraStateV1 | null;
  showGrid: boolean;
  background: string;
}): ViewSnapshotV1 {
  return {
    vv: VIEW_SCHEMA_VERSION,
    scene: args.scene,
    flowVizMode: args.flowVizMode,
    selectedFlow: args.selectedFlow,
    viewMode: args.viewMode,
    camera: args.camera,
    showGrid: args.showGrid,
    background: args.background,
  };
}

function isFiniteCoord(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= COORD_BOUND;
}

function isVec3(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isCameraStateV1(value: unknown): value is CameraStateV1 {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<CameraStateV1>;
  if (c.kind !== "persp" && c.kind !== "ortho") return false;
  if (!isVec3(c.position) || !isVec3(c.target) || !isVec3(c.up)) return false;
  if (typeof c.near !== "number" || !Number.isFinite(c.near)) return false;
  if (typeof c.far !== "number" || !Number.isFinite(c.far)) return false;
  if (c.fov !== undefined && (typeof c.fov !== "number" || !Number.isFinite(c.fov))) return false;
  if (c.zoom !== undefined && (typeof c.zoom !== "number" || !Number.isFinite(c.zoom))) return false;
  return true;
}

function isFlow(value: unknown): value is Flow {
  if (!value || typeof value !== "object") return false;
  const f = value as Partial<Flow>;
  if (!f.inputs || typeof f.inputs !== "object") return false;
  if (!f.outputs || typeof f.outputs !== "object") return false;
  if (!Array.isArray(f.surfaces)) return false;
  for (const piece of f.surfaces) {
    if (!piece || typeof piece !== "object") return false;
    if (piece.basis !== "X" && piece.basis !== "Z") return false;
    if (!Array.isArray(piece.vertices)) return false;
    if (!piece.vertices.every(isFiniteCoord)) return false;
  }
  return true;
}

function isViewMode(value: unknown): value is ViewMode {
  if (!value || typeof value !== "object") return false;
  const v = value as { kind?: unknown; axis?: unknown; slice?: unknown };
  if (v.kind === "persp") return true;
  if (v.kind === "iso") {
    if (v.axis !== "x" && v.axis !== "y" && v.axis !== "z") return false;
    return typeof v.slice === "number" && Number.isFinite(v.slice);
  }
  return false;
}

export function isViewSnapshotV1(value: unknown): value is ViewSnapshotV1 {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ViewSnapshotV1>;
  if (v.vv !== VIEW_SCHEMA_VERSION) return false;
  if (!isSceneSnapshotV1(v.scene)) return false;
  if (typeof v.flowVizMode !== "boolean") return false;
  if (v.selectedFlow !== null && !isFlow(v.selectedFlow)) return false;
  if (!isViewMode(v.viewMode)) return false;
  if (v.camera !== null && !isCameraStateV1(v.camera)) return false;
  if (typeof v.showGrid !== "boolean") return false;
  if (typeof v.background !== "string") return false;
  return true;
}
