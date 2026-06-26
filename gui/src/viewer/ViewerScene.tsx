import { useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import { BlockInstances } from "../components/BlockInstances";
import { FlowSurfaceOverlay } from "../components/FlowSurfaceOverlay";
import { AxisLabels } from "../components/AxisLabels";
import { autoFitCamera } from "../utils/sceneBounds";
import { downloadDae } from "../utils/daeExport";
import type { Block } from "../types";
import type { ViewSnapshotV1 } from "../utils/viewSnapshot";

/** Shown when a file has no (or an invalid) embedded diagram. */
export function EmptyMessage() {
  return <div className="viewer-empty">No diagram embedded in this file.</div>;
}

const HINT_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: 8,
  left: 8,
  font: "11px system-ui, sans-serif",
  color: "#555",
  background: "rgba(255,255,255,0.7)",
  padding: "3px 7px",
  borderRadius: 4,
  pointerEvents: "none",
  userSelect: "none",
};

const DAE_BTN_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 8,
  left: 8,
  font: "11px system-ui, sans-serif",
  color: "#333",
  background: "rgba(255,255,255,0.85)",
  border: "1px solid #ccc",
  borderRadius: 4,
  padding: "3px 8px",
  cursor: "pointer",
};

/**
 * Read-only embed scene: the lattice + the selected correlation surface, lit
 * and color-managed identically to the editor (App.tsx). No editor chrome,
 * ghosts, or highlights — just an orbit-able object. The captured camera sets
 * the opening view declaratively (position/up/zoom + OrbitControls target);
 * if no camera was captured, autoFitCamera frames the whole scene. OrbitControls
 * then owns interaction so the embed stays rotatable.
 */
export function ViewerScene({ view }: { view: ViewSnapshotV1 }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const blocks = useMemo(() => new Map<string, Block>(view.scene.blocks), [view]);
  const cam = view.camera ?? autoFitCamera(blocks.values());

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Canvas frameloop="demand" gl={{ toneMapping: THREE.ACESFilmicToneMapping }}>
        <color attach="background" args={[view.background]} />
        <ambientLight intensity={1.4} />
        <directionalLight position={[10, 10, 10]} intensity={1.0} />
        {/* Grid is intentionally excluded from embeds: just the lattice + surfaces.
            The CheckerboardGrid lives in App.tsx; importing it would pull the whole
            editor into the viewer bundle. view.showGrid is reserved for future use. */}
        <BlockInstances />
        <FlowSurfaceOverlay />
        <AxisLabels />
        {cam.kind === "ortho" ? (
          <OrthographicCamera
            makeDefault
            position={cam.position}
            up={cam.up}
            zoom={cam.zoom ?? 30}
            near={cam.near}
            far={cam.far}
          />
        ) : (
          <PerspectiveCamera
            makeDefault
            position={cam.position}
            up={cam.up}
            fov={cam.fov ?? 35}
            near={cam.near}
            far={cam.far}
          />
        )}
        <OrbitControls
          ref={controlsRef}
          makeDefault
          target={cam.target}
          enableRotate={cam.kind === "persp"}
          // In ortho mode rotation is disabled, so map left-drag to pan (else
          // left-drag is dead). Perspective keeps the default left=orbit.
          mouseButtons={
            cam.kind === "ortho"
              ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
              : undefined
          }
          dampingFactor={0.2}
          zoomToCursor
        />
      </Canvas>
      <button
        type="button"
        style={DAE_BTN_STYLE}
        title="Download this diagram as a Collada .dae file"
        onClick={() => void downloadDae(blocks)}
      >
        Download .dae
      </button>
      <div style={HINT_STYLE}>
        {cam.kind === "ortho"
          ? "Drag to pan · scroll to zoom"
          : "Drag to orbit · scroll to zoom · right-drag to pan"}
      </div>
    </div>
  );
}
