import { useEffect, useRef, useState } from "react";
import { useBlockStore, type BuildStep } from "../stores/blockStore";
import { useValidationStore } from "../stores/validationStore";
import { useKeybindStore, type Mode as KeybindMode, type NavStyle } from "../stores/keybindStore";
import { CUBE_TYPES, PIPE_VARIANTS, VARIANT_AXIS_MAP, isPipeType, pipeAxisFromPos, posKey, determineCubeOptions, determineCubeOptionsWithPipeRetype, hasYCubePipeAxisConflict, PIPE_TYPE_TO_VARIANT, traversedPipeKey } from "../types";
import type { BlockType, CubeType, IsoAxis, PipeType, PipeVariant, Position3D } from "../types";
import { downloadDae } from "../utils/daeExport";
import { triggerDaeImport } from "../utils/daeImport";
import {
  buildShareUrl,
  encodeSnapshotToHashParam,
  isCompressionStreamSupported,
} from "../utils/sceneShare";
import { captureSnapshot } from "../utils/sceneSnapshot";
import { fetchTemplateManifest, loadTemplateBlocks, type TemplateEntry } from "../utils/templates";
import { evalCoordExpr } from "../utils/parseCoordExpr";
import { usePreviewImages } from "./PreviewRenderer";
import { FpsDisplay } from "./FpsCounter";
import { useViewportFitScale } from "../hooks/useViewportFitScale";
import type { ViewMode } from "../types";

// Horizontal margin (px) kept between fixed overlays (toolbar, hint bar) and
// the viewport edges when they scale down to fit a narrow window.
const VIEWPORT_FIT_MARGIN_PX = 20;

// User-controlled toolbar scale is persisted across reloads and clamped to
// this range so the toolbar stays legible and can't be dragged off-screen.
const TOOLBAR_USER_SCALE_KEY = "piperdraw.toolbarUserScale";
const TOOLBAR_USER_SCALE_MIN = 0.4;
const TOOLBAR_USER_SCALE_MAX = 2.0;

function loadToolbarUserScale(): number {
  if (typeof window === "undefined") return 1;
  const raw = window.localStorage.getItem(TOOLBAR_USER_SCALE_KEY);
  if (raw == null) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(TOOLBAR_USER_SCALE_MAX, Math.max(TOOLBAR_USER_SCALE_MIN, n));
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

const blockBtnStyle = (active: boolean, disabled?: boolean) => ({
  ...btnStyle(active),
  display: "flex" as const,
  flexDirection: "column" as const,
  alignItems: "center" as const,
  justifyContent: "flex-start" as const,
  padding: "4px 8px",
  ...(disabled ? { opacity: 0.3, pointerEvents: "none" as const } : {}),
});

// ---------------------------------------------------------------------------
// Toolbar component
// ---------------------------------------------------------------------------

export function Toolbar({
  onResetCamera,
  controlsRef,
  toolbarRef,
  fpsRef,
  onOpenKeybindEditor,
}: {
  onResetCamera: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlsRef: React.RefObject<any>;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  fpsRef: React.RefObject<HTMLSpanElement | null>;
  onOpenKeybindEditor: (mode: KeybindMode) => void;
}) {
  const [userScale, setUserScale] = useState<number>(loadToolbarUserScale);
  const [recenterTooltip, setRecenterTooltip] = useState(false);
  useEffect(() => {
    window.localStorage.setItem(TOOLBAR_USER_SCALE_KEY, String(userScale));
  }, [userScale]);
  const scale = useViewportFitScale(toolbarRef, VIEWPORT_FIT_MARGIN_PX, userScale);
  const mode = useBlockStore((s) => s.mode);
  const setMode = useBlockStore((s) => s.setMode);
  const armedTool = useBlockStore((s) => s.armedTool);
  const setArmedTool = useBlockStore((s) => s.setArmedTool);
  const cubeType = useBlockStore((s) => s.cubeType);
  const pipeVariant = useBlockStore((s) => s.pipeVariant);
  const setCubeType = useBlockStore((s) => s.setCubeType);
  const setPipeVariant = useBlockStore((s) => s.setPipeVariant);
  const setPlacePort = useBlockStore((s) => s.setPlacePort);
  const setPaletteDragging = useBlockStore((s) => s.setPaletteDragging);
  const cycleBlock = useBlockStore((s) => s.cycleBlock);
  const cyclePipe = useBlockStore((s) => s.cyclePipe);
  const cycleSelectedType = useBlockStore((s) => s.cycleSelectedType);
  const historyLen = useBlockStore((s) => s.history.length);
  const futureLen = useBlockStore((s) => s.future.length);
  const undo = useBlockStore((s) => s.undo);
  const redo = useBlockStore((s) => s.redo);
  const clearAll = useBlockStore((s) => s.clearAll);
  const loadBlocks = useBlockStore((s) => s.loadBlocks);
  const insertBlocks = useBlockStore((s) => s.insertBlocks);
  const blocksEmpty = useBlockStore((s) => s.blocks.size === 0);
  const freeBuild = useBlockStore((s) => s.freeBuild);
  const toggleFreeBuild = useBlockStore((s) => s.toggleFreeBuild);
  const selectedCount = useBlockStore((s) => {
    if (s.selectedKeys.size === 0) return 0;
    let count = 0;
    for (const key of s.selectedKeys) if (s.blocks.has(key)) count++;
    return count;
  });
  const deleteSelected = useBlockStore((s) => s.deleteSelected);
  const flipSelected = useBlockStore((s) => s.flipSelected);

  const buildCursor = useBlockStore((s) => s.buildCursor);
  const moveBuildCursor = useBlockStore((s) => s.moveBuildCursor);
  const buildCursorBlockType = useBlockStore((s) => {
    if (s.mode !== "build" || !s.buildCursor) return null;
    const block = s.blocks.get(posKey(s.buildCursor));
    if (!block || isPipeType(block.type)) return null;
    // Always report the cube's actual displayed type, even when multiple options
    // remain — the toolbar highlights which type is currently selected so the user
    // can see what R-cycling will change away from.
    return block.type;
  });
  // True when the build cursor is sitting on a port (no cube at that position).
  // Lets the toolbar highlight the Port button as "currently selected" while in Keyboard Build mode.
  const buildCursorOnPort = useBlockStore((s) => {
    if (s.mode !== "build" || !s.buildCursor) return false;
    return !s.blocks.has(posKey(s.buildCursor));
  });
  // True when the cursor position has ≥2 attached pipes — i.e. it can't be
  // converted back to a port without first removing a pipe. Used to dim the
  // Port button in Keyboard Build mode so users don't click it expecting a no-op.
  const buildCursorPortAllowed = useBlockStore((s) => {
    if (s.mode !== "build" || !s.buildCursor) return true;
    const coords: [number, number, number] = [s.buildCursor.x, s.buildCursor.y, s.buildCursor.z];
    let pipeCount = 0;
    for (let axis = 0; axis < 3; axis++) {
      for (const offset of [1, -2]) {
        const nc: [number, number, number] = [coords[0], coords[1], coords[2]];
        nc[axis] += offset;
        const n = s.blocks.get(posKey({ x: nc[0], y: nc[1], z: nc[2] }));
        if (n && isPipeType(n.type)) {
          const openAxis = n.type.replace("H", "").indexOf("O");
          if (openAxis === axis) pipeCount++;
        }
      }
    }
    return pipeCount < 2;
  });
  // Returns a stable string of valid cube types (comma-separated) to avoid
  // infinite re-renders from creating new Set objects in the selector.
  const buildValidTypesStr = useBlockStore((s): string | null => {
    if (s.mode !== "build" || !s.buildCursor) return null;
    const cursor = s.buildCursor;
    const coords: [number, number, number] = [cursor.x, cursor.y, cursor.z];
    let pipeCount = 0;
    for (let axis = 0; axis < 3; axis++) {
      for (const offset of [1, -2]) {
        const nc: [number, number, number] = [coords[0], coords[1], coords[2]];
        nc[axis] += offset;
        const n = s.blocks.get(posKey({ x: nc[0], y: nc[1], z: nc[2] }));
        if (n && isPipeType(n.type)) {
          const openAxis = n.type.replace("H", "").indexOf("O");
          if (openAxis === axis) pipeCount++;
        }
      }
    }
    if (pipeCount > 1) return "";
    const opts: string[] = pipeCount === 0
      ? [...CUBE_TYPES]
      : determineCubeOptionsWithPipeRetype(cursor, s.blocks);
    // Y is a leaf: only valid with at most one attached (Z-open) pipe.
    if (pipeCount <= 1 && !hasYCubePipeAxisConflict("Y", cursor, s.blocks)) opts.push("Y");
    return opts.join(",");
  });
  const buildValidTypes = buildValidTypesStr != null ? new Set(buildValidTypesStr.split(",").filter(Boolean)) : null;

  // When exactly one cube-slot thing is selected in Drag / Drop mode (a single port OR a
  // single cube/Y block), compute info used to grey out and highlight toolbar
  // entries: the currently placed type, whether port-conversion is still legal,
  // and which cube types remain valid replacements at that position.
  // Encoded as "currentType;portAllowedFlag;valid1,valid2,..." to keep the
  // selector returning a primitive (avoids new-object-per-render re-renders).
  // currentType is "PORT" for a selected port, or the BlockType string ("XZZ", "Y", …).
  const selectedCubeSlotInfoStr = useBlockStore((s): string | null => {
    if (s.mode !== "edit" || s.armedTool !== "pointer") return null;
    let pos: Position3D;
    let currentType: string;
    if (s.selectedKeys.size === 0 && s.selectedPortPositions.size === 1) {
      const k = s.selectedPortPositions.values().next().value as string;
      const [x, y, z] = k.split(",").map(Number);
      pos = { x, y, z };
      currentType = "PORT";
    } else if (s.selectedKeys.size === 1 && s.selectedPortPositions.size === 0) {
      const k = s.selectedKeys.values().next().value as string;
      const b = s.blocks.get(k);
      if (!b || isPipeType(b.type)) return null;
      pos = b.pos;
      currentType = b.type;
    } else {
      return null;
    }
    if (s.freeBuild) {
      return `${currentType};1;${[...CUBE_TYPES, "Y"].join(",")}`;
    }
    const coords: [number, number, number] = [pos.x, pos.y, pos.z];
    let pipeCount = 0;
    for (let axis = 0; axis < 3; axis++) {
      for (const offset of [1, -2]) {
        const nc: [number, number, number] = [coords[0], coords[1], coords[2]];
        nc[axis] += offset;
        const n = s.blocks.get(posKey({ x: nc[0], y: nc[1], z: nc[2] }));
        if (n && isPipeType(n.type)) {
          const openAxis = n.type.replace("H", "").indexOf("O");
          if (openAxis === axis) pipeCount++;
        }
      }
    }
    const opts: string[] = determineCubeOptionsWithPipeRetype(pos, s.blocks);
    // Y is a leaf: only valid with at most one attached (Z-open) pipe.
    if (pipeCount <= 1 && !hasYCubePipeAxisConflict("Y", pos, s.blocks)) opts.push("Y");
    return `${currentType};${pipeCount < 2 ? "1" : "0"};${opts.join(",")}`;
  });
  const selectedCubeSlotInfo = (() => {
    if (selectedCubeSlotInfoStr == null) return null;
    const [currentType, portAllowedFlag, validStr] = selectedCubeSlotInfoStr.split(";");
    return {
      currentType,
      portAllowed: portAllowedFlag === "1",
      validTypes: new Set(validStr.split(",").filter(Boolean)),
    };
  })();

  // When exactly one pipe is selected in Drag / Drop mode, compute (a) its current
  // toolbar variant (for highlighting) and (b) which other variants would still
  // be valid at that position — i.e. swapping to that variant keeps every
  // committed neighbour cube within its valid CUBE_TYPES set. Mirrors the
  // build-mode pipe-validity logic in `buildValidPipeVariantsStr`.
  const selectedPipeInfoStr = useBlockStore((s): string | null => {
    if (s.mode !== "edit" || s.armedTool !== "pointer") return null;
    if (s.selectedKeys.size !== 1 || s.selectedPortPositions.size !== 0) return null;
    const k = s.selectedKeys.values().next().value as string;
    const pipeBlock = s.blocks.get(k);
    if (!pipeBlock || !isPipeType(pipeBlock.type)) return null;
    const currentVariant = PIPE_TYPE_TO_VARIANT[pipeBlock.type as PipeType];
    if (s.freeBuild) {
      return `${currentVariant};${PIPE_VARIANTS.join(",")}`;
    }
    const base = (pipeBlock.type as string).replace("H", "");
    const openAxis = base.indexOf("O") as 0 | 1 | 2;
    const pipeCoords: [number, number, number] = [pipeBlock.pos.x, pipeBlock.pos.y, pipeBlock.pos.z];
    const valid: string[] = [];
    for (const v of PIPE_VARIANTS) {
      const candidate = VARIANT_AXIS_MAP[v][openAxis];
      const tmp = new Map(s.blocks);
      tmp.set(k, { pos: pipeBlock.pos, type: candidate });
      let ok = true;
      for (const offset of [-1, 2]) {
        const nc: [number, number, number] = [pipeCoords[0], pipeCoords[1], pipeCoords[2]];
        nc[openAxis] += offset;
        const nKey = posKey({ x: nc[0], y: nc[1], z: nc[2] });
        const neighbor = tmp.get(nKey);
        if (!neighbor || isPipeType(neighbor.type) || neighbor.type === "Y") continue;
        const opts = determineCubeOptions(neighbor.pos, tmp);
        const currentType = neighbor.type;
        if (opts.determined) {
          if (opts.type !== currentType) { ok = false; break; }
        } else if (!opts.options.includes(currentType as CubeType)) {
          ok = false; break;
        }
      }
      if (ok) valid.push(v);
    }
    return `${currentVariant};${valid.join(",")}`;
  });
  const selectedPipeInfo = (() => {
    if (selectedPipeInfoStr == null) return null;
    const [currentVariant, validStr] = selectedPipeInfoStr.split(";");
    return {
      currentVariant: currentVariant as PipeVariant,
      validVariants: new Set(validStr.split(",").filter(Boolean)),
    };
  })();
  // Find the adjacent pipe connecting cursor to an ambiguous endpoint (for R cycling).
  // An endpoint is "ambiguous" when the pipe's color on that side isn't uniquely fixed:
  //   - the slot is a port (no cube) — any cube type could land there
  //   - the slot has a cube with multiple valid CUBE_TYPES given its adjacent pipes
  const isAmbiguousCubeEnd = (key: string, blocks: Map<string, { pos: Position3D; type: BlockType }>): boolean => {
    const b = blocks.get(key);
    if (!b) return true;
    if (isPipeType(b.type) || b.type === "Y") return false;
    const opts = determineCubeOptions(b.pos, blocks);
    return !opts.determined && opts.options.length > 1;
  };
  // In free build mode, any adjacent pipe is cycle-eligible (mirrors cyclePipe).
  // Outside free build, only pipes with an ambiguous end qualify — those are the
  // only ones where cycling isn't constrained to a single valid type. If 2+ are
  // eligible, prefer the pipe traversed by the last build step (same tiebreaker
  // cyclePipe uses); otherwise return null to grey out the toolbar.
  const findUndeterminedPipeKey = (s: {
    buildCursor: Position3D | null;
    blocks: Map<string, { pos: Position3D; type: BlockType }>;
    freeBuild: boolean;
    buildHistory: BuildStep[];
  }): string | null => {
    if (!s.buildCursor) return null;
    const cc: [number, number, number] = [s.buildCursor.x, s.buildCursor.y, s.buildCursor.z];
    const cursorAmbiguous = isAmbiguousCubeEnd(posKey(s.buildCursor), s.blocks);
    const eligible: string[] = [];
    for (let axis = 0; axis < 3; axis++) {
      for (const offset of [1, -2]) {
        const pc: [number, number, number] = [cc[0], cc[1], cc[2]];
        pc[axis] += offset;
        const pk = posKey({ x: pc[0], y: pc[1], z: pc[2] });
        const pipe = s.blocks.get(pk);
        if (!pipe || !isPipeType(pipe.type)) continue;
        if ((pipe.type as string).replace("H", "").indexOf("O") !== axis) continue;
        let ok = s.freeBuild;
        if (!ok) {
          const fc: [number, number, number] = [cc[0], cc[1], cc[2]];
          fc[axis] += offset === 1 ? 3 : -3;
          const farKey = posKey({ x: fc[0], y: fc[1], z: fc[2] });
          ok = cursorAmbiguous || isAmbiguousCubeEnd(farKey, s.blocks);
        }
        if (ok) eligible.push(pk);
      }
    }
    if (eligible.length === 0) return null;
    if (eligible.length === 1) return eligible[0];
    if (s.freeBuild) return eligible[0];
    const last = s.buildHistory[s.buildHistory.length - 1];
    if (last) {
      const preferred = last.pipe?.key
        ?? traversedPipeKey(last.prevCursorPos, last.destCursorPos);
      if (eligible.includes(preferred)) return preferred;
    }
    return null;
  };
  const buildActivePipeVariant = useBlockStore((s): PipeVariant | null => {
    if (s.mode !== "build") return null;
    const pk = findUndeterminedPipeKey(s);
    if (!pk) return null;
    const pipeBlock = s.blocks.get(pk);
    if (!pipeBlock || !isPipeType(pipeBlock.type)) return null;
    return PIPE_TYPE_TO_VARIANT[pipeBlock.type as PipeType];
  });
  const buildValidPipeVariantsStr = useBlockStore((s): string | null => {
    if (s.mode !== "build") return null;
    const pk = findUndeterminedPipeKey(s);
    if (!pk) return null;
    // Free build lets the user cycle to any variant unconditionally.
    if (s.freeBuild) return PIPE_VARIANTS.join(",");
    const pipeBlock = s.blocks.get(pk);
    if (!pipeBlock || !isPipeType(pipeBlock.type)) return null;
    const base = (pipeBlock.type as string).replace("H", "");
    const openAxis = base.indexOf("O") as 0 | 1 | 2;
    const pipeCoords: [number, number, number] = [pipeBlock.pos.x, pipeBlock.pos.y, pipeBlock.pos.z];
    const valid: string[] = [];
    for (const v of PIPE_VARIANTS) {
      const candidate = VARIANT_AXIS_MAP[v][openAxis];
      const tmp = new Map(s.blocks);
      tmp.set(pk, { pos: pipeBlock.pos, type: candidate });
      let ok = true;
      for (const offset of [-1, 2]) {
        const nc: [number, number, number] = [pipeCoords[0], pipeCoords[1], pipeCoords[2]];
        nc[openAxis] += offset;
        const nKey = posKey({ x: nc[0], y: nc[1], z: nc[2] });
        const neighbor = tmp.get(nKey);
        if (!neighbor || isPipeType(neighbor.type) || neighbor.type === "Y") continue;
        // Mirror cyclePipe: a committed neighbour cube must remain valid
        // (its current type still in the option set) under the candidate pipe.
        const opts = determineCubeOptions(neighbor.pos, tmp);
        const currentType = neighbor.type;
        if (opts.determined) {
          if (opts.type !== currentType) { ok = false; break; }
        } else if (!opts.options.includes(currentType as CubeType)) {
          ok = false; break;
        }
      }
      if (ok) valid.push(v);
    }
    return valid.join(",");
  });
  const buildValidPipeVariants = buildValidPipeVariantsStr != null ? new Set(buildValidPipeVariantsStr.split(",")) : null;
  const hoveredGridPos = useBlockStore((s) => s.hoveredGridPos);

  const previewImages = usePreviewImages(controlsRef);

  const viewMode = useBlockStore((s) => s.viewMode);
  const setPerspView = useBlockStore((s) => s.setPerspView);
  const setIsoView = useBlockStore((s) => s.setIsoView);
  const stepSlice = useBlockStore((s) => s.stepSlice);

  const previewImg = (key: string) => {
    const src = previewImages.get(key);
    return src ? (
      <img
        src={src}
        alt={key}
        draggable={false}
        style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
      />
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
        transform: `translateX(-50%) scale(${scale})`,
        transformOrigin: "top center",
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
      {/* Mode segmented control */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", justifyContent: "center" }}>
        <ModeSegmented mode={mode} setMode={setMode} />
      </div>

      {/* View buttons: 3D (perspective + free orbit) and Iso (axis-locked elevation) */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", justifyContent: "center" }}>
        <button
          onClick={setPerspView}
          style={{ ...btnStyle(viewMode.kind === "persp"), whiteSpace: "nowrap" }}
          title="Free 3D perspective view with orbit"
        >
          3D
        </button>
        <IsoMenu
          viewMode={viewMode}
          onPick={setIsoView}
        />
        {viewMode.kind === "iso" && (
          <div style={{ display: "flex", gap: "2px", alignItems: "center" }}>
            <button
              onClick={() => stepSlice(-3)}
              title="Move slice toward negative depth"
              style={{ ...btnStyle(false), padding: "2px 6px", fontSize: "11px", flex: 1 }}
            >
              ◂
            </button>
            <span
              title="Active slice on the depth axis (TQEC units / 3)"
              style={{
                fontFamily: "monospace",
                fontSize: "11px",
                color: "#555",
                minWidth: 28,
                textAlign: "center",
              }}
            >
              {viewMode.slice / 3}
            </span>
            <button
              onClick={() => stepSlice(3)}
              title="Move slice toward positive depth"
              style={{ ...btnStyle(false), padding: "2px 6px", fontSize: "11px", flex: 1 }}
            >
              ▸
            </button>
          </div>
        )}
      </div>

      {/* History + Analyze */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", justifyContent: "center" }}>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={undo}
            disabled={historyLen === 0}
            title="Undo"
            style={{
              ...btnStyle(false),
              padding: "4px 6px",
              flex: 1,
              opacity: historyLen === 0 ? 0.4 : 1,
              cursor: historyLen === 0 ? "default" : "pointer",
            }}
          >
            ↩
          </button>
          <button
            onClick={redo}
            disabled={futureLen === 0}
            title="Redo"
            style={{
              ...btnStyle(false),
              padding: "4px 6px",
              flex: 1,
              opacity: futureLen === 0 ? 0.4 : 1,
              cursor: futureLen === 0 ? "default" : "pointer",
            }}
          >
            ↪
          </button>
        </div>
        <AnalyzeMenu />
      </div>

      {/* Settings + File menu */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", justifyContent: "center" }}>
        <SettingsMenu
          freeBuild={freeBuild}
          toggleFreeBuild={toggleFreeBuild}
          onOpenKeybindEditor={onOpenKeybindEditor}
        />
        <FileMenu
          loadBlocks={loadBlocks}
          insertBlocks={insertBlocks}
          clearAll={clearAll}
          onResetCamera={onResetCamera}
          blocksEmpty={blocksEmpty}
        />
      </div>

      {/* Separator */}
      <div style={{ width: 1, background: "#ddd" }} />

      {/* Tool group (Pointer) */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={groupLabelStyle}>Tool</span>
        <div style={{ display: "flex", gap: "4px", flex: 1, alignItems: "stretch" }}>
          <button
            key="pointer"
            onClick={() => {
              if (mode === "build") setMode("edit");
              setArmedTool("pointer");
            }}
            title="Select and move blocks — Ctrl+Shift+drag for marquee select"
            style={blockBtnStyle(mode === "edit" && armedTool === "pointer")}
          >
            Select
            <div style={previewWrapStyle}>
              <PointerIcon />
            </div>
          </button>
        </div>
      </div>

      {/* Separator */}
      <div style={{ width: 1, background: "#ddd" }} />

      {/* Blocks group (Port + ZXCubes + Y) */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={groupLabelStyle}>Blocks</span>
        <div style={{ display: "flex", gap: "4px", flex: 1, alignItems: "stretch" }}>
          <button
            key="port"
            onPointerDown={() => {
              if (mode !== "edit") return;
              // With a single block/port selected, defer to onClick (which
              // replaces the selection in place); calling setPlacePort here
              // would clear the selection before the click is handled.
              if (selectedCubeSlotInfo != null) return;
              setPlacePort(true);
              setPaletteDragging(true);
            }}
            onClick={() => {
              if (mode === "build") {
                // In Keyboard Build mode, clicking Port converts the cursor cube back to a port
                // (only valid when pipeCount < 2; cycleBlock validates and no-ops otherwise).
                cycleBlock(null);
                return;
              }
              // Single block/port selected → replace it in place rather than
              // dropping the selection and arming the placement tool.
              if (selectedCubeSlotInfo != null && selectedCubeSlotInfo.portAllowed) {
                cycleSelectedType(1, { kind: "port" });
                return;
              }
              setPlacePort(true);
            }}
            title="Place or convert to a port"
            style={blockBtnStyle(
              (mode === "edit" && armedTool === "port") ||
              (mode === "build" && buildCursorOnPort) ||
              (mode === "edit" && selectedCubeSlotInfo?.currentType === "PORT"),
              (mode === "build" && !freeBuild && !buildCursorPortAllowed) ||
              (mode === "edit" && selectedCubeSlotInfo != null && !selectedCubeSlotInfo.portAllowed),
            )}
          >
            Port
            <div style={previewWrapStyle}>{previewImg("Port")}</div>
          </button>
          {CUBE_TYPES.map((ct) => (
            <button
              key={ct}
              onPointerDown={() => {
                if (mode !== "edit") return;
                if (selectedCubeSlotInfo != null) return;
                setCubeType(ct as BlockType);
                setPaletteDragging(true);
              }}
              onClick={() => {
                if (mode === "build") {
                  cycleBlock(ct);
                  return;
                }
                if (selectedCubeSlotInfo != null && selectedCubeSlotInfo.validTypes.has(ct)) {
                  cycleSelectedType(1, { kind: "cube", type: ct });
                  return;
                }
                setCubeType(ct as BlockType);
              }}
              style={blockBtnStyle(
                (mode === "edit" && armedTool === "cube" && cubeType === ct) ||
                (mode === "build" && buildCursorBlockType === ct) ||
                (mode === "edit" && selectedCubeSlotInfo?.currentType === ct),
                // Never disable the cube type currently sitting at the build cursor or
                // selected — it's the placed type and showing it as highlighted +
                // greyed at the same time is a visual contradiction (mirrors the
                // pipe-button rule).
                (mode === "build" && !freeBuild && buildCursorBlockType !== ct
                  && buildValidTypes != null && !buildValidTypes.has(ct)) ||
                (mode === "edit" && selectedCubeSlotInfo != null
                  && selectedCubeSlotInfo.currentType !== ct
                  && !selectedCubeSlotInfo.validTypes.has(ct)),
              )}
            >
              {ct}
              <div style={previewWrapStyle}>{previewImg(ct)}</div>
            </button>
          ))}
          <button
            onPointerDown={() => {
              if (mode !== "edit") return;
              if (selectedCubeSlotInfo != null) return;
              setCubeType("Y");
              setPaletteDragging(true);
            }}
            onClick={() => {
              if (mode === "build") {
                cycleBlock("Y");
                return;
              }
              if (selectedCubeSlotInfo != null && selectedCubeSlotInfo.validTypes.has("Y")) {
                cycleSelectedType(1, { kind: "cube", type: "Y" });
                return;
              }
              setCubeType("Y");
            }}
            style={blockBtnStyle(
              (mode === "edit" && armedTool === "cube" && cubeType === "Y") ||
              (mode === "build" && buildCursorBlockType === "Y") ||
              (mode === "edit" && selectedCubeSlotInfo?.currentType === "Y"),
              (mode === "build" && !freeBuild && buildCursorBlockType !== "Y"
                && buildValidTypes != null && !buildValidTypes.has("Y" as CubeType)) ||
              (mode === "edit" && selectedCubeSlotInfo != null
                && selectedCubeSlotInfo.currentType !== "Y"
                && !selectedCubeSlotInfo.validTypes.has("Y")),
            )}
          >
            Y
            <div style={previewWrapStyle}>{previewImg("Y")}</div>
          </button>
        </div>
      </div>

      {/* Separator */}
      <div style={{ width: 1, background: "#ddd" }} />

      {/* Pipes group */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={groupLabelStyle}>Pipes</span>
        <div style={{ display: "flex", gap: "4px", flex: 1, alignItems: "stretch" }}>
          {PIPE_VARIANTS.map((v) => (
            <button
              key={v}
              onPointerDown={() => {
                if (mode !== "edit") return;
                if (selectedPipeInfo != null) return;
                setPipeVariant(v);
                setPaletteDragging(true);
              }}
              onClick={() => {
                if (mode === "build") {
                  cyclePipe(v);
                  return;
                }
                if (selectedPipeInfo != null && selectedPipeInfo.validVariants.has(v)) {
                  cycleSelectedType(1, { kind: "pipe", variant: v });
                  return;
                }
                setPipeVariant(v);
              }}
              style={blockBtnStyle(
                (mode === "edit" && armedTool === "pipe" && pipeVariant === v) ||
                (mode === "build" && buildActivePipeVariant === v) ||
                (mode === "edit" && selectedPipeInfo?.currentVariant === v),
                // Never disable the currently-active pipe variant — it's always
                // valid by construction (it's what's placed), and showing it as
                // highlighted + greyed at the same time is a visual contradiction.
                (mode === "build" && !freeBuild && buildActivePipeVariant !== v
                  && (buildValidPipeVariants == null || !buildValidPipeVariants.has(v))) ||
                (mode === "edit" && selectedPipeInfo != null
                  && selectedPipeInfo.currentVariant !== v
                  && !selectedPipeInfo.validVariants.has(v)),
              )}
            >
              {v}
              <div style={previewWrapStyle}>{previewImg(v)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Position display */}
      <div style={{ width: 1, background: "#ddd" }} />
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", fontFamily: "monospace", fontSize: "12px", color: "#555", lineHeight: "1.6", minWidth: 90 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={groupLabelStyle}>Position</span>
          {mode === "build" && buildCursor ? (
            <PositionEditor pos={buildCursor} onCommit={moveBuildCursor} />
          ) : (() => {
            const pos: Position3D | null = hoveredGridPos;
            const bt: BlockType | null = useBlockStore.getState().hoveredBlockType;
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
        <div style={{ position: "relative", alignSelf: "center" }}>
          <button
            onClick={onResetCamera}
            onMouseEnter={() => setRecenterTooltip(true)}
            onMouseLeave={() => setRecenterTooltip(false)}
            aria-label="Recenter camera on origin"
            style={{
              ...btnStyle(false),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              width: 28,
              height: 22,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="3.5" />
              <line x1="7" y1="0.5" x2="7" y2="3" />
              <line x1="7" y1="11" x2="7" y2="13.5" />
              <line x1="0.5" y1="7" x2="3" y2="7" />
              <line x1="11" y1="7" x2="13.5" y2="7" />
            </svg>
          </button>
          {recenterTooltip && (
            <div
              role="tooltip"
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                background: "rgba(0,0,0,0.85)",
                color: "#fff",
                padding: "4px 8px",
                borderRadius: 4,
                fontSize: 11,
                fontFamily: "sans-serif",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                zIndex: 100,
              }}
            >
              Recenter camera on origin (0, 0, 0)
            </div>
          )}
        </div>
        <div style={{ textAlign: "center" }}>
          <FpsDisplay spanRef={fpsRef} />
        </div>
      </div>

      {selectedCount > 0 && mode === "edit" && (
        <>
          <div style={{ width: 1, background: "#ddd" }} />
          <SelectionInspector
            count={selectedCount}
            onDelete={deleteSelected}
            onFlip={flipSelected}
          />
        </>
      )}
      <ResizeHandle toolbarRef={toolbarRef} userScale={userScale} setUserScale={setUserScale} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resize handle — drag to set the persisted toolbar scale.
// ---------------------------------------------------------------------------
// The toolbar is centered (translateX(-50%)) so horizontal drag changes the
// width symmetrically: a 1px drag at the right edge grows the visible width
// by 2px. We drive the new scale from the starting natural width so the
// grabbed corner tracks the cursor.
function ResizeHandle({
  toolbarRef,
  userScale,
  setUserScale,
}: {
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  userScale: number;
  setUserScale: (n: number) => void;
}) {
  const dragRef = useRef<{ startX: number; startScale: number; natural: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const node = toolbarRef.current;
    if (!node) return;
    const natural = node.offsetWidth;
    if (natural === 0) return;
    dragRef.current = { startX: e.clientX, startScale: userScale, natural };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const delta = (e.clientX - d.startX) * 2;
    const next = d.startScale + delta / d.natural;
    const clamped = Math.min(TOOLBAR_USER_SCALE_MAX, Math.max(TOOLBAR_USER_SCALE_MIN, next));
    setUserScale(clamped);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
  };

  const onDoubleClick = () => setUserScale(1);

  return (
    <div
      role="separator"
      aria-label="Resize toolbar"
      title="Drag to resize toolbar (double-click to reset)"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        width: 14,
        height: 14,
        cursor: "nwse-resize",
        touchAction: "none",
        // Diagonal grip lines.
        backgroundImage:
          "linear-gradient(135deg, transparent 0 6px, #999 6px 7px, transparent 7px 10px, #999 10px 11px, transparent 11px)",
        borderBottomRightRadius: 8,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Iso view menu — dropdown to pick which axis to view down
// ---------------------------------------------------------------------------

const ISO_AXIS_LABEL: Record<IsoAxis, string> = {
  x: "Iso X",
  y: "Iso Y",
  z: "Iso Z",
};

function IsoMenu({ viewMode, onPick }: { viewMode: ViewMode; onPick: (axis: IsoAxis) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const active = viewMode.kind === "iso";
  const label = active ? ISO_AXIS_LABEL[viewMode.axis] : "Iso";

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const pick = (axis: IsoAxis) => {
    onPick(axis);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ ...btnStyle(active), whiteSpace: "nowrap", width: "100%" }}
        title="Axis-locked orthographic elevation view"
      >
        {label} ▾
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 4,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            padding: 4,
            minWidth: 90,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {(["x", "y", "z"] as IsoAxis[]).map((axis) => (
            <button
              key={axis}
              onClick={() => pick(axis)}
              style={{
                ...btnStyle(active && viewMode.axis === axis),
                textAlign: "left",
                padding: "4px 10px",
              }}
            >
              {ISO_AXIS_LABEL[axis]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PositionEditor — editable X/Y/Z inputs for the build cursor
// ---------------------------------------------------------------------------

function PositionEditor({ pos, onCommit }: { pos: Position3D; onCommit: (p: Position3D) => void }) {
  const [draft, setDraft] = useState<{ x?: string; y?: string; z?: string }>({});

  const valueOf = (k: "x" | "y" | "z") => draft[k] ?? String(pos[k] / 3);

  const commit = () => {
    const nx = draft.x !== undefined ? evalCoordExpr(draft.x) : pos.x / 3;
    const ny = draft.y !== undefined ? evalCoordExpr(draft.y) : pos.y / 3;
    const nz = draft.z !== undefined ? evalCoordExpr(draft.z) : pos.z / 3;
    if (nx === null || ny === null || nz === null) {
      setDraft({});
      return;
    }
    if (nx * 3 !== pos.x || ny * 3 !== pos.y || nz * 3 !== pos.z) {
      onCommit({ x: nx * 3, y: ny * 3, z: nz * 3 });
    }
    setDraft({});
  };

  const onContainerBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    // Focus moving to another input inside the group → don't commit yet
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    commit();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commit();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      setDraft({});
      e.currentTarget.blur();
    }
  };

  const axisRow = (k: "x" | "y" | "z") => (
    <label key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {k.toUpperCase()}:
      <input
        type="text"
        inputMode="numeric"
        value={valueOf(k)}
        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
        onKeyDown={onKeyDown}
        style={{
          width: 42,
          fontFamily: "monospace",
          fontSize: 12,
          padding: "1px 2px",
          border: "1px solid #ccc",
          borderRadius: 2,
          background: "#fff",
          color: "#333",
        }}
      />
    </label>
  );

  return <div onBlur={onContainerBlur}>{axisRow("x")}{axisRow("y")}{axisRow("z")}</div>;
}

// ---------------------------------------------------------------------------
// Mode segmented control — Drag / Drop | Keyboard Build pill
// ---------------------------------------------------------------------------

function ModeSegmented({
  mode,
  setMode,
}: {
  mode: "edit" | "build";
  setMode: (m: "edit" | "build") => void;
}) {
  const segStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 12px",
    fontSize: "13px",
    fontFamily: "sans-serif",
    cursor: "pointer",
    border: "none",
    background: active ? "#4a9eff" : "transparent",
    color: active ? "#fff" : "#555",
    fontWeight: active ? 600 : "normal",
    borderRadius: 3,
    transition: "background 0.1s, color 0.1s",
  });
  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        border: "2px solid #4a9eff",
        borderRadius: 6,
        overflow: "hidden",
        padding: 2,
        background: "#fff",
      }}
    >
      <button onClick={() => setMode("edit")} style={segStyle(mode === "edit")}>
        Drag / Drop
      </button>
      <button onClick={() => setMode("build")} style={segStyle(mode === "build")}>
        Keyboard Build
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectionInspector — Flip / Delete actions for the current selection
// ---------------------------------------------------------------------------

function SelectionInspector({
  count,
  onDelete,
  onFlip,
}: {
  count: number;
  onDelete: () => void;
  onFlip: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", justifyContent: "center" }}>
      <span style={groupLabelStyle}>Selection ({count})</span>
      <button
        onClick={onFlip}
        title="Swap X↔Z colors on all selected blocks"
        style={{ ...btnStyle(false), borderColor: "#4a9eff", color: "#4a9eff" }}
      >
        Flip
      </button>
      <button
        onClick={onDelete}
        style={{ ...btnStyle(false), borderColor: "#dc3545", color: "#dc3545" }}
      >
        Delete
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileMenu — Import / Export / Photo / Templates / Clear dropdown
// ---------------------------------------------------------------------------

function FileMenu({
  loadBlocks,
  insertBlocks,
  clearAll,
  onResetCamera,
  blocksEmpty,
}: {
  loadBlocks: (blocks: Map<string, import("../types").Block>) => void;
  insertBlocks: (blocks: Map<string, import("../types").Block>) => void;
  clearAll: () => void;
  onResetCamera: () => void;
  blocksEmpty: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateEntry[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "too-long" | "error">("idle");
  const shareTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const compressionSupported = isCompressionStreamSupported();

  // ~6 KB total URL — Twitter/X and most chat clients are well above this,
  // but very long URLs choke older SMS, some embeds, and the URL bar in
  // older browsers. Past this we surface the .dae export instead.
  const SHARE_URL_MAX_LEN = 6144;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setTemplatesOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const toggleTemplates = async () => {
    const next = !templatesOpen;
    setTemplatesOpen(next);
    if (next && templates === null && templatesError === null) {
      try {
        setTemplates(await fetchTemplateManifest());
      } catch (err) {
        setTemplatesError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const pickTemplate = async (entry: TemplateEntry, action: "load" | "insert") => {
    setLoadingFile(entry.filename);
    try {
      const blocks = await loadTemplateBlocks(entry.filename);
      if (action === "insert") insertBlocks(blocks);
      else loadBlocks(blocks);
      setOpen(false);
      setTemplatesOpen(false);
    } catch (err) {
      alert(`Failed to ${action} template: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingFile(null);
    }
  };

  const item = (disabled: boolean): React.CSSProperties => ({
    ...btnStyle(false),
    textAlign: "left",
    padding: "4px 10px",
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? "default" : "pointer",
    whiteSpace: "nowrap",
  });

  const onShare = async () => {
    if (!compressionSupported || blocksEmpty) return;
    if (shareTimeoutRef.current !== null) {
      clearTimeout(shareTimeoutRef.current);
      shareTimeoutRef.current = null;
    }
    try {
      const snapshot = captureSnapshot();
      const encoded = await encodeSnapshotToHashParam(snapshot);
      const url = buildShareUrl(encoded);
      if (url.length > SHARE_URL_MAX_LEN) {
        setShareStatus("too-long");
      } else {
        await navigator.clipboard.writeText(url);
        setShareStatus("copied");
      }
    } catch {
      setShareStatus("error");
    }
    shareTimeoutRef.current = setTimeout(() => {
      setShareStatus("idle");
      setOpen(false);
      shareTimeoutRef.current = null;
    }, 1600);
  };

  useEffect(() => {
    return () => {
      if (shareTimeoutRef.current !== null) clearTimeout(shareTimeoutRef.current);
    };
  }, []);

  let shareLabel = "Share link";
  let shareTitle = "Copy a link that loads this exact scene";
  if (!compressionSupported) {
    shareTitle = "Share link is unsupported in this browser (needs CompressionStream)";
  } else if (shareStatus === "copied") {
    shareLabel = "Link copied!";
  } else if (shareStatus === "too-long") {
    shareLabel = "Too large — use Export";
    shareTitle = "Scene is too big for a URL; use Export to send a .dae file instead";
  } else if (shareStatus === "error") {
    shareLabel = "Could not copy";
  }
  const shareDisabled = blocksEmpty || !compressionSupported;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ ...btnStyle(open), whiteSpace: "nowrap", width: "100%" }}
        title="Import / Export / Templates / Clear"
      >
        File ▾
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 4,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            padding: 4,
            minWidth: 140,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <button
            onClick={() => {
              triggerDaeImport(loadBlocks);
              setOpen(false);
            }}
            title="Load a .dae file (replaces current scene)"
            style={item(false)}
          >
            Import…
          </button>
          <button
            onClick={() => {
              triggerDaeImport(insertBlocks);
              setOpen(false);
            }}
            title="Insert a .dae file next to current scene; inserted blocks stay selected so you can drag them into place"
            style={item(false)}
          >
            Insert…
          </button>
          <button
            onClick={() => {
              downloadDae(useBlockStore.getState().blocks);
              setOpen(false);
            }}
            disabled={blocksEmpty}
            style={item(blocksEmpty)}
          >
            Export
          </button>
          <button
            onClick={() => {
              void onShare();
            }}
            disabled={shareDisabled}
            title={shareTitle}
            style={item(shareDisabled)}
          >
            {shareLabel}
          </button>
          <button
            onClick={() => {
              useBlockStore.getState().requestPhoto();
              setOpen(false);
            }}
            disabled={blocksEmpty}
            title="Save current view as PNG"
            style={item(blocksEmpty)}
          >
            Screenshot
          </button>
          <button
            onClick={toggleTemplates}
            style={{
              ...item(false),
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: templatesOpen ? "#e8f0fe" : "#fff",
            }}
          >
            Templates <span style={{ opacity: 0.6, marginLeft: 6 }}>{templatesOpen ? "▾" : "▸"}</span>
          </button>
          {templatesOpen && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "100%",
                marginLeft: 4,
                background: "#fff",
                border: "1px solid #ccc",
                borderRadius: 4,
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                padding: 4,
                minWidth: 220,
                zIndex: 1001,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              {templatesError && <div style={{ padding: 6, color: "#c0392b", fontSize: 12 }}>{templatesError}</div>}
              {!templatesError && templates === null && <div style={{ padding: 6, fontSize: 12, color: "#666" }}>Loading…</div>}
              {templates?.map((t) => (
                <div key={t.filename} style={{ display: "flex", gap: 2 }}>
                  <button
                    onClick={() => pickTemplate(t, "load")}
                    disabled={loadingFile !== null}
                    title={`Load (replace scene): ${t.description} (${t.filename})`}
                    style={{
                      ...btnStyle(false),
                      textAlign: "left",
                      padding: "6px 10px",
                      flex: 1,
                      opacity: loadingFile && loadingFile !== t.filename ? 0.5 : 1,
                    }}
                  >
                    {loadingFile === t.filename ? `${t.name}…` : t.name}
                  </button>
                  <button
                    onClick={() => pickTemplate(t, "insert")}
                    disabled={loadingFile !== null}
                    title={`Insert next to current scene (selected for placement): ${t.name}`}
                    style={{
                      ...btnStyle(false),
                      padding: "6px 8px",
                      opacity: loadingFile && loadingFile !== t.filename ? 0.5 : 1,
                      fontWeight: "bold",
                    }}
                  >
                    +
                  </button>
                </div>
              ))}
              {templates && (
                <div style={{ padding: "4px 6px 2px", fontSize: 10, color: "#888" }}>
                  From <a href="https://github.com/tqec/tqec" target="_blank" rel="noreferrer">tqec</a>
                </div>
              )}
            </div>
          )}
          <div style={{ height: 1, background: "#eee", margin: "4px 0" }} />
          <button
            onClick={() => {
              if (!window.confirm("Are you sure you want to delete the whole diagram?")) return;
              clearAll();
              onResetCamera();
              setOpen(false);
            }}
            disabled={blocksEmpty}
            style={{ ...item(blocksEmpty), color: "#dc3545" }}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnalyzeMenu — Verify (tqec), Flows (tqec), ZX (tqec + pyzx) under one trigger
// ---------------------------------------------------------------------------

function AnalyzeMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const blocksEmpty = useBlockStore((s) => s.blocks.size === 0);
  const flowsPanelOpen = useBlockStore((s) => s.flowsPanelOpen);
  const zxPanelOpen = useBlockStore((s) => s.zxPanelOpen);
  const validationStatus = useValidationStore((s) => s.status);
  const runValidation = useValidationStore((s) => s.validate);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const verifyDisabled = blocksEmpty || validationStatus === "loading";
  const verifyBorder =
    validationStatus === "valid" ? "#28a745" :
    validationStatus === "invalid" ? "#dc3545" :
    null;
  const verifyBackground =
    validationStatus === "valid" ? "#d4edda" :
    validationStatus === "invalid" ? "#f8d7da" :
    validationStatus === "loading" ? "#e8f0fe" :
    null;

  const anyPanelOpen = flowsPanelOpen || zxPanelOpen;
  const openDots = (flowsPanelOpen ? "•" : "") + (zxPanelOpen ? "•" : "");
  const triggerActive = open || anyPanelOpen;
  const triggerStyle: React.CSSProperties = {
    ...btnStyle(triggerActive),
    whiteSpace: "nowrap",
    width: "100%",
    ...(verifyBorder ? { borderColor: verifyBorder } : {}),
    ...(verifyBackground ? { background: verifyBackground } : {}),
  };
  const triggerTitle = (() => {
    const parts: string[] = [];
    if (validationStatus === "valid") parts.push("Verify: valid");
    else if (validationStatus === "invalid") parts.push("Verify: invalid");
    else if (validationStatus === "loading") parts.push("Verify: running");
    if (flowsPanelOpen) parts.push("Flows panel open");
    if (zxPanelOpen) parts.push("ZX panel open");
    return parts.length > 0 ? parts.join(" • ") : "Analyze the diagram (tqec / pyzx)";
  })();

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={triggerTitle}
        style={triggerStyle}
      >
        Analyze {openDots && <span style={{ color: "#4a9eff" }}>{openDots}</span>}▾
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 4,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            padding: 8,
            minWidth: 180,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontFamily: "sans-serif",
          }}
        >
          <button
            onClick={() => { runValidation(); }}
            disabled={verifyDisabled}
            title="Server-side validation via the TQEC library"
            style={{
              ...btnStyle(false),
              opacity: blocksEmpty ? 0.4 : 1,
              cursor: verifyDisabled ? "default" : "pointer",
              borderColor: verifyBorder ?? "#ccc",
              background: verifyBackground ?? "#fff",
            }}
          >
            {validationStatus === "loading" ? "Verifying..." : "Verify (tqec)"}
          </button>
          <button
            onClick={() => useBlockStore.getState().toggleFlowsPanel()}
            title="Show stabilizer flows for the current diagram (computed by the tqec package)"
            style={{
              ...btnStyle(flowsPanelOpen),
              borderColor: flowsPanelOpen ? "#4a9eff" : "#ccc",
              background: flowsPanelOpen ? "#e8f0fe" : "#fff",
            }}
          >
            Flows (tqec)
          </button>
          <button
            onClick={() => useBlockStore.getState().toggleZXPanel()}
            title="Show the ZX-calculus diagram corresponding to this pipe diagram (tqec builds the graph, pyzx owns the .qgraph export and full_reduce simplification)"
            style={{
              ...btnStyle(zxPanelOpen),
              borderColor: zxPanelOpen ? "#4a9eff" : "#ccc",
              background: zxPanelOpen ? "#e8f0fe" : "#fff",
            }}
          >
            ZX (tqec + pyzx)
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SettingsMenu — Free Build, navigation style, keybind editor entry
// ---------------------------------------------------------------------------

const NAV_STYLE_LABELS: Record<NavStyle, string> = {
  pan: "Drag to pan",
  rotate: "Drag to rotate",
};

function SettingsMenu({
  freeBuild,
  toggleFreeBuild,
  onOpenKeybindEditor,
}: {
  freeBuild: boolean;
  toggleFreeBuild: () => void;
  onOpenKeybindEditor: (mode: KeybindMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const navStyle = useKeybindStore((s) => s.navStyle);
  const setNavStyle = useKeybindStore((s) => s.setNavStyle);
  const cameraFollowsBuild = useKeybindStore((s) => s.cameraFollowsBuild);
  const toggleCameraFollowsBuild = useKeybindStore((s) => s.toggleCameraFollowsBuild);
  const axisAbsoluteWasd = useKeybindStore((s) => s.axisAbsoluteWasd);
  const toggleAxisAbsoluteWasd = useKeybindStore((s) => s.toggleAxisAbsoluteWasd);
  const showYDefects = useBlockStore((s) => s.showYDefects);
  const toggleShowYDefects = useBlockStore((s) => s.toggleShowYDefects);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Settings"
        style={{ ...btnStyle(open || freeBuild), whiteSpace: "nowrap", width: "100%" }}
      >
        ⚙ Settings
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 4,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            padding: 8,
            width: 320,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontFamily: "sans-serif",
            fontSize: 12,
          }}
        >
          <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={freeBuild} onChange={toggleFreeBuild} style={{ marginTop: 2 }} />
            <span>
              Ignore color rules
              <div style={{ fontSize: 10, color: "#888", whiteSpace: "nowrap" }}>
                (“Free Build” — skips color-matching checks)
              </div>
            </span>
          </label>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={showYDefects} onChange={toggleShowYDefects} style={{ marginTop: 2 }} />
            <span>
              Highlight Y defects
              <div style={{ fontSize: 10, color: "#888", whiteSpace: "nowrap" }}>
                (magenta cylinders along edges where X and Z faces meet)
              </div>
            </span>
          </label>

          <div style={{ height: 1, background: "#eee" }} />

          <div>
            <div style={{ fontWeight: 600, color: "#555", marginBottom: 4 }}>Navigation style</div>
            {(["pan", "rotate"] as NavStyle[]).map((v) => (
              <label key={v} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "2px 0" }}>
                <input
                  type="radio"
                  name="navstyle"
                  checked={navStyle === v}
                  onChange={() => setNavStyle(v)}
                />
                {NAV_STYLE_LABELS[v]}
              </label>
            ))}
            <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
              Middle-click drag always orbits, regardless of this setting.
            </div>
          </div>

          <div style={{ height: 1, background: "#eee" }} />

          <div>
            <div style={{ fontWeight: 600, color: "#555", marginBottom: 4 }}>Keyboard Build</div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "2px 0" }}>
              <input type="checkbox" checked={cameraFollowsBuild} onChange={toggleCameraFollowsBuild} />
              <span title="When off, the camera stays put while you build with the keyboard">
                Camera follows build cursor
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "2px 0" }}>
              <input type="checkbox" checked={axisAbsoluteWasd} onChange={toggleAxisAbsoluteWasd} />
              <span title="When on, W/S = ±X and A/D = ±Y regardless of camera angle">
                Axis-locked WASD
              </span>
            </label>
          </div>

          <div style={{ height: 1, background: "#eee" }} />

          <div>
            <div style={{ fontWeight: 600, color: "#555", marginBottom: 4 }}>Keybindings</div>
            <button
              onClick={() => { onOpenKeybindEditor("edit"); setOpen(false); }}
              style={{ ...btnStyle(false), padding: "4px 8px", width: "100%" }}
            >
              Edit keybindings…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small inline icon for the Pointer tool button
// ---------------------------------------------------------------------------

function PointerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 2 L3 12 L6 9.5 L8 13.5 L10 12.5 L8 8.5 L12 8 Z"
        fill="#333"
        stroke="#333"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
