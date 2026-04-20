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
import { AxisLabels } from "./components/AxisLabels";
import { FpsSampler } from "./components/FpsCounter";
import { OrientationGizmo } from "./components/OrientationGizmo";
import { Toolbar } from "./components/Toolbar";
import { ValidationToast } from "./components/ValidationToast";
import { InvalidBlockHighlights } from "./components/InvalidBlockHighlights";
import { SelectionHighlights } from "./components/SelectionHighlights";
import { BuildCursor } from "./components/BuildCursor";
import { SelectModePointer, type ThreeState } from "./components/SelectModePointer";
import { DragGhost } from "./components/DragGhost";
import { NavControlsModifier } from "./components/NavControlsModifier";
import { OpenPipeGhosts } from "./components/OpenPipeGhosts";
import { FoldOutCubeOverlay } from "./components/FoldOutCubeOverlay";
import { BuildModeHints } from "./components/BuildModeHints";
import { EditModeHints } from "./components/EditModeHints";
import { KeybindEditor } from "./components/KeybindEditor";
import { HelpPanel } from "./components/HelpPanel";
import { useBlockStore } from "./stores/blockStore";
import {
  useKeybindStore,
  actionForKey,
  actionToWasdKey,
  type KeyBinding,
  type Mode,
} from "./stores/keybindStore";
import { wasdToBuildDirection, tqecToThree, type Block, type ViewMode } from "./types";
import { cameraGroundPoint } from "./utils/groundPlane";
import { animateCamera } from "./utils/cameraAnim";
import { downloadPng } from "./utils/photoExport";
import {
  ISO_INITIAL_ZOOM,
  isoBuildDirection,
  isoCameraThree,
  isoGridMeshTransform,
  isoTargetThree,
  isoUpThree,
} from "./utils/isoView";

const GRID_SNAP = 3;

const AUTOSAVE_KEY = "piper-draw:autosave:v1";
const AUTOSAVE_DEBOUNCE_MS = 500;

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
          mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
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

  // Position the orthographic camera + orbit target whenever the iso slice/axis changes.
  useEffect(() => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam) return;
    const target = isoTargetThree(viewMode);
    const pos = isoCameraThree(viewMode);
    cam.up.copy(isoUpThree(viewMode.axis));
    cam.position.copy(pos);
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
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      />
    </>
  );
}

/**
 * Snaps the camera to the build direction target when cameraSnapTarget changes.
 * In perspective mode, animates camera + orbit target. In iso mode, the camera
 * is locked to the active slice — instead of moving the camera, advance the
 * slice when the cursor moves along the depth axis (the IsoViewport effect
 * then re-positions the ortho camera to follow).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CameraBuildSnap({ controlsRef }: { controlsRef: React.RefObject<any> }) {
  const cameraSnapTarget = useBlockStore((s) => s.cameraSnapTarget);
  const lastBuildAxis = useBlockStore((s) => s.lastBuildAxis);
  const clearCameraSnap = useBlockStore((s) => s.clearCameraSnap);
  const viewMode = useBlockStore((s) => s.viewMode);
  const stepSlice = useBlockStore((s) => s.stepSlice);
  const { camera } = useThree();
  const prevTarget = useRef<{ azimuth: number | null; targetPos: { x: number; y: number; z: number } } | null>(null);
  const prevBuildAxis = useRef<number | null>(null);

  useFrame(() => {
    if (!cameraSnapTarget || !controlsRef.current) return;
    if (prevTarget.current === cameraSnapTarget) return;
    prevTarget.current = cameraSnapTarget;

    if (viewMode.kind === "iso") {
      const target = cameraSnapTarget.targetPos;
      const cursorDepth =
        viewMode.axis === "x" ? target.x : viewMode.axis === "y" ? target.y : target.z;
      const delta = cursorDepth - viewMode.slice;
      if (delta !== 0) stepSlice(delta);
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
  const [keybindEditorMode, setKeybindEditorMode] = useState<Mode | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const threeStateRef = useRef<ThreeState | null>(null);
  const photoRequest = useBlockStore((s) => s.photoRequest);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const alt = e.altKey;
      const store = useBlockStore.getState();
      const bindings = useKeybindStore.getState().bindings;
      const mode = store.mode;

      if (mode === "build") {
        const action = actionForKey(bindings.build, key, ctrl, shift, alt);
        if (!action) return;
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
          if (store.selectedKeys.size > 0) {
            e.preventDefault();
            store.deleteSelected();
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
          // Skip slice-step when the pointer tool has a selection — SelectModePointer
          // handles ↑/↓ as a Z-nudge of the selection.
          if (store.viewMode.kind === "iso" && !(store.armedTool === "pointer" && store.selectedKeys.size > 0)) {
            e.preventDefault();
            store.stepSlice(3);
          }
          return;
        case "stepBack":
          if (store.viewMode.kind === "iso" && !(store.armedTool === "pointer" && store.selectedKeys.size > 0)) {
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
        case "cyclePrev":
          e.preventDefault();
          store.cycleArmedType(-1);
          return;
        case "cycleNext":
          e.preventDefault();
          store.cycleArmedType(1);
          return;
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
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          useBlockStore.getState().hydrateBlocks(new Map<string, Block>(parsed));
        }
      }
    } catch {
      localStorage.removeItem(AUTOSAVE_KEY);
    }
  }, []);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const flush = (blocks: Map<string, Block>) => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(Array.from(blocks.entries())));
      } catch {
        // Quota exceeded or storage unavailable — ignore.
      }
    };
    const unsub = useBlockStore.subscribe((state, prev) => {
      if (state.blocks === prev.blocks) return;
      if (timeout !== null) clearTimeout(timeout);
      const snapshot = state.blocks;
      timeout = setTimeout(() => flush(snapshot), AUTOSAVE_DEBOUNCE_MS);
    });
    return () => {
      if (timeout !== null) {
        clearTimeout(timeout);
        flush(useBlockStore.getState().blocks);
      }
      unsub();
    };
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
      <button
        onClick={() => setHelpOpen(true)}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="About piper-draw"
        title="About piper-draw"
        style={{
          position: "fixed",
          bottom: 20,
          left: 20,
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
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
      <EditModeHints onCustomize={() => setKeybindEditorMode("edit")} />
      <BuildModeHints onCustomize={() => setKeybindEditorMode("build")} />
      {keybindEditorMode && (
        <KeybindEditor initialMode={keybindEditorMode} onClose={() => setKeybindEditorMode(null)} />
      )}
      <PlacementWarning toolbarRef={toolbarRef} />
      <Canvas
        gl={{ logarithmicDepthBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, preserveDrawingBuffer: true }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <color attach="background" args={["#CBDFC6"]} />
        <ambientLight intensity={1.4} />
        <directionalLight position={[10, 10, 10]} intensity={1.0} />
        <BlockInstances />
        {!photoRequest && <FoldOutCubeOverlay />}
        {!photoRequest && <InvalidBlockHighlights />}
        {!photoRequest && <SelectionHighlights />}
        {!photoRequest && <DragGhost />}
        {!photoRequest && <BuildCursor />}
        {!photoRequest && <OpenPipeGhosts />}
        <CameraBuildSnap controlsRef={controlsRef} />
        <GridPlane />
        {!photoRequest && <GhostBlock />}
        <AxisLabels />
        <FpsSampler targetRef={fpsRef} />
        {!photoRequest && <CheckerboardGrid />}
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
