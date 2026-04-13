import { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Disable color management to match tqec's Three.js v0.138.0 pipeline:
// colors are stored as-is (no sRGB↔linear conversion), only output encoding applies.
THREE.ColorManagement.enabled = false;
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

const X_HEX = "#ff7f7f";
const Z_HEX = "#7396ff";

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

const Y_HEX = "#63c676";

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

const H_HEX = "#ffff65";

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
  // Isometric axes: TQEC X → left (dxL, topHL), TQEC Y → right (dxR, topHR, doubled), TQEC Z → height (sideH)
  // Scaled to match Z-pipe: 9px per isometric unit
  const dxL = 9, topHL = 5;    // 1 unit TQEC X
  const dxR = 18, topHR = 10;  // 2 units TQEC Y
  const sideH = 10;            // 1 unit height
  const cx = 10, cy = 7;

  // Top face corners: back, right (+2Y), front (+X+2Y), left (+X)
  const bk = [cx, cy];
  const rt = [cx + dxR, cy + topHR];
  const fr = [cx - dxL + dxR, cy + topHL + topHR];
  const lt = [cx - dxL, cy + topHL];

  const leftAbove = hadamard ? top : left;
  const topAbove = hadamard ? left : top;

  // Band at midpoint of TQEC Y direction on each face
  const bandW = 2;

  // Normalized Y direction (bk→rt) for proper isometric band offsets
  const yLen = Math.sqrt(dxR * dxR + topHR * topHR);
  const ybx = bandW * dxR / yLen;   // SVG x offset toward rt
  const yby = bandW * topHR / yLen;  // SVG y offset toward rt

  // Left face band midpoints (halfway along the TQEC Y edge of the left face)
  const lf_midT = [(lt[0] + fr[0]) / 2, (lt[1] + fr[1]) / 2]; // top edge mid
  const lf_midB = [lf_midT[0], lf_midT[1] + sideH];            // bottom edge mid

  // Top face band midpoints: midpoint of bk→rt edge and lt→fr edge
  const tf_bkrt_mid = [(bk[0] + rt[0]) / 2, (bk[1] + rt[1]) / 2];
  const tf_ltfr_mid = [(lt[0] + fr[0]) / 2, (lt[1] + fr[1]) / 2];

  const svgW = rt[0] + 1;
  const svgH = fr[1] + sideH + 1;

  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", margin: "2px auto 0" }}>
      {/* Inner back wall visible through right opening */}
      <polygon points={`${bk[0]},${bk[1]} ${rt[0]},${rt[1]} ${rt[0]},${rt[1] + sideH} ${bk[0]},${bk[1] + sideH}`}
        fill={leftAbove} stroke="#000" strokeWidth={0.7} opacity={0.5} />
      {/* Bottom face (TQEC Z-axis) — visible through right opening */}
      <polygon points={`${bk[0]},${bk[1] + sideH} ${rt[0]},${rt[1] + sideH} ${fr[0]},${fr[1] + sideH} ${lt[0]},${lt[1] + sideH}`}
        fill={top} stroke="#000" strokeWidth={0.7} opacity={0.6} />
      {/* Top face (TQEC Z-axis) */}
      <polygon points={`${bk[0]},${bk[1]} ${rt[0]},${rt[1]} ${fr[0]},${fr[1]} ${lt[0]},${lt[1]}`}
        fill={hadamard ? undefined : top} stroke="#000" strokeWidth={0.7} />
      {hadamard ? (
        <>
          {/* Top face: back half (original) */}
          <polygon points={`${bk[0]},${bk[1]} ${tf_bkrt_mid[0] - ybx},${tf_bkrt_mid[1] - yby} ${tf_ltfr_mid[0] - ybx},${tf_ltfr_mid[1] - yby} ${lt[0]},${lt[1]}`}
            fill={top} stroke="#000" strokeWidth={0.5} />
          {/* Top face: yellow band */}
          <polygon points={`${tf_bkrt_mid[0] - ybx},${tf_bkrt_mid[1] - yby} ${tf_bkrt_mid[0] + ybx},${tf_bkrt_mid[1] + yby} ${tf_ltfr_mid[0] + ybx},${tf_ltfr_mid[1] + yby} ${tf_ltfr_mid[0] - ybx},${tf_ltfr_mid[1] - yby}`}
            fill={H_HEX} stroke="#000" strokeWidth={0.5} />
          {/* Top face: front half (swapped) */}
          <polygon points={`${tf_bkrt_mid[0] + ybx},${tf_bkrt_mid[1] + yby} ${rt[0]},${rt[1]} ${fr[0]},${fr[1]} ${tf_ltfr_mid[0] + ybx},${tf_ltfr_mid[1] + yby}`}
            fill={topAbove} stroke="#000" strokeWidth={0.5} />
          {/* Left face: back half (original) */}
          <polygon points={`${lt[0]},${lt[1]} ${lf_midT[0] - ybx},${lf_midT[1] - yby} ${lf_midB[0] - ybx},${lf_midB[1] - yby} ${lt[0]},${lt[1] + sideH}`}
            fill={left} stroke="#000" strokeWidth={0.7} />
          {/* Left face: yellow band */}
          <polygon points={`${lf_midT[0] - ybx},${lf_midT[1] - yby} ${lf_midT[0] + ybx},${lf_midT[1] + yby} ${lf_midB[0] + ybx},${lf_midB[1] + yby} ${lf_midB[0] - ybx},${lf_midB[1] - yby}`}
            fill={H_HEX} stroke="#000" strokeWidth={0.5} />
          {/* Left face: front half (swapped) */}
          <polygon points={`${lf_midT[0] + ybx},${lf_midT[1] + yby} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + sideH} ${lf_midB[0] + ybx},${lf_midB[1] + yby}`}
            fill={leftAbove} stroke="#000" strokeWidth={0.7} />
        </>
      ) : (
        <>
          {/* Left face (TQEC X-axis) */}
          <polygon points={`${lt[0]},${lt[1]} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + sideH} ${lt[0]},${lt[1] + sideH}`}
            fill={left} stroke="#000" strokeWidth={0.7} />
        </>
      )}
      {/* Right face — dashed outline (open) */}
      <polygon points={`${rt[0]},${rt[1]} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + sideH} ${rt[0]},${rt[1] + sideH}`}
        fill="none" stroke="#000" strokeWidth={0.7} strokeDasharray="2 1.5" />
    </svg>
  );
}

/** X-open pipe preview: wide cuboid extended left, left face open. */
function XPipePreviewSvg({ right, top, hadamard }: { right: string; top: string; hadamard?: boolean }) {
  // Isometric: TQEC X → left (dxL, topHL, doubled for 2 units), TQEC Y → right (dxR, topHR)
  // Scaled to match Z-pipe: 9px per isometric unit
  const dxL = 18, topHL = 10;  // 2 units TQEC X
  const dxR = 9, topHR = 5;    // 1 unit TQEC Y
  const sideH = 10;            // 1 unit height
  const cx = 19, cy = 7;

  // Top face corners: back, right (+Y), front (+X+Y), left (+X)
  const bk = [cx, cy];
  const rt = [cx + dxR, cy + topHR];
  const fr = [cx - dxL + dxR, cy + topHL + topHR];
  const lt = [cx - dxL, cy + topHL];

  const rightAbove = hadamard ? top : right;
  const topAbove = hadamard ? right : top;

  const bandW = 2;

  // Normalized X direction (bk→lt) for proper isometric band offsets
  const xLen = Math.sqrt(dxL * dxL + topHL * topHL);
  const bx = bandW * dxL / xLen;   // SVG x offset toward bk
  const by = bandW * topHL / xLen;  // SVG y offset toward bk

  // Top face band midpoints: midpoint of bk→lt edge and rt→fr edge
  const tf_bklt_mid = [(bk[0] + lt[0]) / 2, (bk[1] + lt[1]) / 2];
  const tf_rtfr_mid = [(rt[0] + fr[0]) / 2, (rt[1] + fr[1]) / 2];

  // Right face band midpoints (halfway along TQEC X on right face = midpoint of rt→fr edge)
  const rf_midTR = [(rt[0] + fr[0]) / 2, (rt[1] + fr[1]) / 2];
  const rf_midBR = [rf_midTR[0], rf_midTR[1] + sideH];

  const svgW = rt[0] + 1;
  const svgH = Math.max(lt[1], fr[1]) + sideH + 1;

  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", margin: "2px auto 0" }}>
      {/* Inner back wall visible through left opening */}
      <polygon points={`${bk[0]},${bk[1]} ${lt[0]},${lt[1]} ${lt[0]},${lt[1] + sideH} ${bk[0]},${bk[1] + sideH}`}
        fill={rightAbove} stroke="#000" strokeWidth={0.7} opacity={0.5} />
      {/* Bottom face visible through left opening */}
      <polygon points={`${bk[0]},${bk[1] + sideH} ${rt[0]},${rt[1] + sideH} ${fr[0]},${fr[1] + sideH} ${lt[0]},${lt[1] + sideH}`}
        fill={top} stroke="#000" strokeWidth={0.7} opacity={0.6} />
      {/* Top face (TQEC Z-axis) */}
      <polygon points={`${bk[0]},${bk[1]} ${rt[0]},${rt[1]} ${fr[0]},${fr[1]} ${lt[0]},${lt[1]}`}
        fill={hadamard ? undefined : top} stroke="#000" strokeWidth={0.7} />
      {hadamard ? (
        <>
          {/* Top face: back half (original) */}
          <polygon points={`${bk[0]},${bk[1]} ${rt[0]},${rt[1]} ${tf_rtfr_mid[0] + bx},${tf_rtfr_mid[1] - by} ${tf_bklt_mid[0] + bx},${tf_bklt_mid[1] - by}`}
            fill={top} stroke="#000" strokeWidth={0.5} />
          {/* Top face: yellow band */}
          <polygon points={`${tf_bklt_mid[0] + bx},${tf_bklt_mid[1] - by} ${tf_rtfr_mid[0] + bx},${tf_rtfr_mid[1] - by} ${tf_rtfr_mid[0] - bx},${tf_rtfr_mid[1] + by} ${tf_bklt_mid[0] - bx},${tf_bklt_mid[1] + by}`}
            fill={H_HEX} stroke="#000" strokeWidth={0.5} />
          {/* Top face: front half (swapped) */}
          <polygon points={`${tf_bklt_mid[0] - bx},${tf_bklt_mid[1] + by} ${tf_rtfr_mid[0] - bx},${tf_rtfr_mid[1] + by} ${fr[0]},${fr[1]} ${lt[0]},${lt[1]}`}
            fill={topAbove} stroke="#000" strokeWidth={0.5} />
          {/* Right face: back half (original) */}
          <polygon points={`${rt[0]},${rt[1]} ${rf_midTR[0] + bx},${rf_midTR[1] - by} ${rf_midBR[0] + bx},${rf_midBR[1] - by} ${rt[0]},${rt[1] + sideH}`}
            fill={right} stroke="#000" strokeWidth={0.7} />
          {/* Right face: yellow band */}
          <polygon points={`${rf_midTR[0] + bx},${rf_midTR[1] - by} ${rf_midTR[0] - bx},${rf_midTR[1] + by} ${rf_midBR[0] - bx},${rf_midBR[1] + by} ${rf_midBR[0] + bx},${rf_midBR[1] - by}`}
            fill={H_HEX} stroke="#000" strokeWidth={0.5} />
          {/* Right face: front half (swapped) */}
          <polygon points={`${rf_midTR[0] - bx},${rf_midTR[1] + by} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + sideH} ${rf_midBR[0] - bx},${rf_midBR[1] + by}`}
            fill={rightAbove} stroke="#000" strokeWidth={0.7} />
        </>
      ) : (
        <>
          {/* Right face (TQEC Y-axis) */}
          <polygon points={`${rt[0]},${rt[1]} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + sideH} ${rt[0]},${rt[1] + sideH}`}
            fill={right} stroke="#000" strokeWidth={0.7} />
        </>
      )}
      {/* Left face — dashed outline (open) */}
      <polygon points={`${lt[0]},${lt[1]} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + sideH} ${lt[0]},${lt[1] + sideH}`}
        fill="none" stroke="#000" strokeWidth={0.7} strokeDasharray="2 1.5" />
    </svg>
  );
}

const GRID_SECTION = 5;
const _gp = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _gr = new THREE.Raycaster();
const _gc = new THREE.Vector2(0, 0);
const _gt = new THREE.Vector3();

/**
 * Grid that repositions to follow the camera, snapped to sectionSize
 * so grid lines never shift. The underlying plane is large (1000×1000)
 * and always centered near the camera's ground look-point.
 */
function FollowGrid() {
  const ref = useRef<THREE.Group>(null!);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    _gr.setFromCamera(_gc, camera);
    if (_gr.ray.intersectPlane(_gp, _gt)) {
      // Snap to sectionSize multiples so grid lines stay aligned
      ref.current.position.x = Math.round(_gt.x / GRID_SECTION) * GRID_SECTION;
      ref.current.position.z = Math.round(_gt.z / GRID_SECTION) * GRID_SECTION;
    }
  });
  return (
    <group ref={ref}>
      <Grid
        args={[1000, 1000]}
        infiniteGrid
        cellSize={1}
        sectionSize={GRID_SECTION}
        cellColor="#aaaaaa"
        sectionColor="#888888"
        fadeDistance={500}
        fadeStrength={3}
        cellThickness={0.5}
        sectionThickness={1}
      />
    </group>
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

const previewWrapStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const blockBtnStyle = (active: boolean) => ({
  ...btnStyle(active),
  display: "flex" as const,
  flexDirection: "column" as const,
  alignItems: "center" as const,
  justifyContent: "flex-start" as const,
  padding: "4px 8px",
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

      {/* Pipes group */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={groupLabelStyle}>Pipes</span>
        <div style={{ display: "flex", gap: "4px", flex: 1, alignItems: "stretch" }}>
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
              <div style={previewWrapStyle}><PipePreview pipeType={pt} /></div>
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
        camera={{ position: [10, 10, -10], fov: 35 }}
        gl={{ logarithmicDepthBuffer: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <color attach="background" args={["#CBDFC6"]} />
        <ambientLight intensity={1.4} />
        <directionalLight position={[10, 10, 10]} intensity={1.0} />
        <BlockInstances />
        <GridPlane />
        <GhostBlock />
        <AxisLabels />
        <FpsSampler onFps={setFps} />
        <FollowGrid />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <OrientationGizmo />
        </GizmoHelper>
        <OrbitControls ref={controlsRef} makeDefault />
      </Canvas>
    </>
  );
}
