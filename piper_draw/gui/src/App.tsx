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
import type { Mode } from "./stores/blockStore";

function Toolbar() {
  const mode = useBlockStore((s) => s.mode);
  const setMode = useBlockStore((s) => s.setMode);

  const btn = (m: Mode, label: string) => ({
    onClick: () => setMode(m),
    style: {
      padding: "4px 12px",
      fontSize: "13px",
      fontFamily: "sans-serif",
      cursor: "pointer" as const,
      border: mode === m ? "2px solid #4a9eff" : "1px solid #ccc",
      borderRadius: "4px",
      background: mode === m ? "#e8f0fe" : "#fff",
      fontWeight: mode === m ? ("bold" as const) : ("normal" as const),
    },
    children: label,
  });

  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1,
        display: "flex",
        gap: "6px",
      }}
    >
      <button {...btn("place", "Place")} />
      <button {...btn("delete", "Delete")} />
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
      <FpsDisplay fps={fps} />
      <button
        onClick={() => controlsRef.current?.reset()}
        style={{
          position: "fixed",
          top: 10,
          right: 100,
          zIndex: 1,
          padding: "4px 12px",
          fontSize: "13px",
          fontFamily: "sans-serif",
          cursor: "pointer",
          border: "1px solid #ccc",
          borderRadius: "4px",
          background: "#fff",
        }}
      >
        Return origin
      </button>
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
