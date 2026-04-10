import { useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  GizmoHelper,
  Grid,
} from "@react-three/drei";
import { BlockInstances } from "./components/BlockInstances";
import { GridPlane } from "./components/GridPlane";
import { GhostBlock } from "./components/GhostBlock";
import { AxisLabels } from "./components/AxisLabels";
import { FpsDisplay, FpsSampler } from "./components/FpsCounter";
import { OrientationGizmo } from "./components/OrientationGizmo";
import { useBlockStore } from "./stores/blockStore";
import { CUBE_TYPES, PIPE_TYPES } from "./types";
import type { BlockType } from "./types";

const X_HEX = "#ff4444";
const Z_HEX = "#4488ff";

/** Face colors per cube type: [X-axis, Y-axis, Z-axis] matching CUBE_FACE_COLORS */
const CUBE_COLORS: Record<string, [string, string, string]> = {
  XZZ: [X_HEX, Z_HEX, Z_HEX],
  ZXZ: [Z_HEX, X_HEX, Z_HEX],
  ZXX: [Z_HEX, X_HEX, X_HEX],
  XXZ: [X_HEX, X_HEX, Z_HEX],
  ZZX: [Z_HEX, Z_HEX, X_HEX],
  XZX: [X_HEX, Z_HEX, X_HEX],
};

/**
 * Isometric cube SVG matching the default camera at [10, 10, -10].
 * Camera screen-right is (-1,0,-1), so:
 *   Top   = +Y Three.js = TQEC Z-axis
 *   Left  = +X Three.js = TQEC X-axis
 *   Right = -Z Three.js = TQEC Y-axis
 */
function CubePreview({ cubeType }: { cubeType: string }) {
  const [xColor, yColor, zColor] = CUBE_COLORS[cubeType];
  // True isometric proportions: edge=10, dx=8.66, top_h=5, side_h=10
  const dx = 9, topH = 5, sideH = 10;
  const cx = 11, cy = 7;
  const svgW = cx * 2, svgH = cy + topH + sideH + 1;
  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", margin: "2px auto 0" }}>
      {/* Top face (TQEC Z-axis) */}
      <polygon
        points={`${cx},${cy - topH} ${cx + dx},${cy} ${cx},${cy + topH} ${cx - dx},${cy}`}
        fill={zColor}
        stroke="#000"
        strokeWidth={0.7}
      />
      {/* Left face (TQEC X-axis) — slightly darkened */}
      <polygon
        points={`${cx - dx},${cy} ${cx},${cy + topH} ${cx},${cy + topH + sideH} ${cx - dx},${cy + sideH}`}
        fill={xColor}
        stroke="#000"
        strokeWidth={0.7}
        opacity={0.85}
      />
      {/* Right face (TQEC Y-axis) — slightly more darkened */}
      <polygon
        points={`${cx + dx},${cy} ${cx},${cy + topH} ${cx},${cy + topH + sideH} ${cx + dx},${cy + sideH}`}
        fill={yColor}
        stroke="#000"
        strokeWidth={0.7}
        opacity={0.7}
      />
    </svg>
  );
}

const Y_HEX = "#44cc44";

/** Isometric half-cube (half-height in Z/temporal) preview, all green. */
function YHalfCubePreview() {
  // Same isometric angles as CubePreview but sideH halved; same total SVG height
  const dx = 9, topH = 5, sideH = 5;
  const fullSideH = 10;
  const cx = 11;
  const svgH = 7 + topH + fullSideH + 1; // match CubePreview height (23)
  const svgW = cx * 2;
  // Shift down so the half-cube sits at the bottom of the same viewport
  const cy = 7 + (fullSideH - sideH);
  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", margin: "2px auto 0" }}>
      {/* Top face */}
      <polygon
        points={`${cx},${cy - topH} ${cx + dx},${cy} ${cx},${cy + topH} ${cx - dx},${cy}`}
        fill={Y_HEX}
        stroke="#000"
        strokeWidth={0.7}
      />
      {/* Left face */}
      <polygon
        points={`${cx - dx},${cy} ${cx},${cy + topH} ${cx},${cy + topH + sideH} ${cx - dx},${cy + sideH}`}
        fill={Y_HEX}
        stroke="#000"
        strokeWidth={0.7}
        opacity={0.85}
      />
      {/* Right face */}
      <polygon
        points={`${cx + dx},${cy} ${cx},${cy + topH} ${cx},${cy + topH + sideH} ${cx + dx},${cy + sideH}`}
        fill={Y_HEX}
        stroke="#000"
        strokeWidth={0.7}
        opacity={0.7}
      />
    </svg>
  );
}

/**
 * Pipe preview colors: [X-axis color, Y-axis color, Z-axis open].
 * Open faces shown as dashed outline only.
 */
const PIPE_COLORS: Record<string, { left: string; right: string; topOpen: boolean }> = {
  ZXO: { left: Z_HEX, right: X_HEX, topOpen: true },
};

/** Isometric pipe preview — taller cuboid with open top face. */
function PipePreview({ pipeType }: { pipeType: string }) {
  const { left, right, topOpen } = PIPE_COLORS[pipeType];
  // Double height in Z → double sideH
  const dx = 9, topH = 5, sideH = 20;
  const cx = 11, cy = 7;
  const svgW = cx * 2, svgH = cy + topH + sideH + 1;
  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", margin: "2px auto 0" }}>
      {topOpen && (
        <>
          {/* Inner right wall (TQEC Y-axis) visible through open top */}
          <polygon
            points={`${cx - dx},${cy} ${cx},${cy - topH} ${cx},${cy + topH + sideH} ${cx - dx},${cy + sideH}`}
            fill={right}
            stroke="#000"
            strokeWidth={0.7}
            opacity={0.5}
          />
          {/* Inner left wall (TQEC X-axis) visible through open top */}
          <polygon
            points={`${cx + dx},${cy} ${cx},${cy - topH} ${cx},${cy + topH + sideH} ${cx + dx},${cy + sideH}`}
            fill={left}
            stroke="#000"
            strokeWidth={0.7}
            opacity={0.6}
          />
        </>
      )}
      {/* Top face — open: just outline, no fill */}
      <polygon
        points={`${cx},${cy - topH} ${cx + dx},${cy} ${cx},${cy + topH} ${cx - dx},${cy}`}
        fill={topOpen ? "none" : "#888"}
        stroke="#000"
        strokeWidth={0.7}
        strokeDasharray={topOpen ? "2 1.5" : undefined}
      />
      {/* Left face (TQEC X-axis) */}
      <polygon
        points={`${cx - dx},${cy} ${cx},${cy + topH} ${cx},${cy + topH + sideH} ${cx - dx},${cy + sideH}`}
        fill={left}
        stroke="#000"
        strokeWidth={0.7}
        opacity={0.85}
      />
      {/* Right face (TQEC Y-axis) */}
      <polygon
        points={`${cx + dx},${cy} ${cx},${cy + topH} ${cx},${cy + topH + sideH} ${cx + dx},${cy + sideH}`}
        fill={right}
        stroke="#000"
        strokeWidth={0.7}
        opacity={0.7}
      />
    </svg>
  );
}

const groupLabelStyle = {
  fontSize: "11px",
  fontFamily: "sans-serif",
  color: "#888",
  fontWeight: "bold" as const,
  letterSpacing: "0.5px",
  textAlign: "center" as const,
};

const blockBtnStyle = (active: boolean) => ({
  ...btnStyle(active),
  display: "flex" as const,
  flexDirection: "column" as const,
  alignItems: "center" as const,
  justifyContent: "flex-start" as const,
  padding: "4px 8px",
  minHeight: "46px",
});

const btnStyle = (active: boolean) => ({
  padding: "4px 12px",
  fontSize: "13px",
  fontFamily: "sans-serif" as const,
  cursor: "pointer" as const,
  border: active ? "2px solid #4a9eff" : "2px solid #ccc",
  borderRadius: "4px",
  background: active ? "#e8f0fe" : "#fff",
  fontWeight: "normal" as const,
});

function Toolbar({ onResetCamera }: { onResetCamera: () => void }) {
  const mode = useBlockStore((s) => s.mode);
  const setMode = useBlockStore((s) => s.setMode);
  const cubeType = useBlockStore((s) => s.cubeType);
  const setCubeType = useBlockStore((s) => s.setCubeType);

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1,
        display: "flex",
        gap: "10px",
        alignItems: "stretch",
        background: "rgba(255,255,255,0.9)",
        padding: "8px 12px",
        borderRadius: "8px",
        border: "1px solid #ddd",
        boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
      }}
    >
      {/* Mode + reset buttons */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <button onClick={() => setMode("place")} style={btnStyle(mode === "place")}>
            Place
          </button>
          <button onClick={() => setMode("delete")} style={btnStyle(mode === "delete")}>
            Delete
          </button>
        </div>
        <button onClick={onResetCamera} style={btnStyle(false)}>
          Origin
        </button>
      </div>

      {/* Separator */}
      <div style={{ width: 1, background: "#ddd" }} />

      {/* ZXCube group */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={groupLabelStyle}>ZXCube</span>
        <div style={{ display: "flex", gap: "4px" }}>
          {CUBE_TYPES.map((ct) => (
            <button
              key={ct}
              onClick={() => {
                setCubeType(ct as BlockType);
                setMode("place");
              }}
              style={blockBtnStyle(cubeType === ct && mode === "place")}
            >
              {ct}
              <CubePreview cubeType={ct} />
            </button>
          ))}
        </div>
      </div>

      {/* Separator */}
      <div style={{ width: 1, background: "#ddd" }} />

      {/* YHalfCube group */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={groupLabelStyle}>YHalfCube</span>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={() => {
              setCubeType("Y");
              setMode("place");
            }}
            style={blockBtnStyle(cubeType === "Y" && mode === "place")}
          >
            Y
            <YHalfCubePreview />
          </button>
        </div>
      </div>

      {/* Separator */}
      <div style={{ width: 1, background: "#ddd" }} />

      {/* Pipes group */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={groupLabelStyle}>Pipes</span>
        <div style={{ display: "flex", gap: "4px" }}>
          {PIPE_TYPES.map((pt) => (
            <button
              key={pt}
              onClick={() => {
                setCubeType(pt as BlockType);
                setMode("place");
              }}
              style={blockBtnStyle(cubeType === pt && mode === "place")}
            >
              {pt}
              <PipePreview pipeType={pt} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [fps, setFps] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);

  return (
    <>
      <Toolbar onResetCamera={() => controlsRef.current?.reset()} />
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
        <FpsDisplay fps={fps} />
      </div>
      <Canvas
        camera={{ position: [10, 10, -10], fov: 50 }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 10]} intensity={0.8} />
        <BlockInstances />
        <GridPlane />
        <GhostBlock />
        <AxisLabels />
        <FpsSampler onFps={setFps} />
        <Grid
          infiniteGrid
          cellSize={1}
          sectionSize={5}
          cellColor="#aaaaaa"
          sectionColor="#888888"
          fadeDistance={200}
          fadeStrength={2}
          cellThickness={0.5}
          sectionThickness={1}
        />
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <OrientationGizmo />
        </GizmoHelper>
        <OrbitControls ref={controlsRef} makeDefault />
      </Canvas>
    </>
  );
}
