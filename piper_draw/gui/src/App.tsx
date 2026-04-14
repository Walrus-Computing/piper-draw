import { useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Disable color management to match tqec's Three.js v0.138.0 pipeline:
// colors are stored as-is (no sRGB↔linear conversion), only output encoding applies.
THREE.ColorManagement.enabled = false;
import {
  OrbitControls,
  GizmoHelper,
} from "@react-three/drei";
import { BlockInstances } from "./components/BlockInstances";
import { GridPlane } from "./components/GridPlane";
import { GhostBlock } from "./components/GhostBlock";
import { AxisLabels } from "./components/AxisLabels";
import { FpsDisplay, FpsSampler } from "./components/FpsCounter";
import { OrientationGizmo } from "./components/OrientationGizmo";
import { Toolbar } from "./components/Toolbar";
import { ValidationToast } from "./components/ValidationToast";
import { InvalidBlockHighlights } from "./components/InvalidBlockHighlights";
import { SelectionHighlights } from "./components/SelectionHighlights";
import { useBlockStore } from "./stores/blockStore";
import { cameraGroundPoint } from "./utils/groundPlane";

const GRID_SNAP = 3;

/**
 * Shader-based ground grid: dark grey cells at block positions (mod 3 ≡ 0),
 * light grey cells at pipe positions (mod 3 ≡ 1), with light edges on each cell.
 * No separate grid lines — the edge border provides the visual structure.
 */
const gridMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  vertexShader: `
    varying vec3 vWorldPos;
    void main() {
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vWorldPos;
    float pmod(float a, float b) { return a - b * floor(a / b); }
    void main() {
      // TQEC coords: x = Three.js x, y = -Three.js z
      float tx = vWorldPos.x;
      float ty = -vWorldPos.z;
      float mx = pmod(floor(tx), 3.0);
      float my = pmod(floor(ty), 3.0);

      bool xBlock = mx < 0.5;
      bool yBlock = my < 0.5;
      // Pipes span 2 cells: mod 3 ≡ 1 and ≡ 2
      bool xPipe = mx > 0.5;
      bool yPipe = my > 0.5;

      bool isBlock = xBlock && yBlock;
      bool isPipe = (xPipe && yBlock) || (xBlock && yPipe);

      if (!isBlock && !isPipe) discard;

      // Edge detection: for pipe cells, treat the 2-unit span as one tile
      // so the internal boundary between ≡ 1 and ≡ 2 cells is suppressed.
      float fx = fract(tx);
      float fy = fract(ty);
      float edgeWidth = 0.03;

      float edgeX, edgeY;
      if (isPipe && xPipe) {
        // Pipe spans x from pmod 1..3; remap to 0..2
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
        // Light edge
        gl_FragColor = vec4(0.85, 0.85, 0.85, 0.35);
      } else if (isBlock) {
        // Dark grey fill
        gl_FragColor = vec4(0.45, 0.45, 0.45, 0.18);
      } else {
        // Light grey fill
        gl_FragColor = vec4(0.65, 0.65, 0.65, 0.12);
      }

      // Fade with distance from origin for a clean look
      float dist = length(vWorldPos.xz);
      float fade = 1.0 - smoothstep(100.0, 300.0, dist);
      gl_FragColor.a *= fade;
    }
  `,
});

function CheckerboardGrid() {
  const ref = useRef<THREE.Mesh>(null!);
  const target = useRef(new THREE.Vector3());
  useFrame(({ camera }) => {
    if (!ref.current) return;
    if (cameraGroundPoint(camera, target.current)) {
      ref.current.position.x = Math.round(target.current.x / GRID_SNAP) * GRID_SNAP;
      ref.current.position.z = Math.round(target.current.z / GRID_SNAP) * GRID_SNAP;
    }
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[0, 0.001, 0]}>
      <planeGeometry args={[500, 500]} />
      <primitive object={gridMaterial} attach="material" />
    </mesh>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const modKey = isMac ? "\u2318" : "Ctrl+";

function SelectModeHints() {
  const mode = useBlockStore((s) => s.mode);
  if (mode !== "select") return null;

  const hints = [
    ["Click", "Select"],
    ["Shift+Click", "Add/remove"],
    [`${modKey}A`, "Select all"],
    ["Delete", "Delete selected"],
    ["Esc", "Clear selection"],
  ];

  return (
    <div
      style={{
        position: "fixed",
        bottom: 60,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1,
        display: "flex",
        gap: "6px",
        alignItems: "center",
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        padding: "6px 14px",
        borderRadius: "8px",
        fontSize: "12px",
        fontFamily: "sans-serif",
        pointerEvents: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        whiteSpace: "nowrap",
      }}
    >
      {hints.map(([key, action], i) => (
        <span key={key} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {i > 0 && <span style={{ color: "rgba(255,255,255,0.3)" }}>|</span>}
          <kbd
            style={{
              background: "rgba(255,255,255,0.15)",
              padding: "1px 5px",
              borderRadius: "3px",
              fontSize: "11px",
            }}
          >
            {key}
          </kbd>
          <span style={{ color: "rgba(255,255,255,0.7)" }}>{action}</span>
        </span>
      ))}
    </div>
  );
}

function PlacementWarning() {
  const reason = useBlockStore((s) => s.hoveredInvalidReason);
  if (!reason) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1,
        background: "rgba(180, 40, 40, 0.92)",
        color: "#fff",
        padding: "8px 18px",
        borderRadius: "8px",
        fontSize: "14px",
        fontWeight: 500,
        pointerEvents: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      }}
    >
      {reason}
    </div>
  );
}

export default function App() {
  const fpsRef = useRef<HTMLSpanElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;

      // Non-modifier shortcuts
      if (!ctrl) {
        if (key === "delete" || key === "backspace") {
          const store = useBlockStore.getState();
          if (store.selectedKeys.size > 0) {
            e.preventDefault();
            store.deleteSelected();
          }
          return;
        }
        if (key === "escape") {
          if (useBlockStore.getState().selectedKeys.size > 0) {
            e.preventDefault();
            useBlockStore.getState().clearSelection();
          }
          return;
        }
        return;
      }

      // Ctrl/Cmd shortcuts
      if (key === "a" && useBlockStore.getState().mode === "select") {
        e.preventDefault();
        useBlockStore.getState().selectAll();
      } else if (key === "z" && e.shiftKey) {
        e.preventDefault();
        useBlockStore.getState().redo();
      } else if (key === "z") {
        e.preventDefault();
        useBlockStore.getState().undo();
      } else if (key === "y") {
        e.preventDefault();
        useBlockStore.getState().redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <Toolbar onResetCamera={() => controlsRef.current?.reset()} controlsRef={controlsRef} toolbarRef={toolbarRef} />
      <ValidationToast toolbarRef={toolbarRef} />
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: 10,
          right: 16,
          zIndex: 1,
          background: "rgba(255,255,255,0.9)",
          padding: "6px 12px",
          borderRadius: "8px",
          border: "1px solid #ddd",
          boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
        }}
      >
        <FpsDisplay spanRef={fpsRef} />
      </div>
      <SelectModeHints />
      <PlacementWarning />
      <Canvas
        camera={{ position: [10, 10, -10], fov: 35 }}
        gl={{ logarithmicDepthBuffer: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <color attach="background" args={["#CBDFC6"]} />
        <ambientLight intensity={1.4} />
        <directionalLight position={[10, 10, 10]} intensity={1.0} />
        <BlockInstances />
        <InvalidBlockHighlights />
        <SelectionHighlights />
        <GridPlane />
        <GhostBlock />
        <AxisLabels />
        <FpsSampler targetRef={fpsRef} />
        <CheckerboardGrid />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <OrientationGizmo />
        </GizmoHelper>
        <OrbitControls ref={controlsRef} makeDefault />
      </Canvas>
    </>
  );
}
