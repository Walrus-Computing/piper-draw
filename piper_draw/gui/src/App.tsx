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
import { CUBE_TYPES } from "./types";
import type { CubeType } from "./types";

const btnStyle = (active: boolean) => ({
  padding: "4px 12px",
  fontSize: "13px",
  fontFamily: "sans-serif" as const,
  cursor: "pointer" as const,
  border: active ? "2px solid #4a9eff" : "1px solid #ccc",
  borderRadius: "4px",
  background: active ? "#e8f0fe" : "#fff",
  fontWeight: active ? ("bold" as const) : ("normal" as const),
});

function Toolbar() {
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
        gap: "6px",
        alignItems: "center",
        background: "rgba(255,255,255,0.9)",
        padding: "6px 12px",
        borderRadius: "8px",
        border: "1px solid #ddd",
        boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
      }}
    >
      <button onClick={() => setMode("place")} style={btnStyle(mode === "place")}>
        Place
      </button>
      <button onClick={() => setMode("delete")} style={btnStyle(mode === "delete")}>
        Delete
      </button>
      <div style={{ marginLeft: "8px", display: "flex", gap: "4px" }}>
        {CUBE_TYPES.map((ct) => (
          <button
            key={ct}
            onClick={() => {
              setCubeType(ct as CubeType);
              setMode("place");
            }}
            style={btnStyle(cubeType === ct && mode === "place")}
          >
            {ct}
          </button>
        ))}
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
      <Toolbar />
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: 10,
          right: 16,
          zIndex: 1,
          display: "flex",
          gap: "8px",
          alignItems: "center",
          background: "rgba(255,255,255,0.9)",
          padding: "6px 12px",
          borderRadius: "8px",
          border: "1px solid #ddd",
          boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
        }}
      >
        <button
          onClick={() => controlsRef.current?.reset()}
          style={btnStyle(false)}
        >
          Return origin
        </button>
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
