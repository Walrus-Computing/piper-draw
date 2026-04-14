import { useBlockStore } from "../stores/blockStore";
import { CUBE_TYPES, PIPE_VARIANTS, X_HEX, Z_HEX, Y_HEX, H_HEX } from "../types";
import type { BlockType, PipeVariant } from "../types";
import { downloadDae } from "../utils/daeExport";
import { triggerDaeImport } from "../utils/daeImport";
import * as THREE from "three";

function basisHex(ch: string): string {
  return ch === "X" ? X_HEX : Z_HEX;
}

// ---------------------------------------------------------------------------
// Isometric SVG previews
// ---------------------------------------------------------------------------

/**
 * Isometric cube SVG matching the default camera at [10, 10, -10].
 * Camera screen-right is (-1,0,-1), so:
 *   Top   = +Y Three.js = TQEC Z-axis
 *   Left  = +X Three.js = TQEC X-axis
 *   Right = -Z Three.js = TQEC Y-axis
 */
function CubePreview({ cubeType }: { cubeType: string }) {
  const xColor = basisHex(cubeType[0]);
  const yColor = basisHex(cubeType[1]);
  const zColor = basisHex(cubeType[2]);
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
      <polygon
        points={`${cx},${cy - topH} ${cx + dx},${cy} ${cx},${cy + topH} ${cx - dx},${cy}`}
        fill={Y_HEX}
        stroke="#000"
        strokeWidth={0.7}
      />
      <polygon
        points={`${cx - dx},${cy} ${cx},${cy + topH} ${cx},${cy + topH + sideH} ${cx - dx},${cy + sideH}`}
        fill={Y_HEX}
        stroke="#000"
        strokeWidth={0.7}
        opacity={0.85}
      />
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
 * Pipe preview colors mapped to isometric faces.
 * left = TQEC X-axis, right = TQEC Y-axis, top = TQEC Z-axis.
 * openDir indicates which TQEC axis is open (z = top open, y = right open).
 */
const PIPE_COLORS: Record<string, { left: string; right: string; top: string; openDir: "z" | "y" | "x"; hadamard?: boolean }> = {
  ZXO:  { left: Z_HEX, right: X_HEX, top: "",     openDir: "z" },
  XZO:  { left: X_HEX, right: Z_HEX, top: "",     openDir: "z" },
  ZXOH: { left: Z_HEX, right: X_HEX, top: "",     openDir: "z", hadamard: true },
  XZOH: { left: X_HEX, right: Z_HEX, top: "",     openDir: "z", hadamard: true },
  ZOX:  { left: Z_HEX, right: "",    top: X_HEX,  openDir: "y" },
  XOZ:  { left: X_HEX, right: "",    top: Z_HEX,  openDir: "y" },
  ZOXH: { left: Z_HEX, right: "",    top: X_HEX,  openDir: "y", hadamard: true },
  XOZH: { left: X_HEX, right: "",    top: Z_HEX,  openDir: "y", hadamard: true },
  OZX:  { left: "",     right: Z_HEX, top: X_HEX, openDir: "x" },
  OXZ:  { left: "",     right: X_HEX, top: Z_HEX, openDir: "x" },
  OZXH: { left: "",     right: Z_HEX, top: X_HEX, openDir: "x", hadamard: true },
  OXZH: { left: "",     right: X_HEX, top: Z_HEX, openDir: "x", hadamard: true },
};

/** Isometric pipe preview — cuboid with one open face. */
function PipePreview({ pipeType }: { pipeType: string }) {
  const { left, right, top, openDir, hadamard } = PIPE_COLORS[pipeType];

  if (openDir === "z") return <ZPipePreviewSvg left={left} right={right} hadamard={hadamard} />;
  if (openDir === "y") return <YPipePreviewSvg left={left} top={top} hadamard={hadamard} />;
  return <XPipePreviewSvg right={right} top={top} hadamard={hadamard} />;
}

/** Z-open pipe preview: tall cuboid, top face open. */
function ZPipePreviewSvg({ left, right, hadamard }: { left: string; right: string; hadamard?: boolean }) {
  const dx = 9, topH = 5, sideH = 20;
  const cx = 11, cy = 7;
  const svgW = cx * 2, svgH = cy + topH + sideH + 1;
  const leftAbove = hadamard ? right : left;
  const rightAbove = hadamard ? left : right;
  const bandH = 2;
  const midL = cy + sideH / 2;
  const midR = cy + topH + sideH / 2;

  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", margin: "2px auto 0" }}>
      {/* Inner walls visible through open top */}
      <polygon points={`${cx - dx},${cy} ${cx},${cy - topH} ${cx},${cy + topH + sideH} ${cx - dx},${cy + sideH}`}
        fill={rightAbove} stroke="#000" strokeWidth={0.7} opacity={0.5} />
      <polygon points={`${cx + dx},${cy} ${cx},${cy - topH} ${cx},${cy + topH + sideH} ${cx + dx},${cy + sideH}`}
        fill={leftAbove} stroke="#000" strokeWidth={0.7} opacity={0.6} />
      {/* Top face — dashed outline */}
      <polygon points={`${cx},${cy - topH} ${cx + dx},${cy} ${cx},${cy + topH} ${cx - dx},${cy}`}
        fill="none" stroke="#000" strokeWidth={0.7} strokeDasharray="2 1.5" />
      {hadamard ? (
        <>
          <polygon points={`${cx - dx},${cy} ${cx},${cy + topH} ${cx},${midR - bandH} ${cx - dx},${midL - bandH}`}
            fill={leftAbove} stroke="#000" strokeWidth={0.7} opacity={0.85} />
          <polygon points={`${cx - dx},${midL - bandH} ${cx},${midR - bandH} ${cx},${midR + bandH} ${cx - dx},${midL + bandH}`}
            fill={H_HEX} stroke="#000" strokeWidth={0.5} opacity={0.9} />
          <polygon points={`${cx - dx},${midL + bandH} ${cx},${midR + bandH} ${cx},${cy + topH + sideH} ${cx - dx},${cy + sideH}`}
            fill={left} stroke="#000" strokeWidth={0.7} opacity={0.85} />
          <polygon points={`${cx + dx},${cy} ${cx},${cy + topH} ${cx},${midR - bandH} ${cx + dx},${midL - bandH}`}
            fill={rightAbove} stroke="#000" strokeWidth={0.7} opacity={0.7} />
          <polygon points={`${cx + dx},${midL - bandH} ${cx},${midR - bandH} ${cx},${midR + bandH} ${cx + dx},${midL + bandH}`}
            fill={H_HEX} stroke="#000" strokeWidth={0.5} opacity={0.8} />
          <polygon points={`${cx + dx},${midL + bandH} ${cx},${midR + bandH} ${cx},${cy + topH + sideH} ${cx + dx},${cy + sideH}`}
            fill={right} stroke="#000" strokeWidth={0.7} opacity={0.7} />
        </>
      ) : (
        <>
          <polygon points={`${cx - dx},${cy} ${cx},${cy + topH} ${cx},${cy + topH + sideH} ${cx - dx},${cy + sideH}`}
            fill={left} stroke="#000" strokeWidth={0.7} opacity={0.85} />
          <polygon points={`${cx + dx},${cy} ${cx},${cy + topH} ${cx},${cy + topH + sideH} ${cx + dx},${cy + sideH}`}
            fill={right} stroke="#000" strokeWidth={0.7} opacity={0.7} />
        </>
      )}
    </svg>
  );
}

/** Y-open pipe preview: wide cuboid, right face open. */
function YPipePreviewSvg({ left, top, hadamard }: { left: string; top: string; hadamard?: boolean }) {
  const dxL = 9, topHL = 5;
  const dxR = 18, topHR = 10;
  const sideH = 10;
  const cx = 10, cy = 7;

  const bk = [cx, cy];
  const rt = [cx + dxR, cy + topHR];
  const fr = [cx - dxL + dxR, cy + topHL + topHR];
  const lt = [cx - dxL, cy + topHL];

  const leftAbove = hadamard ? top : left;
  const topAbove = hadamard ? left : top;

  const bandW = 2;
  const yLen = Math.sqrt(dxR * dxR + topHR * topHR);
  const ybx = bandW * dxR / yLen;
  const yby = bandW * topHR / yLen;

  const lf_midT = [(lt[0] + fr[0]) / 2, (lt[1] + fr[1]) / 2];
  const lf_midB = [lf_midT[0], lf_midT[1] + sideH];

  const tf_bkrt_mid = [(bk[0] + rt[0]) / 2, (bk[1] + rt[1]) / 2];
  const tf_ltfr_mid = [(lt[0] + fr[0]) / 2, (lt[1] + fr[1]) / 2];

  const svgW = rt[0] + 1;
  const svgH = fr[1] + sideH + 1;

  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", margin: "2px auto 0" }}>
      <polygon points={`${bk[0]},${bk[1]} ${rt[0]},${rt[1]} ${rt[0]},${rt[1] + sideH} ${bk[0]},${bk[1] + sideH}`}
        fill={leftAbove} stroke="#000" strokeWidth={0.7} opacity={0.5} />
      <polygon points={`${bk[0]},${bk[1] + sideH} ${rt[0]},${rt[1] + sideH} ${fr[0]},${fr[1] + sideH} ${lt[0]},${lt[1] + sideH}`}
        fill={top} stroke="#000" strokeWidth={0.7} opacity={0.6} />
      <polygon points={`${bk[0]},${bk[1]} ${rt[0]},${rt[1]} ${fr[0]},${fr[1]} ${lt[0]},${lt[1]}`}
        fill={hadamard ? undefined : top} stroke="#000" strokeWidth={0.7} />
      {hadamard ? (
        <>
          <polygon points={`${bk[0]},${bk[1]} ${tf_bkrt_mid[0] - ybx},${tf_bkrt_mid[1] - yby} ${tf_ltfr_mid[0] - ybx},${tf_ltfr_mid[1] - yby} ${lt[0]},${lt[1]}`}
            fill={top} stroke="#000" strokeWidth={0.5} />
          <polygon points={`${tf_bkrt_mid[0] - ybx},${tf_bkrt_mid[1] - yby} ${tf_bkrt_mid[0] + ybx},${tf_bkrt_mid[1] + yby} ${tf_ltfr_mid[0] + ybx},${tf_ltfr_mid[1] + yby} ${tf_ltfr_mid[0] - ybx},${tf_ltfr_mid[1] - yby}`}
            fill={H_HEX} stroke="#000" strokeWidth={0.5} />
          <polygon points={`${tf_bkrt_mid[0] + ybx},${tf_bkrt_mid[1] + yby} ${rt[0]},${rt[1]} ${fr[0]},${fr[1]} ${tf_ltfr_mid[0] + ybx},${tf_ltfr_mid[1] + yby}`}
            fill={topAbove} stroke="#000" strokeWidth={0.5} />
          <polygon points={`${lt[0]},${lt[1]} ${lf_midT[0] - ybx},${lf_midT[1] - yby} ${lf_midB[0] - ybx},${lf_midB[1] - yby} ${lt[0]},${lt[1] + sideH}`}
            fill={left} stroke="#000" strokeWidth={0.7} />
          <polygon points={`${lf_midT[0] - ybx},${lf_midT[1] - yby} ${lf_midT[0] + ybx},${lf_midT[1] + yby} ${lf_midB[0] + ybx},${lf_midB[1] + yby} ${lf_midB[0] - ybx},${lf_midB[1] - yby}`}
            fill={H_HEX} stroke="#000" strokeWidth={0.5} />
          <polygon points={`${lf_midT[0] + ybx},${lf_midT[1] + yby} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + sideH} ${lf_midB[0] + ybx},${lf_midB[1] + yby}`}
            fill={leftAbove} stroke="#000" strokeWidth={0.7} />
        </>
      ) : (
        <>
          <polygon points={`${lt[0]},${lt[1]} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + sideH} ${lt[0]},${lt[1] + sideH}`}
            fill={left} stroke="#000" strokeWidth={0.7} />
        </>
      )}
      <polygon points={`${rt[0]},${rt[1]} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + sideH} ${rt[0]},${rt[1] + sideH}`}
        fill="none" stroke="#000" strokeWidth={0.7} strokeDasharray="2 1.5" />
    </svg>
  );
}

/** X-open pipe preview: wide cuboid extended left, left face open. */
function XPipePreviewSvg({ right, top, hadamard }: { right: string; top: string; hadamard?: boolean }) {
  const dxL = 18, topHL = 10;
  const dxR = 9, topHR = 5;
  const sideH = 10;
  const cx = 19, cy = 7;

  const bk = [cx, cy];
  const rt = [cx + dxR, cy + topHR];
  const fr = [cx - dxL + dxR, cy + topHL + topHR];
  const lt = [cx - dxL, cy + topHL];

  const rightAbove = hadamard ? top : right;
  const topAbove = hadamard ? right : top;

  const bandW = 2;
  const xLen = Math.sqrt(dxL * dxL + topHL * topHL);
  const bx = bandW * dxL / xLen;
  const by = bandW * topHL / xLen;

  const tf_bklt_mid = [(bk[0] + lt[0]) / 2, (bk[1] + lt[1]) / 2];
  const tf_rtfr_mid = [(rt[0] + fr[0]) / 2, (rt[1] + fr[1]) / 2];

  const rf_midTR = [(rt[0] + fr[0]) / 2, (rt[1] + fr[1]) / 2];
  const rf_midBR = [rf_midTR[0], rf_midTR[1] + sideH];

  const svgW = rt[0] + 1;
  const svgH = Math.max(lt[1], fr[1]) + sideH + 1;

  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", margin: "2px auto 0" }}>
      <polygon points={`${bk[0]},${bk[1]} ${lt[0]},${lt[1]} ${lt[0]},${lt[1] + sideH} ${bk[0]},${bk[1] + sideH}`}
        fill={rightAbove} stroke="#000" strokeWidth={0.7} opacity={0.5} />
      <polygon points={`${bk[0]},${bk[1] + sideH} ${rt[0]},${rt[1] + sideH} ${fr[0]},${fr[1] + sideH} ${lt[0]},${lt[1] + sideH}`}
        fill={top} stroke="#000" strokeWidth={0.7} opacity={0.6} />
      <polygon points={`${bk[0]},${bk[1]} ${rt[0]},${rt[1]} ${fr[0]},${fr[1]} ${lt[0]},${lt[1]}`}
        fill={hadamard ? undefined : top} stroke="#000" strokeWidth={0.7} />
      {hadamard ? (
        <>
          <polygon points={`${bk[0]},${bk[1]} ${rt[0]},${rt[1]} ${tf_rtfr_mid[0] + bx},${tf_rtfr_mid[1] - by} ${tf_bklt_mid[0] + bx},${tf_bklt_mid[1] - by}`}
            fill={top} stroke="#000" strokeWidth={0.5} />
          <polygon points={`${tf_bklt_mid[0] + bx},${tf_bklt_mid[1] - by} ${tf_rtfr_mid[0] + bx},${tf_rtfr_mid[1] - by} ${tf_rtfr_mid[0] - bx},${tf_rtfr_mid[1] + by} ${tf_bklt_mid[0] - bx},${tf_bklt_mid[1] + by}`}
            fill={H_HEX} stroke="#000" strokeWidth={0.5} />
          <polygon points={`${tf_bklt_mid[0] - bx},${tf_bklt_mid[1] + by} ${tf_rtfr_mid[0] - bx},${tf_rtfr_mid[1] + by} ${fr[0]},${fr[1]} ${lt[0]},${lt[1]}`}
            fill={topAbove} stroke="#000" strokeWidth={0.5} />
          <polygon points={`${rt[0]},${rt[1]} ${rf_midTR[0] + bx},${rf_midTR[1] - by} ${rf_midBR[0] + bx},${rf_midBR[1] - by} ${rt[0]},${rt[1] + sideH}`}
            fill={right} stroke="#000" strokeWidth={0.7} />
          <polygon points={`${rf_midTR[0] + bx},${rf_midTR[1] - by} ${rf_midTR[0] - bx},${rf_midTR[1] + by} ${rf_midBR[0] - bx},${rf_midBR[1] + by} ${rf_midBR[0] + bx},${rf_midBR[1] - by}`}
            fill={H_HEX} stroke="#000" strokeWidth={0.5} />
          <polygon points={`${rf_midTR[0] - bx},${rf_midTR[1] + by} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + sideH} ${rf_midBR[0] - bx},${rf_midBR[1] + by}`}
            fill={rightAbove} stroke="#000" strokeWidth={0.7} />
        </>
      ) : (
        <>
          <polygon points={`${rt[0]},${rt[1]} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + sideH} ${rt[0]},${rt[1] + sideH}`}
            fill={right} stroke="#000" strokeWidth={0.7} />
        </>
      )}
      <polygon points={`${lt[0]},${lt[1]} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + sideH} ${lt[0]},${lt[1] + sideH}`}
        fill="none" stroke="#000" strokeWidth={0.7} strokeDasharray="2 1.5" />
    </svg>
  );
}

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
export function Toolbar({ onResetCamera, controlsRef }: { onResetCamera: () => void; controlsRef: React.RefObject<any> }) {
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

  const setCameraPreset = (position: [number, number, number]) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const camera = controls.object as THREE.PerspectiveCamera;
    camera.position.set(...position);
    controls.target.set(0, 0, 0);
    controls.update();
  };

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
      {/* Mode buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", justifyContent: "center" }}>
        <button onClick={() => setMode("place")} style={btnStyle(mode === "place")}>
          Place
        </button>
        <button onClick={() => setMode("delete")} style={btnStyle(mode === "delete")}>
          Delete
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
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
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
              <div style={previewWrapStyle}><CubePreview cubeType={ct} /></div>
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
            <div style={previewWrapStyle}><YHalfCubePreview /></div>
          </button>
        </div>
      </div>

      {/* Separator */}
      <div style={{ width: 1, background: "#ddd" }} />

      {/* Pipes group (4 variants — open axis determined by position) */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={groupLabelStyle}>Pipes</span>
        <div style={{ display: "flex", gap: "4px", flex: 1, alignItems: "stretch" }}>
          {PIPE_VARIANTS.map((v) => {
            // Use Z-open canonical form for preview
            const previewType: Record<PipeVariant, string> = { ZX: "ZXO", XZ: "XZO", ZXH: "ZXOH", XZH: "XZOH" };
            return (
              <button
                key={v}
                onClick={() => {
                  setPipeVariant(v);
                  setMode("place");
                }}
                style={blockBtnStyle(pipeVariant === v && mode === "place")}
              >
                {v}
                <div style={previewWrapStyle}><PipePreview pipeType={previewType[v]} /></div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
