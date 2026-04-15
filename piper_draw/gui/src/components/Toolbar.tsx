import { useBlockStore } from "../stores/blockStore";
import { useValidationStore } from "../stores/validationStore";
import { CUBE_TYPES, PIPE_VARIANTS, isPipeType, pipeAxisFromPos } from "../types";
import type { BlockType, Position3D } from "../types";
import { downloadDae } from "../utils/daeExport";
import { triggerDaeImport } from "../utils/daeImport";
import * as THREE from "three";
import { usePreviewImages } from "./PreviewRenderer";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const groupLabelStyle = {
  fontSize: "11px",
  fontFamily: "sans-serif",
  color: "#888",
  fontWeight: "bold" as const,
  letterSpacing: "0.5px",
  textAlign: "center" as const,
};

const previewWrapStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 44,
  minHeight: 44,
};

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

const blockBtnStyle = (active: boolean) => ({
  ...btnStyle(active),
  display: "flex" as const,
  flexDirection: "column" as const,
  alignItems: "center" as const,
  justifyContent: "flex-start" as const,
  padding: "4px 8px",
});

// ---------------------------------------------------------------------------
// Toolbar component
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Toolbar({ onResetCamera, controlsRef, toolbarRef }: { onResetCamera: () => void; controlsRef: React.RefObject<any>; toolbarRef: React.RefObject<HTMLDivElement | null> }) {
  const mode = useBlockStore((s) => s.mode);
  const setMode = useBlockStore((s) => s.setMode);
  const cubeType = useBlockStore((s) => s.cubeType);
  const pipeVariant = useBlockStore((s) => s.pipeVariant);
  const setCubeType = useBlockStore((s) => s.setCubeType);
  const setPipeVariant = useBlockStore((s) => s.setPipeVariant);
  const historyLen = useBlockStore((s) => s.history.length);
  const futureLen = useBlockStore((s) => s.future.length);
  const undo = useBlockStore((s) => s.undo);
  const redo = useBlockStore((s) => s.redo);
  const clearAll = useBlockStore((s) => s.clearAll);
  const loadBlocks = useBlockStore((s) => s.loadBlocks);
  const blocksEmpty = useBlockStore((s) => s.blocks.size === 0);
  const selectedCount = useBlockStore((s) => {
    if (s.selectedKeys.size === 0) return 0;
    let count = 0;
    for (const key of s.selectedKeys) if (s.blocks.has(key)) count++;
    return count;
  });
  const deleteSelected = useBlockStore((s) => s.deleteSelected);

  const buildCursor = useBlockStore((s) => s.buildCursor);
  const hoveredGridPos = useBlockStore((s) => s.hoveredGridPos);

  const previewImages = usePreviewImages(controlsRef);

  const validationStatus = useValidationStore((s) => s.status);
  const runValidation = useValidationStore((s) => s.validate);

  const setCameraPreset = (position: [number, number, number]) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const camera = controls.object as THREE.PerspectiveCamera;
    camera.position.set(...position);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  const previewImg = (key: string) => {
    const src = previewImages.get(key);
    return src ? (
      <img src={src} alt={key} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
    ) : null;
  };

  return (
    <div
      ref={toolbarRef}
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
      {/* Mode buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", justifyContent: "center" }}>
        <button onClick={() => setMode("place")} style={btnStyle(mode === "place")}>
          Place
        </button>
        <button onClick={() => setMode("select")} style={btnStyle(mode === "select")}>
          Select
        </button>
        <button onClick={() => setMode("delete")} style={btnStyle(mode === "delete")}>
          Delete
        </button>
        <button onClick={() => setMode("build")} style={btnStyle(mode === "build")}>
          Build
        </button>
        <button onClick={onResetCamera} style={btnStyle(false)}>
          Origin
        </button>
      </div>

      {/* View buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", justifyContent: "center" }}>
        <button onClick={() => setCameraPreset([35, 35, 0.01])} style={{ ...btnStyle(false), whiteSpace: "nowrap" }}>
          X View
        </button>
        <button onClick={() => setCameraPreset([0.01, 35, -35])} style={{ ...btnStyle(false), whiteSpace: "nowrap" }}>
          Y View
        </button>
        <button onClick={() => setCameraPreset([0, 50, 0.01])} style={{ ...btnStyle(false), whiteSpace: "nowrap" }}>
          Z View
        </button>
      </div>

      {/* Undo / Redo / Clear */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", justifyContent: "center" }}>
        <button
          onClick={undo}
          disabled={historyLen === 0}
          style={{ ...btnStyle(false), opacity: historyLen === 0 ? 0.4 : 1, cursor: historyLen === 0 ? "default" : "pointer" }}
        >
          Undo
        </button>
        <button
          onClick={redo}
          disabled={futureLen === 0}
          style={{ ...btnStyle(false), opacity: futureLen === 0 ? 0.4 : 1, cursor: futureLen === 0 ? "default" : "pointer" }}
        >
          Redo
        </button>
        <button
          onClick={clearAll}
          disabled={blocksEmpty}
          style={{ ...btnStyle(false), opacity: blocksEmpty ? 0.4 : 1, cursor: blocksEmpty ? "default" : "pointer" }}
        >
          Clear
        </button>
        {selectedCount > 0 && (
          <button
            onClick={deleteSelected}
            style={{ ...btnStyle(false), borderColor: "#dc3545", color: "#dc3545" }}
          >
            Delete {selectedCount}
          </button>
        )}
        <button
          onClick={runValidation}
          disabled={blocksEmpty || validationStatus === "loading"}
          style={{
            ...btnStyle(false),
            opacity: blocksEmpty ? 0.4 : 1,
            cursor: blocksEmpty || validationStatus === "loading" ? "default" : "pointer",
            borderColor:
              validationStatus === "valid" ? "#28a745" :
              validationStatus === "invalid" ? "#dc3545" :
              "#ccc",
            background:
              validationStatus === "valid" ? "#d4edda" :
              validationStatus === "invalid" ? "#f8d7da" :
              validationStatus === "loading" ? "#e8f0fe" :
              "#fff",
          }}
        >
          {validationStatus === "loading" ? "Verifying..." : "Verify"}
        </button>
      </div>

      {/* Import / Export */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", justifyContent: "center" }}>
        <button onClick={() => triggerDaeImport(loadBlocks)} style={btnStyle(false)}>
          Import
        </button>
        <button
          onClick={() => downloadDae(useBlockStore.getState().blocks)}
          disabled={blocksEmpty}
          style={{ ...btnStyle(false), opacity: blocksEmpty ? 0.4 : 1, cursor: blocksEmpty ? "default" : "pointer" }}
        >
          Export
        </button>
      </div>

      {/* Separator */}
      <div style={{ width: 1, background: "#ddd" }} />

      {/* Blocks group (ZXCubes + Y) */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", opacity: mode === "build" ? 0.4 : 1, pointerEvents: mode === "build" ? "none" : "auto" }}>
        <span style={groupLabelStyle}>Blocks</span>
        <div style={{ display: "flex", gap: "4px", flex: 1, alignItems: "stretch" }}>
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
              <div style={previewWrapStyle}>{previewImg(ct)}</div>
            </button>
          ))}
          <button
            onClick={() => {
              setCubeType("Y");
              setMode("place");
            }}
            style={blockBtnStyle(cubeType === "Y" && mode === "place")}
          >
            Y
            <div style={previewWrapStyle}>{previewImg("Y")}</div>
          </button>
        </div>
      </div>

      {/* Separator */}
      <div style={{ width: 1, background: "#ddd" }} />

      {/* Pipes group */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", opacity: mode === "build" ? 0.4 : 1, pointerEvents: mode === "build" ? "none" : "auto" }}>
        <span style={groupLabelStyle}>Pipes</span>
        <div style={{ display: "flex", gap: "4px", flex: 1, alignItems: "stretch" }}>
          {PIPE_VARIANTS.map((v) => (
            <button
              key={v}
              onClick={() => {
                setPipeVariant(v);
                setMode("place");
              }}
              style={blockBtnStyle(pipeVariant === v && mode === "place")}
            >
              {v}
              <div style={previewWrapStyle}>{previewImg(v)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Position display */}
      <div style={{ width: 1, background: "#ddd" }} />
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", fontFamily: "monospace", fontSize: "12px", color: "#555", lineHeight: "1.6", minWidth: 90 }}>
        <span style={groupLabelStyle}>Position</span>
        {(() => {
          const pos: Position3D | null = mode === "build" ? buildCursor : hoveredGridPos;
          const bt: BlockType | null = mode === "build" ? null : useBlockStore.getState().hoveredBlockType;
          if (!pos) return <><span>X: —</span><span>Y: —</span><span>Z: —</span></>;
          const isPipe = bt ? isPipeType(bt) : pipeAxisFromPos(pos) !== null;
          if (isPipe) {
            const axis = pipeAxisFromPos(pos);
            const coords = [pos.x, pos.y, pos.z];
            const labels = ["X", "Y", "Z"];
            return labels.map((l, i) => {
              if (i === axis) {
                const c1 = (coords[i] - 1) / 3;
                const c2 = (coords[i] + 2) / 3;
                return <span key={i}>{l}: {c1} → {c2}</span>;
              }
              return <span key={i}>{l}: {coords[i] / 3}</span>;
            });
          }
          return <><span>X: {pos.x / 3}</span><span>Y: {pos.y / 3}</span><span>Z: {pos.z / 3}</span></>;
        })()}
      </div>
    </div>
  );
}
