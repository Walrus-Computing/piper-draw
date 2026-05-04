import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// Disable color management to match tqec's Three.js v0.138.0 pipeline:
// colors are stored as-is (no sRGB↔linear conversion), only output encoding applies.
THREE.ColorManagement.enabled = false;
import {
  OrbitControls,
  GizmoHelper,
  PerspectiveCamera,
  OrthographicCamera,
} from "@react-three/drei";
import { BlockInstances } from "./components/BlockInstances";
import { GridPlane } from "./components/GridPlane";
import { GhostBlock } from "./components/GhostBlock";
import { PasteGhost } from "./components/PasteGhost";
import { AxisLabels } from "./components/AxisLabels";
import { FpsSampler } from "./components/FpsCounter";
import { OrientationGizmo } from "./components/OrientationGizmo";
import { Toolbar } from "./components/Toolbar";
import { ValidationToast } from "./components/ValidationToast";
import { InvalidBlockHighlights } from "./components/InvalidBlockHighlights";
import { LocatePulseHighlight } from "./components/LocatePulseHighlight";
import { SelectionHighlights } from "./components/SelectionHighlights";
import { GroupOutlines } from "./components/GroupOutlines";
import { BuildCursor } from "./components/BuildCursor";
import { SelectModePointer, type ThreeState } from "./components/SelectModePointer";
import { DragGhost } from "./components/DragGhost";
import { DragShadow } from "./components/DragShadow";
import { NavControlsModifier } from "./components/NavControlsModifier";
import { OpenPipeGhosts } from "./components/OpenPipeGhosts";
import { FlowsPanel } from "./components/FlowsPanel";
import { ZXPanel } from "./components/ZXPanel";
import { PortLabels3D } from "./components/PortLabels3D";
import { FoldOutCubeOverlay } from "./components/FoldOutCubeOverlay";
import { FlowSurfaceOverlay } from "./components/FlowSurfaceOverlay";
import { YDefectOverlay } from "./components/YDefectOverlay";
import { BuildModeHints } from "./components/BuildModeHints";
import { EditModeHints } from "./components/EditModeHints";
import { KeybindEditor, type KeybindEditorTab } from "./components/KeybindEditor";
import { HelpPanel } from "./components/HelpPanel";
import { useBlockStore } from "./stores/blockStore";
import {
  useKeybindStore,
  actionForKey,
  actionToWasdKey,
  type KeyBinding,
} from "./stores/keybindStore";
import { toastBus } from "./utils/toastBus";
import type { RotationAxis, RotationOperation } from "./utils/blockRotation";
import { wasdToBuildDirection, tqecToThree, posKey, blockTqecSize, type Block, type IsoAxis, type ViewMode } from "./types";
import { cameraGroundPoint } from "./utils/groundPlane";
import { animateCamera } from "./utils/cameraAnim";
import { downloadPng } from "./utils/photoExport";
import { downloadDae } from "./utils/daeExport";
import {
  applySnapshot,
  isSceneSnapshotV1,
  type SceneSnapshotV1,
} from "./utils/sceneSnapshot";
import {
  decodeSnapshotFromHash,
  parseSceneHashParam,
} from "./utils/sceneShare";
import { SharedSceneBanner } from "./components/SharedSceneBanner";
import { isEditableTarget } from "./utils/editableFocus";
import {
  ISO_INITIAL_ZOOM,
  isoBuildDirection,
  isoCameraThree,
  isoCameraOffset,
  isoGridMeshTransform,
  isoTargetThree,
  isoUpThree,
} from "./utils/isoView";

const GRID_SNAP = 3;

type RotationActionName =
  | "rotateCcw" | "rotateCw"
  | "rotateXCcw" | "rotateXCw"
  | "rotateYCcw" | "rotateYCw"
  | "flipX" | "flipY" | "flipZ";

/** Edit-mode keybind actions that map to a (axis, operation) for rotateSelected. */
const ROTATION_ACTIONS: Record<RotationActionName, { axis: RotationAxis; operation: RotationOperation }> = {
  rotateCcw:  { axis: "z", operation: "ccw" },
  rotateCw:   { axis: "z", operation: "cw" },
  rotateXCcw: { axis: "x", operation: "ccw" },
  rotateXCw:  { axis: "x", operation: "cw" },
  rotateYCcw: { axis: "y", operation: "ccw" },
  rotateYCw:  { axis: "y", operation: "cw" },
  flipX:      { axis: "x", operation: "flip" },
  flipY:      { axis: "y", operation: "flip" },
  flipZ:      { axis: "z", operation: "flip" },
};

const AUTOSAVE_KEY = "piper-draw:autosave:v1";
const AUTOSAVE_META_KEY = "piper-draw:autosave:meta:v1";
const AUTOSAVE_DEBOUNCE_MS = 500;

// Snapshot of the user's autosave taken just before a shared scene is applied.
// Persisted to localStorage so "Restore previous" survives a tab close/reload —
// otherwise the autosave subscriber overwrites the original autosave with the
// shared scene within AUTOSAVE_DEBOUNCE_MS.
const PRE_SHARE_SNAPSHOT_KEY = "piper-draw:autosave:pre-share:v1";
// One-time flag for the group/grid keymap migration toast (g moved from grid
// toggle to group toggle; grid moved to Shift+G). Show once per browser.
const GROUP_KEYMAP_MIGRATION_KEY = "piper-draw:group-keymap-migration-shown";

function readPreShareSnapshot(): SceneSnapshotV1 | null {
  try {
    const raw = localStorage.getItem(PRE_SHARE_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSceneSnapshotV1(parsed)) {
      localStorage.removeItem(PRE_SHARE_SNAPSHOT_KEY);
      return null;
    }
    return parsed;
  } catch {
    try { localStorage.removeItem(PRE_SHARE_SNAPSHOT_KEY); } catch (err) { void err; }
    return null;
  }
}

function writePreShareSnapshot(snapshot: SceneSnapshotV1): void {
  try {
    localStorage.setItem(PRE_SHARE_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (err) {
    // Quota / private mode — banner falls back to React-only state.
    void err;
  }
}

function clearPreShareSnapshot(): void {
  try { localStorage.removeItem(PRE_SHARE_SNAPSHOT_KEY); } catch (err) { void err; }
}

/**
 * Shader-based grid mesh: dark grey cells at block positions (mod 3 ≡ 0),
 * light grey cells at pipe positions (mod 3 ≡ 1), with light edges on each cell.
 * Uses two world-space basis vectors as uniforms so the same shader can render
 * the floor (TQEC X/Y) or any iso-view plane.
 */
function makeGridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      // World-space directions whose dot products with vWorldPos give the two
      // in-plane TQEC coordinates used for the mod-3 checkerboard.
      axisU: { value: new THREE.Vector3(1, 0, 0) },   // TQEC X
      axisV: { value: new THREE.Vector3(0, 0, -1) },  // TQEC Y
      // Center used for the distance fade (orbit target along the in-plane axes).
      fadeCenter: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 axisU;
      uniform vec3 axisV;
      uniform vec3 fadeCenter;
      varying vec3 vWorldPos;
      float pmod(float a, float b) { return a - b * floor(a / b); }
      void main() {
        float tx = dot(axisU, vWorldPos);
        float ty = dot(axisV, vWorldPos);
        float mx = pmod(floor(tx), 3.0);
        float my = pmod(floor(ty), 3.0);

        bool xBlock = mx < 0.5;
        bool yBlock = my < 0.5;
        bool xPipe = mx > 0.5;
        bool yPipe = my > 0.5;

        bool isBlock = xBlock && yBlock;
        bool isPipe = (xPipe && yBlock) || (xBlock && yPipe);

        if (!isBlock && !isPipe) discard;

        float fx = fract(tx);
        float fy = fract(ty);
        float edgeWidth = 0.03;

        float edgeX, edgeY;
        if (isPipe && xPipe) {
          float px = pmod(tx, 3.0) - 1.0;
          edgeX = min(px, 2.0 - px);
        } else {
          edgeX = min(fx, 1.0 - fx);
        }
        if (isPipe && yPipe) {
          float py = pmod(ty, 3.0) - 1.0;
          edgeY = min(py, 2.0 - py);
        } else {
          edgeY = min(fy, 1.0 - fy);
        }

        float edgeDist = min(edgeX, edgeY);
        bool onEdge = edgeDist < edgeWidth;

        if (onEdge) {
          gl_FragColor = vec4(0.85, 0.85, 0.85, 0.35);
        } else if (isBlock) {
          gl_FragColor = vec4(0.45, 0.45, 0.45, 0.18);
        } else {
          gl_FragColor = vec4(0.65, 0.65, 0.65, 0.12);
        }

        // Fade by distance from center along in-plane axes only.
        vec3 d = vWorldPos - fadeCenter;
        float du = dot(axisU, d);
        float dv = dot(axisV, d);
        float dist = sqrt(du * du + dv * dv);
        float fade = 1.0 - smoothstep(100.0, 300.0, dist);
        gl_FragColor.a *= fade;
      }
    `,
  });
}

const gridMaterial = makeGridMaterial();

function CheckerboardGrid() {
  const ref = useRef<THREE.Mesh>(null!);
  const target = useRef(new THREE.Vector3());
  const viewMode = useBlockStore((s) => s.viewMode);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useThree((s) => s.controls) as any;

  // Update shader uniforms whenever the active plane changes.
  useEffect(() => {
    const u = gridMaterial.uniforms;
    if (viewMode.kind === "persp" || viewMode.axis === "z") {
      u.axisU.value.set(1, 0, 0);
      u.axisV.value.set(0, 0, -1);
    } else if (viewMode.axis === "x") {
      u.axisU.value.set(0, 0, -1);  // TQEC Y = -Three Z
      u.axisV.value.set(0, 1, 0);   // TQEC Z =  Three Y
    } else {
      u.axisU.value.set(1, 0, 0);   // TQEC X
      u.axisV.value.set(0, 1, 0);   // TQEC Z
    }
  }, [viewMode]);

  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const u = gridMaterial.uniforms;
    if (viewMode.kind === "persp") {
      if (cameraGroundPoint(camera, target.current)) {
        mesh.position.x = Math.round(target.current.x / GRID_SNAP) * GRID_SNAP;
        mesh.position.z = Math.round(target.current.z / GRID_SNAP) * GRID_SNAP;
        mesh.position.y = 0.001;
        u.fadeCenter.value.set(mesh.position.x, 0, mesh.position.z);
      }
      return;
    }
    // Iso mode: align mesh with active slice plane; follow orbit target along in-plane axes.
    const ot: THREE.Vector3 | undefined = controls?.target;
    const axis = viewMode.axis;
    const slice = viewMode.slice;
    if (axis === "x") {
      mesh.position.x = slice + 0.001;
      mesh.position.y = ot ? Math.round(ot.y / GRID_SNAP) * GRID_SNAP : 0;
      mesh.position.z = ot ? Math.round(ot.z / GRID_SNAP) * GRID_SNAP : 0;
    } else if (axis === "y") {
      mesh.position.x = ot ? Math.round(ot.x / GRID_SNAP) * GRID_SNAP : 0;
      mesh.position.y = ot ? Math.round(ot.y / GRID_SNAP) * GRID_SNAP : 0;
      mesh.position.z = -slice - 0.001;
    } else {
      mesh.position.x = ot ? Math.round(ot.x / GRID_SNAP) * GRID_SNAP : 0;
      mesh.position.y = slice + 0.001;
      mesh.position.z = ot ? Math.round(ot.z / GRID_SNAP) * GRID_SNAP : 0;
    }
    u.fadeCenter.value.copy(mesh.position);
  });

  const rotation: [number, number, number] = viewMode.kind === "persp"
    ? [-Math.PI / 2, 0, 0]
    : isoGridMeshTransform(viewMode.axis).rotation;

  return (
    <mesh ref={ref} rotation={rotation}>
      <planeGeometry args={[500, 500]} />
      <primitive object={gridMaterial} attach="material" />
    </mesh>
  );
}

/**
 * Camera + controls that swap based on viewMode. PerspectiveCamera for free-orbit
 * 3D mode; OrthographicCamera for axis-locked elevation views with rotation disabled.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ViewportCamera({ controlsRef }: { controlsRef: React.RefObject<any> }) {
  const viewMode = useBlockStore((s) => s.viewMode);
  if (viewMode.kind === "persp") {
    return (
      <>
        <PerspectiveCamera
          makeDefault
          position={[14, 14, -14]}
          fov={35}
          near={0.1}
          far={100000}
        />
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableRotate
          zoomToCursor
          maxDistance={50000}
          screenSpacePanning={false}
          mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: -1 as THREE.MOUSE }}
        />
      </>
    );
  }
  return <IsoViewport viewMode={viewMode} controlsRef={controlsRef} />;
}

function IsoViewport({
  viewMode,
  controlsRef,
}: {
  viewMode: Extract<ViewMode, { kind: "iso" }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlsRef: React.RefObject<any>;
}) {
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  const prevAxisRef = useRef<IsoAxis | null>(null);

  // Position the orthographic camera + orbit target whenever the iso slice/axis changes.
  // On axis change: full reset (centers view at origin in-plane).
  // On slice-only change: preserve in-plane target (respects user pan and
  // cursor-follow pans), only update the depth component.
  useEffect(() => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam) return;
    const axisChanged = prevAxisRef.current !== viewMode.axis;
    prevAxisRef.current = viewMode.axis;

    const isoTarget = isoTargetThree(viewMode);
    let target: THREE.Vector3;
    if (axisChanged || !ctrl) {
      target = isoTarget;
    } else {
      // Keep in-plane (x/y/z components other than the depth axis); only the
      // depth component comes from isoTargetThree.
      target = ctrl.target.clone();
      if (viewMode.axis === "x") target.x = isoTarget.x;
      else if (viewMode.axis === "y") target.z = isoTarget.z;
      else target.y = isoTarget.y;
    }
    cam.up.copy(isoUpThree(viewMode.axis));
    cam.position.copy(target.clone().add(isoCameraOffset(viewMode.axis)));
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    if (ctrl) {
      ctrl.target.copy(target);
      ctrl.update();
    }
  }, [viewMode, controlsRef]);

  return (
    <>
      <OrthographicCamera
        ref={cameraRef}
        makeDefault
        near={0.1}
        far={100000}
        zoom={ISO_INITIAL_ZOOM}
      />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableRotate={false}
        zoomToCursor
        maxZoom={500}
        minZoom={2}
        screenSpacePanning
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: -1 as THREE.MOUSE }}
      />
    </>
  );
}

/**
 * Snaps the camera to the build direction target when cameraSnapTarget changes.
 * In perspective mode, animates camera + orbit target. In iso mode, pans the
 * orbit target in-plane (the slice auto-advance is handled atomically in
 * buildMove, so the camera just needs to follow the cursor's in-plane position).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CameraBuildSnap({ controlsRef }: { controlsRef: React.RefObject<any> }) {
  const cameraSnapTarget = useBlockStore((s) => s.cameraSnapTarget);
  const lastBuildAxis = useBlockStore((s) => s.lastBuildAxis);
  const clearCameraSnap = useBlockStore((s) => s.clearCameraSnap);
  const viewMode = useBlockStore((s) => s.viewMode);
  const { camera } = useThree();
  const prevTarget = useRef<{ azimuth: number | null; targetPos: { x: number; y: number; z: number } } | null>(null);
  const prevBuildAxis = useRef<number | null>(null);

  useFrame(() => {
    if (!cameraSnapTarget || !controlsRef.current) return;
    if (prevTarget.current === cameraSnapTarget) return;
    prevTarget.current = cameraSnapTarget;

    if (viewMode.kind === "iso") {
      const controls = controlsRef.current;
      const [tx, ty, tz] = tqecToThree(cameraSnapTarget.targetPos, "XZZ");
      // Preserve the depth component from isoTargetThree — the camera stays on
      // the active slice plane; only the in-plane target moves to follow cursor.
      const isoTarget = isoTargetThree(viewMode);
      const axis = viewMode.axis;
      const endTarget = new THREE.Vector3(
        axis === "x" ? isoTarget.x : tx,
        axis === "z" ? isoTarget.y : ty,   // iso-z depth = Three y
        axis === "y" ? isoTarget.z : tz,   // iso-y depth = Three z
      );
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      animateCamera(controls, endTarget, endTarget.clone().add(offset));
      clearCameraSnap();
      return;
    }

    const controls = controlsRef.current;
    const [tx, ty, tz] = tqecToThree(cameraSnapTarget.targetPos, "XZZ");
    const endTarget = new THREE.Vector3(tx, ty, tz);

    // Check if axis changed compared to previous build move
    const axisChanged = prevBuildAxis.current !== lastBuildAxis;
    prevBuildAxis.current = lastBuildAxis;

    let endPos: THREE.Vector3;
    if (cameraSnapTarget.azimuth !== null && axisChanged) {
      // First move into this axis — reposition camera behind build direction with slight offset
      const currentDistance = camera.position.distanceTo(controls.target);
      const dist = Math.max(currentDistance, 15);
      const polar = Math.min(controls.getPolarAngle(), 1.2);
      const az = cameraSnapTarget.azimuth + 0.12;
      endPos = new THREE.Vector3(
        tx + dist * Math.sin(polar) * Math.sin(az),
        ty + dist * Math.cos(polar),
        tz + dist * Math.sin(polar) * Math.cos(az),
      );
    } else {
      // Same axis or Z movement — translate camera, preserve current viewing angle
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      endPos = endTarget.clone().add(offset);
    }

    animateCamera(controls, endTarget, endPos);
    clearCameraSnap();
  });

  return null;
}

/**
 * Captures the WebGL canvas as a PNG when `photoRequest` is set.
 * Waits two animation frames so React's commit (which hides grid/overlays)
 * and R3F's subsequent render both complete before reading pixels.
 */
function ScreenshotCapture() {
  const photoRequest = useBlockStore((s) => s.photoRequest);
  const clearPhotoRequest = useBlockStore((s) => s.clearPhotoRequest);
  const { gl } = useThree();

  useEffect(() => {
    if (!photoRequest) return;
    let raf1 = 0;
    let raf2 = 0;
    let cancelled = false;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        downloadPng(gl.domElement).catch((err) => {
          console.error("Photo export failed:", err);
        }).finally(() => {
          clearPhotoRequest();
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [photoRequest, gl, clearPhotoRequest]);

  return null;
}

/** Exposes Three.js camera + viewport size to HTML components via a shared ref. Must be inside <Canvas>. */
function ThreeStateBridge({ stateRef }: { stateRef: React.MutableRefObject<ThreeState | null> }) {
  const { camera, size } = useThree();
  useEffect(() => {
    stateRef.current = { camera, size };
  }, [stateRef, camera, size]);
  return null;
}

function PlacementWarning({ toolbarRef }: { toolbarRef: React.RefObject<HTMLDivElement | null> }) {
  const reason = useBlockStore((s) => s.hoveredInvalidReason);
  const portWarning = useBlockStore((s) => s.portWarning);
  const clearPortWarning = useBlockStore((s) => s.clearPortWarning);
  // Prefer the persistent port warning if set; fall back to the hover tooltip.
  const message = portWarning ?? reason;
  const [topOffset, setTopOffset] = useState(0);

  useEffect(() => {
    if (!message || !toolbarRef.current) return;
    const rect = toolbarRef.current.getBoundingClientRect();
    setTopOffset(rect.bottom + 8);
  }, [message, toolbarRef]);

  useEffect(() => {
    if (!portWarning) return;
    const t = setTimeout(clearPortWarning, 3000);
    return () => clearTimeout(t);
  }, [portWarning, clearPortWarning]);

  if (!message) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: topOffset,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2,
        background: "#f8d7da",
        color: "#721c24",
        border: "1px solid #f5c6cb",
        padding: "8px 16px",
        borderRadius: "6px",
        fontFamily: "sans-serif",
        fontSize: "13px",
        pointerEvents: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        maxWidth: "500px",
        textAlign: "center" as const,
      }}
    >
      {message}
    </div>
  );
}

export default function App() {
  const fpsRef = useRef<HTMLSpanElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [keybindEditorMode, setKeybindEditorMode] = useState<KeybindEditorTab | null>(null);
  const [helpOpen, setHelpOpen] = useState(
    () => typeof localStorage !== 'undefined' && !localStorage.getItem('piperDraw.seenIntro'),
  );
  const [sharedSceneBanner, setSharedSceneBanner] = useState<
    { previousSnapshot: SceneSnapshotV1 } | null
  >(() => {
    // Lazy init: hydrate the banner from a previous tab's pre-share key so
    // it survives a reload while a shared scene is loaded. The boot effect
    // below sets the banner anew when a fresh share is opened.
    if (typeof window === "undefined") return null;
    const carried = readPreShareSnapshot();
    return carried ? { previousSnapshot: carried } : null;
  });
  // Gates the autosave subscriber: stays false during hash-decode so a shared
  // scene's hydrate can't trigger an immediate write that overwrites the
  // pre-share autosave (C6 race fix).
  const [autosaveReady, setAutosaveReady] = useState(false);
  const threeStateRef = useRef<ThreeState | null>(null);
  const photoRequest = useBlockStore((s) => s.photoRequest);
  const flowsPanelOpen = useBlockStore((s) => s.flowsPanelOpen);
  const zxPanelOpen = useBlockStore((s) => s.zxPanelOpen);
  const flowVizMode = useBlockStore((s) => s.flowVizMode);
  const showGrid = useBlockStore((s) => s.showGrid);
  const showHints = useBlockStore((s) => s.showHints);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const alt = e.altKey;
      const store = useBlockStore.getState();
      const bindings = useKeybindStore.getState().bindings;
      const mode = store.mode;

      if (isEditableTarget(e.target)) {
        // Build-mode shortcuts (W/A/S/D/Q/Cmd+Z/...) must still fire when focus
        // is on the coordinate inputs, otherwise typing a coord and hitting an
        // undo shortcut silently inserts the character instead of undoing.
        // Escape is excluded so it stays a per-input cancel (clearing the draft)
        // rather than exiting build mode.
        if (mode !== "build" || key === "escape") return;
        const editAction = actionForKey(bindings.edit, key, ctrl, shift, alt);
        const matches =
          !!actionForKey(bindings.build, key, ctrl, shift, alt) ||
          editAction === "undo" ||
          editAction === "redo";
        if (!matches) return;
        (e.target as HTMLElement).blur();
      }

      // Global shortcuts (work in both modes). Run before mode-specific bindings.
      // Ctrl/Cmd-modified globals: copy, paste, export.
      if (ctrl && !alt && !shift) {
        switch (key) {
          case "c":
            if (store.selectedKeys.size > 0) {
              e.preventDefault();
              store.copySelection();
              return;
            }
            break;
          case "v":
            if (store.clipboard && store.clipboard.size > 0) {
              e.preventDefault();
              store.pasteClipboard();
              return;
            }
            break;
          case "s":
            e.preventDefault();
            void downloadDae(store.blocks);
            return;
        }
      }

      if (!ctrl && !alt) {
        if (!shift) {
          switch (key) {
            case "tab":
              e.preventDefault();
              store.setMode(mode === "build" ? "edit" : "build");
              return;
            case "1": e.preventDefault(); store.setIsoView("x"); return;
            case "2": e.preventDefault(); store.setIsoView("y"); return;
            case "3": e.preventDefault(); store.setIsoView("z"); return;
            case "4": {
              e.preventDefault();
              const controls = controlsRef.current;
              const wasPersp = store.viewMode.kind === "persp";
              store.setPerspView();
              // When already in persp, switching is a no-op — re-center camera
              // to match the fresh-camera behaviour of switching from iso.
              if (wasPersp && controls?.target0 && controls?.position0) {
                animateCamera(controls, controls.target0.clone(), controls.position0.clone());
              }
              return;
            }
            // `g` is now bound to groupToggle in edit-mode keybinds (see keybindStore).
            // Grid toggle moved to Shift+G — handled by the shift branch below.
            case "h": e.preventDefault(); store.toggleShowHints(); return;
            case "t": {
              e.preventDefault();
              let minX = Infinity, minY = Infinity, minZ = Infinity;
              let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
              let count = 0;
              for (const block of store.blocks.values()) {
                const [sx, sy, sz] = blockTqecSize(block.type);
                const { x, y, z } = block.pos;
                if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
                if (x + sx > maxX) maxX = x + sx;
                if (y + sy > maxY) maxY = y + sy;
                if (z + sz > maxZ) maxZ = z + sz;
                count++;
              }
              for (const k of store.portPositions) {
                const [x, y, z] = k.split(",").map(Number);
                if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
                if (x + 1 > maxX) maxX = x + 1;
                if (y + 1 > maxY) maxY = y + 1;
                if (z + 1 > maxZ) maxZ = z + 1;
                count++;
              }
              if (count === 0) return;
              const threeCenter = new THREE.Vector3(
                (minX + maxX) / 2,
                (minZ + maxZ) / 2,
                -(minY + maxY) / 2,
              );
              const dX = maxX - minX, dY = maxY - minY, dZ = maxZ - minZ;
              const diameter = Math.sqrt(dX * dX + dY * dY + dZ * dZ);
              const controls = controlsRef.current;
              if (!controls) return;
              if (store.viewMode.kind === "persp") {
                const camera = controls.object as THREE.PerspectiveCamera;
                const fovRad = (camera.fov * Math.PI) / 180;
                const margin = 1.2;
                const distance = Math.max(diameter / 2 / Math.tan(fovRad / 2) * margin, 2);
                const dir = camera.position.clone().sub(controls.target);
                if (dir.lengthSq() < 1e-6) dir.set(1, 1, -1);
                dir.normalize();
                animateCamera(
                  controls,
                  threeCenter,
                  threeCenter.clone().add(dir.multiplyScalar(distance)),
                );
              } else {
                // Iso: step slice to bbox center on depth axis, then pan target in-plane.
                const axis = store.viewMode.axis;
                const centerDepth = axis === "x"
                  ? (minX + maxX) / 2
                  : axis === "y"
                  ? (minY + maxY) / 2
                  : (minZ + maxZ) / 2;
                const sliceDelta = Math.round(centerDepth) - store.viewMode.slice;
                if (sliceDelta !== 0) store.stepSlice(sliceDelta);
                // Let the IsoViewport effect reposition the ortho camera, then
                // animate the in-plane pan.
                requestAnimationFrame(() => {
                  const c = controlsRef.current;
                  if (!c) return;
                  const camObj = c.object as THREE.Object3D;
                  const offset = camObj.position.clone().sub(c.target);
                  animateCamera(c, threeCenter, threeCenter.clone().add(offset));
                });
              }
              return;
            }
            case ".": {
              e.preventDefault();
              const all = [
                ...store.selectedKeys,
                ...store.selectedPortPositions,
              ];
              if (all.length === 0) return;
              let sx = 0, sy = 0, sz = 0;
              for (const k of all) {
                const [x, y, z] = k.split(",").map(Number);
                sx += x; sy += y; sz += z;
              }
              const n = all.length;
              const [tx, ty, tz] = tqecToThree({ x: sx / n, y: sy / n, z: sz / n });
              const newTarget = new THREE.Vector3(tx, ty, tz);
              const controls = controlsRef.current;
              if (!controls) return;
              const camera = controls.object as THREE.Object3D;
              const offset = camera.position.clone().sub(controls.target);
              animateCamera(controls, newTarget, newTarget.clone().add(offset));
              return;
            }
          }
        }
        // ? requires shift (on US layouts); match the literal key.
        if (e.key === "?") {
          e.preventDefault();
          setKeybindEditorMode("general");
          return;
        }
        // Shift+G toggles the grid (relocated from `g`, which now groups
        // selected blocks via the edit-mode keybind). Global, mode-agnostic.
        if (shift && key === "g") {
          e.preventDefault();
          store.toggleShowGrid();
          return;
        }
      }

      if (mode === "build") {
        const action = actionForKey(bindings.build, key, ctrl, shift, alt);
        if (!action) {
          // Also honor the edit-mode undo/redo bindings (Cmd+Z / Cmd+Shift+Z)
          // while in build mode — users expect Cmd+Z to undo anywhere.
          const editAction = actionForKey(bindings.edit, key, ctrl, shift, alt);
          if (editAction === "undo") { e.preventDefault(); store.undo(); return; }
          if (editAction === "redo") { e.preventDefault(); store.redo(); return; }
          return;
        }
        e.preventDefault();
        switch (action) {
          case "moveForward":
          case "moveBack":
          case "moveLeft":
          case "moveRight":
          case "moveUp":
          case "moveDown": {
            const controls = controlsRef.current;
            if (!controls) return;
            const dirKey = actionToWasdKey(action);
            let direction;
            if (store.viewMode.kind === "iso") {
              direction = isoBuildDirection(dirKey, store.viewMode.axis);
            } else {
              const { axisAbsoluteWasd } = useKeybindStore.getState();
              direction = wasdToBuildDirection(dirKey, controls.getAzimuthalAngle(), axisAbsoluteWasd);
            }
            store.buildMove(direction);
            return;
          }
          case "undo": store.undoBuildStep(); return;
          case "cycleBlock": store.cycleBlock(); return;
          case "cyclePipe": store.cyclePipe(); return;
          case "deleteAtCursor": store.deleteAtBuildCursor(); return;
          case "exitBuild": store.setMode("edit"); return;
        }
        return;
      }

      const action = actionForKey<string>(
        bindings.edit as Record<string, KeyBinding>,
        key,
        ctrl,
        shift,
        alt,
      );
      if (!action) return;

      switch (action) {
        case "selectAll":
          e.preventDefault();
          store.selectAll();
          return;
        case "deleteSelection":
          if (store.selectedKeys.size > 0 || store.selectedPortPositions.size > 0) {
            e.preventDefault();
            store.deleteSelected();
          }
          return;
        case "copy":
          if (store.selectedKeys.size > 0) {
            e.preventDefault();
            store.copySelection();
          }
          return;
        case "paste":
          if (store.clipboard && store.clipboard.size > 0) {
            e.preventDefault();
            store.pasteClipboard();
          }
          return;
        case "clearSelection":
          // Escape: disarm tool first (type → pointer → clear selection).
          if (store.armedTool !== "pointer") {
            e.preventDefault();
            store.setArmedTool("pointer");
          } else if (store.selectedKeys.size > 0) {
            e.preventDefault();
            store.clearSelection();
          }
          return;
        case "holdToDelete":
          // No-op on keydown; held-state is tracked by the dedicated listener below.
          return;
        case "undo":
          e.preventDefault();
          store.undo();
          return;
        case "redo":
          e.preventDefault();
          store.redo();
          return;
        case "stepForward":
          if (store.viewMode.kind === "iso") {
            e.preventDefault();
            store.stepSlice(3);
          }
          return;
        case "stepBack":
          if (store.viewMode.kind === "iso") {
            e.preventDefault();
            store.stepSlice(-3);
          }
          return;
        case "flipColors":
          if (store.selectedKeys.size > 0) {
            e.preventDefault();
            store.flipSelected();
          }
          return;
        case "rotateCcw":
        case "rotateCw":
        case "rotateXCcw":
        case "rotateXCw":
        case "rotateYCcw":
        case "rotateYCw":
        case "flipX":
        case "flipY":
        case "flipZ": {
          if (store.selectedKeys.size === 0) return;
          e.preventDefault();
          const { axis, operation } = ROTATION_ACTIONS[action as RotationActionName];
          const hovered = store.hoveredGridPos;
          const pivotOverride = hovered && store.selectedKeys.has(posKey(hovered)) ? hovered : null;
          const result = store.rotateSelected(axis, operation, pivotOverride);
          if (!result.ok) {
            const verb = operation === "flip" ? "Flip" : "Rotation";
            toastBus.error.emit(`${verb} aborted: ${result.reason}`);
          }
          return;
        }
        case "cyclePrev":
        case "cycleNext": {
          e.preventDefault();
          const dir = action === "cyclePrev" ? -1 : 1;
          // With a single selection in edit mode + pointer, cycle the selected
          // item through its valid toolbar options instead of swapping the
          // armed type (which would lift the selection).
          const single =
            store.mode === "edit" &&
            store.armedTool === "pointer" &&
            ((store.selectedKeys.size === 1 && store.selectedPortPositions.size === 0)
              || (store.selectedKeys.size === 0 && store.selectedPortPositions.size === 1));
          if (single) store.cycleSelectedType(dir);
          else store.cycleArmedType(dir);
          return;
        }
        case "groupToggle": {
          e.preventDefault();
          // One-time migration toast: `g` used to toggle the grid, now groups
          // selected blocks (Shift+G is the new grid toggle). Surface once
          // per browser via localStorage flag.
          try {
            if (!localStorage.getItem(GROUP_KEYMAP_MIGRATION_KEY)) {
              // Migration notice = info, not error — don't clobber an
              // in-progress verify's invalid-block highlights.
              toastBus.info.emit(
                "G now groups selected blocks. Use Shift+G to toggle the grid.",
              );
              localStorage.setItem(GROUP_KEYMAP_MIGRATION_KEY, "1");
            }
          } catch (err) {
            // localStorage unavailable (private mode etc.) — silently skip the
            // migration toast; the action itself still runs.
            void err;
          }
          store.groupToggle();
          return;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Drag-from-palette: on toolbar button pointerdown, paletteDragging is set
  // true. The cursor-over-canvas pointermove already updates hoveredGridPos
  // (via GridPlane). On pointerup, place at that position if valid — using
  // the same dispatch as GridPlane.handleClick (addPortAt vs addBlock).
  // Also clear the flag on cancel/blur so a hijacked gesture (e.g. native
  // drag, alt-tab) can't leave the next click stuck placing blocks.
  useEffect(() => {
    const onUp = () => {
      const s = useBlockStore.getState();
      if (!s.paletteDragging) return;
      s.setPaletteDragging(false);
      const pos = s.hoveredGridPos;
      if (!pos || s.hoveredInvalid) return;
      if (s.armedTool === "port") s.addPortAt(pos);
      else if (s.armedTool === "cube" || s.armedTool === "pipe") s.addBlock(pos);
    };
    const onCancel = () => {
      const s = useBlockStore.getState();
      if (s.paletteDragging) s.setPaletteDragging(false);
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("dragend", onCancel);
    window.addEventListener("blur", onCancel);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("dragend", onCancel);
      window.removeEventListener("blur", onCancel);
    };
  }, []);

  // Hold-to-delete modifier (default X): while held in Drag / Drop mode, clicks
  // delete the hovered block regardless of the currently armed tool. The
  // BlockInstances/GhostBlock components read store.xHeld to switch to a
  // red-preview cursor.
  useEffect(() => {
    const matches = (e: KeyboardEvent) => {
      const binding = useKeybindStore.getState().bindings.edit.holdToDelete;
      if (!binding) return false;
      return (
        e.key.toLowerCase() === binding.key &&
        !!binding.ctrl === (e.ctrlKey || e.metaKey) &&
        !!binding.shift === e.shiftKey &&
        !!binding.alt === e.altKey
      );
    };
    const onDown = (e: KeyboardEvent) => {
      if (!matches(e)) return;
      const store = useBlockStore.getState();
      if (store.mode !== "edit") return;
      if (store.xHeld) return;
      store.setXHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (!matches(e)) return;
      if (useBlockStore.getState().xHeld) useBlockStore.getState().setXHeld(false);
    };
    const onBlur = () => {
      if (useBlockStore.getState().xHeld) useBlockStore.getState().setXHeld(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    function readAutosaveSnapshot(): SceneSnapshotV1 {
      const snapshot: SceneSnapshotV1 = { v: 1, blocks: [], portMeta: [], portPositions: [] };
      try {
        const raw = localStorage.getItem(AUTOSAVE_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            // Run the same validator the URL-share path uses — a buggy prior
            // version, browser-extension tampering, or partial localStorage
            // write could leave malformed blocks (especially malformed
            // groupId values) that would otherwise bypass the GROUP_ID_RE
            // gate. Drop the autosave entirely on a shape mismatch.
            const candidate: SceneSnapshotV1 = { v: 1, blocks: parsed as SceneSnapshotV1["blocks"], portMeta: [], portPositions: [] };
            if (isSceneSnapshotV1(candidate)) {
              snapshot.blocks = candidate.blocks;
            }
          }
        }
      } catch {
        localStorage.removeItem(AUTOSAVE_KEY);
      }
      try {
        const rawMeta = localStorage.getItem(AUTOSAVE_META_KEY);
        if (rawMeta) {
          const parsed = JSON.parse(rawMeta) as {
            portMeta?: SceneSnapshotV1["portMeta"];
            portPositions?: string[];
          };
          if (parsed.portMeta) snapshot.portMeta = parsed.portMeta;
          if (parsed.portPositions) snapshot.portPositions = parsed.portPositions;
        }
      } catch {
        localStorage.removeItem(AUTOSAVE_META_KEY);
      }
      return snapshot;
    }

    function clearShareHash() {
      if (typeof window === "undefined") return;
      if (parseSceneHashParam(window.location.hash)) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }

    function resetTransientUI() {
      // Recipient of a shared URL shouldn't inherit our build cursor / clipboard /
      // paste preview — those are tied to coordinates that don't exist in the
      // shared scene. Reset to a clean edit-mode pointer.
      useBlockStore.setState({
        mode: "edit",
        armedTool: "pointer",
        pipeVariant: null,
        clipboard: null,
        buildCursor: null,
        portWarning: null,
      });
    }

    // The banner is hydrated from the pre-share localStorage key in
    // useState's initializer above; no explicit setSharedSceneBanner here.
    const sharedHash = parseSceneHashParam(window.location.hash);
    if (!sharedHash) {
      applySnapshot(readAutosaveSnapshot(), "hydrate");
      // Boot finished synchronously; release the autosave subscriber. The
      // async path below does the same on its terminal setAutosaveReady.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAutosaveReady(true);
      return;
    }

    const autosaveSnapshot = readAutosaveSnapshot();
    let cancelled = false;
    void (async () => {
      const shared = await decodeSnapshotFromHash(window.location.hash);
      if (cancelled) return;
      if (shared) {
        const hadAutosave =
          autosaveSnapshot.blocks.length > 0 || autosaveSnapshot.portPositions.length > 0;
        // Persist the user's autosave to the pre-share key BEFORE applying the
        // shared scene. The autosave subscriber (gated on autosaveReady) is
        // still off here, but we also write before the apply so a refresh
        // mid-flight doesn't strand the user with no recovery path.
        if (hadAutosave) {
          writePreShareSnapshot(autosaveSnapshot);
          setSharedSceneBanner({ previousSnapshot: autosaveSnapshot });
        }
        applySnapshot(shared, "hydrate");
        resetTransientUI();
        clearShareHash();
      } else {
        applySnapshot(autosaveSnapshot, "hydrate");
        clearShareHash();
      }
      setAutosaveReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Hold the subscriber off until the boot effect has finished hydrating.
    // Otherwise the hydrate's `setState` would fire the subscriber and the
    // debounced flush would overwrite the user's autosave with a half-loaded
    // shared scene (or worse, an empty one if decode fails) — see C6 / C3.
    if (!autosaveReady) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const flush = (blocks: Map<string, Block>) => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(Array.from(blocks.entries())));
      } catch (err) {
        // Quota exceeded or storage unavailable — ignore.
        void err;
      }
    };
    const flushMeta = () => {
      try {
        const s = useBlockStore.getState();
        localStorage.setItem(
          AUTOSAVE_META_KEY,
          JSON.stringify({
            portMeta: Array.from(s.portMeta.entries()),
            portPositions: Array.from(s.portPositions),
          }),
        );
      } catch (err) {
        // private mode / unavailable — ignore
        void err;
      }
    };
    const unsub = useBlockStore.subscribe((state, prev) => {
      const blocksChanged = state.blocks !== prev.blocks;
      const metaChanged =
        state.portMeta !== prev.portMeta || state.portPositions !== prev.portPositions;
      if (!blocksChanged && !metaChanged) return;
      if (timeout !== null) clearTimeout(timeout);
      const snapshot = state.blocks;
      timeout = setTimeout(() => {
        flush(snapshot);
        flushMeta();
      }, AUTOSAVE_DEBOUNCE_MS);
    });
    return () => {
      if (timeout !== null) {
        clearTimeout(timeout);
        flush(useBlockStore.getState().blocks);
        flushMeta();
      }
      unsub();
    };
  }, [autosaveReady]);

  // Persist the Y-defect overlay toggle across sessions. Initial value is
  // hydrated in the store factory; this effect just writes back on changes.
  useEffect(() => {
    return useBlockStore.subscribe((state, prev) => {
      if (state.showYDefects === prev.showYDefects) return;
      try {
        localStorage.setItem("piperDraw.showYDefects", state.showYDefects ? "1" : "0");
      } catch (err) {
        // private mode / unavailable — ignore
        void err;
      }
    });
  }, []);

  return (
    <>
      <Toolbar
        onResetCamera={() => {
          const controls = controlsRef.current;
          if (!controls) return;
          const viewMode = useBlockStore.getState().viewMode;
          if (viewMode.kind === "iso") {
            const sliceZero = { ...viewMode, slice: 0 };
            animateCamera(controls, isoTargetThree(sliceZero), isoCameraThree(sliceZero), {
              onComplete: () => {
                const cur = useBlockStore.getState();
                if (cur.viewMode.kind === "iso" && cur.viewMode.slice !== 0) {
                  cur.stepSlice(-cur.viewMode.slice);
                }
              },
            });
            return;
          }
          animateCamera(controls, controls.target0.clone(), controls.position0.clone());
        }}
        controlsRef={controlsRef}
        toolbarRef={toolbarRef}
        fpsRef={fpsRef}
        onOpenKeybindEditor={setKeybindEditorMode}
      />
      <ValidationToast toolbarRef={toolbarRef} controlsRef={controlsRef} />
      {sharedSceneBanner && (
        <SharedSceneBanner
          previousSnapshot={sharedSceneBanner.previousSnapshot}
          onRestore={(snapshot) => {
            applySnapshot(snapshot, "load");
            clearPreShareSnapshot();
            setSharedSceneBanner(null);
          }}
          onDismiss={() => {
            clearPreShareSnapshot();
            setSharedSceneBanner(null);
          }}
        />
      )}
      <button
        onClick={() => setHelpOpen(true)}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="About piper-draw"
        title="About piper-draw"
        style={{
          position: "fixed",
          bottom: 10,
          left: 10,
          zIndex: 1,
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "1px solid #ddd",
          background: "rgba(255,255,255,0.9)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
          cursor: "pointer",
          fontFamily: "sans-serif",
          fontSize: 16,
          fontWeight: 600,
          color: "#555",
          padding: 0,
          lineHeight: 1,
        }}
      >
        ?
      </button>
      {helpOpen && (
        <HelpPanel
          onClose={() => {
            setHelpOpen(false);
            try {
              localStorage.setItem('piperDraw.seenIntro', '1');
            } catch (err) {
              // ignore (e.g. private mode)
              void err;
            }
          }}
        />
      )}
      <FlowsPanel controlsRef={controlsRef} toolbarRef={toolbarRef} />
      <ZXPanel controlsRef={controlsRef} toolbarRef={toolbarRef} />
      {showHints && <EditModeHints onCustomize={() => setKeybindEditorMode("edit")} />}
      {showHints && <BuildModeHints onCustomize={() => setKeybindEditorMode("build")} />}
      {keybindEditorMode && (
        <KeybindEditor initialMode={keybindEditorMode} onClose={() => setKeybindEditorMode(null)} />
      )}
      <PlacementWarning toolbarRef={toolbarRef} />
      <Canvas
        gl={{ toneMapping: THREE.ACESFilmicToneMapping, preserveDrawingBuffer: true }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <color attach="background" args={["#CBDFC6"]} />
        <ambientLight intensity={1.4} />
        <directionalLight position={[10, 10, 10]} intensity={1.0} />
        <BlockInstances />
        {!photoRequest && !flowVizMode && <FoldOutCubeOverlay />}
        {!photoRequest && !flowVizMode && <InvalidBlockHighlights />}
        {!photoRequest && <LocatePulseHighlight />}
        {!photoRequest && !flowVizMode && <SelectionHighlights />}
        {!photoRequest && !flowVizMode && <GroupOutlines />}
        {!photoRequest && !flowVizMode && <DragGhost />}
        {!photoRequest && !flowVizMode && <DragShadow />}
        {!photoRequest && !flowVizMode && <BuildCursor />}
        {!photoRequest && !flowVizMode && <OpenPipeGhosts />}
      {!photoRequest && (flowsPanelOpen || zxPanelOpen || flowVizMode) && <PortLabels3D />}
        {!photoRequest && <FlowSurfaceOverlay />}
        {!photoRequest && <YDefectOverlay />}
        <CameraBuildSnap controlsRef={controlsRef} />
        <GridPlane />
        {!photoRequest && !flowVizMode && <GhostBlock />}
        {!photoRequest && !flowVizMode && <PasteGhost />}
        <AxisLabels />
        <FpsSampler targetRef={fpsRef} />
        {!photoRequest && showGrid && <CheckerboardGrid />}
        {!photoRequest && (
          <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
            <OrientationGizmo />
          </GizmoHelper>
        )}
        <ScreenshotCapture />
        <ThreeStateBridge stateRef={threeStateRef} />
        <ViewportCamera controlsRef={controlsRef} />
        <NavControlsModifier controlsRef={controlsRef} />
      </Canvas>
      <SelectModePointer threeStateRef={threeStateRef} controlsRef={controlsRef} />
    </>
  );
}
