import { useEffect, useRef, useState } from "react";
import { useBlockStore } from "../stores/blockStore";
import { useValidationStore } from "../stores/validationStore";
import { CUBE_TYPES, PIPE_VARIANTS, VARIANT_AXIS_MAP, isPipeType, pipeAxisFromPos, posKey, determineCubeOptions, PIPE_TYPE_TO_VARIANT } from "../types";
import type { BlockType, CubeType, PipeType, PipeVariant, Position3D } from "../types";
import { downloadDae } from "../utils/daeExport";
import { triggerDaeImport } from "../utils/daeImport";
import { fetchTemplateManifest, loadTemplateBlocks, type TemplateEntry } from "../utils/templates";
import { animateCamera } from "../utils/cameraAnim";
import * as THREE from "three";
import { usePreviewImages } from "./PreviewRenderer";

// ---------------------------------------------------------------------------
// Responsive sizing
// ---------------------------------------------------------------------------

// Horizontal margin (px) kept between the toolbar and the viewport edges
// when the toolbar is scaled down to fit a narrow window.
const TOOLBAR_VIEWPORT_MARGIN_PX = 20;

// Returns a CSS scale factor that keeps the toolbar at its natural size when
// it fits in the viewport, and shrinks it just enough to fit when it doesn't.
function useToolbarScale(toolbarRef: React.RefObject<HTMLDivElement | null>): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    let frame = 0;
    const recompute = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const node = toolbarRef.current;
        if (!node) return;
        // offsetWidth is the layout (untransformed) width — independent of
        // the scale we apply, so this measurement is stable across renders.
        const natural = node.offsetWidth;
        if (natural === 0) return;
        const available = window.innerWidth - TOOLBAR_VIEWPORT_MARGIN_PX;
        setScale(Math.min(1, available / natural));
      });
    };
    const node = toolbarRef.current;
    const ro = node ? new ResizeObserver(recompute) : null;
    if (node && ro) ro.observe(node);
    window.addEventListener("resize", recompute);
    recompute();
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", recompute);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [toolbarRef]);
  return scale;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Toolbar({ onResetCamera, controlsRef, toolbarRef }: { onResetCamera: () => void; controlsRef: React.RefObject<any>; toolbarRef: React.RefObject<HTMLDivElement | null> }) {
  const scale = useToolbarScale(toolbarRef);
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
  const freeBuild = useBlockStore((s) => s.freeBuild);
  const toggleFreeBuild = useBlockStore((s) => s.toggleFreeBuild);
  const selectedCount = useBlockStore((s) => {
    if (s.selectedKeys.size === 0) return 0;
    let count = 0;
    for (const key of s.selectedKeys) if (s.blocks.has(key)) count++;
    return count;
  });
  const deleteSelected = useBlockStore((s) => s.deleteSelected);

  const buildCursor = useBlockStore((s) => s.buildCursor);
  const moveBuildCursor = useBlockStore((s) => s.moveBuildCursor);
  const buildCursorBlockType = useBlockStore((s) => {
    if (s.mode !== "build" || !s.buildCursor) return null;
    // Undetermined cubes should not highlight any button
    if (s.undeterminedCubes.has(posKey(s.buildCursor))) return null;
    const block = s.blocks.get(posKey(s.buildCursor));
    return block && !isPipeType(block.type) ? block.type : null;
  });
  // Returns a stable string of valid cube types (comma-separated) to avoid
  // infinite re-renders from creating new Set objects in the selector.
  const buildValidTypesStr = useBlockStore((s): string | null => {
    if (s.mode !== "build" || !s.buildCursor) return null;
    const cursor = s.buildCursor;
    const coords: [number, number, number] = [cursor.x, cursor.y, cursor.z];
    let pipeCount = 0;
    let yValid = true;
    for (let axis = 0; axis < 3; axis++) {
      for (const offset of [1, -2]) {
        const nc: [number, number, number] = [coords[0], coords[1], coords[2]];
        nc[axis] += offset;
        const n = s.blocks.get(posKey({ x: nc[0], y: nc[1], z: nc[2] }));
        if (n && isPipeType(n.type)) {
          const openAxis = n.type.replace("H", "").indexOf("O");
          if (openAxis === axis) {
            pipeCount++;
            if (openAxis !== 2) yValid = false;
          }
        }
      }
    }
    if (pipeCount > 1) return "";
    const opts: string[] = pipeCount === 0
      ? [...CUBE_TYPES]
      : (() => {
          const result = determineCubeOptions(cursor, s.blocks);
          return result.determined ? [result.type] : [...result.options];
        })();
    if (yValid) opts.push("Y");
    return opts.join(",");
  });
  const buildValidTypes = buildValidTypesStr != null ? new Set(buildValidTypesStr.split(",").filter(Boolean)) : null;
  // Find the adjacent pipe connecting cursor to an undetermined cube (for R cycling)
  const findUndeterminedPipeKey = (s: { buildCursor: Position3D | null; blocks: Map<string, { pos: Position3D; type: BlockType }>; undeterminedCubes: Map<string, unknown> }): string | null => {
    if (!s.buildCursor) return null;
    const cc: [number, number, number] = [s.buildCursor.x, s.buildCursor.y, s.buildCursor.z];
    const cursorUndetermined = s.undeterminedCubes.has(posKey(s.buildCursor));
    let found: string | null = null;
    for (let axis = 0; axis < 3; axis++) {
      for (const offset of [1, -2]) {
        const pc: [number, number, number] = [cc[0], cc[1], cc[2]];
        pc[axis] += offset;
        const pk = posKey({ x: pc[0], y: pc[1], z: pc[2] });
        const pipe = s.blocks.get(pk);
        if (!pipe || !isPipeType(pipe.type)) continue;
        if ((pipe.type as string).replace("H", "").indexOf("O") !== axis) continue;
        const fc: [number, number, number] = [cc[0], cc[1], cc[2]];
        fc[axis] += offset === 1 ? 3 : -3;
        const farKey = posKey({ x: fc[0], y: fc[1], z: fc[2] });
        if (cursorUndetermined || s.undeterminedCubes.has(farKey)) {
          if (found !== null) return null; // 2+ undetermined pipes — can't determine which to cycle
          found = pk;
        }
      }
    }
    return found;
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
        const opts = determineCubeOptions(neighbor.pos, tmp);
        if (!opts.determined && opts.options.length === 0) { ok = false; break; }
      }
      if (ok) valid.push(v);
    }
    return valid.join(",");
  });
  const buildValidPipeVariants = buildValidPipeVariantsStr != null ? new Set(buildValidPipeVariantsStr.split(",")) : null;
  const hoveredGridPos = useBlockStore((s) => s.hoveredGridPos);

  const previewImages = usePreviewImages(controlsRef);

  const validationStatus = useValidationStore((s) => s.status);
  const runValidation = useValidationStore((s) => s.validate);

  const setCameraPreset = (position: [number, number, number]) => {
    const controls = controlsRef.current;
    if (!controls) return;
    animateCamera(controls, new THREE.Vector3(0, 0, 0), new THREE.Vector3(...position));
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
          onClick={() => {
            if (!window.confirm("Are you sure you want to delete the whole diagram?")) return;
            clearAll();
            onResetCamera();
          }}
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
          title="Server-side validation via the TQEC library"
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
          {validationStatus === "loading" ? "Verifying..." : "Verify (tqec)"}
        </button>
        <button
          onClick={toggleFreeBuild}
          title="Disable color-matching checks when placing blocks"
          style={{
            ...btnStyle(false),
            fontSize: "10px",
            padding: "2px 6px",
            borderColor: freeBuild ? "#e67e22" : "#ccc",
            background: freeBuild ? "#fdebd0" : "#fff",
            color: freeBuild ? "#a04000" : "#333",
          }}
        >
          Free Build {freeBuild ? "ON" : "OFF"}
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
        <TemplatePicker onLoad={loadBlocks} />
      </div>

      {/* Separator */}
      <div style={{ width: 1, background: "#ddd" }} />

      {/* Blocks group (ZXCubes + Y) */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", pointerEvents: mode === "build" ? "none" : "auto" }}>
        <span style={groupLabelStyle}>Blocks</span>
        <div style={{ display: "flex", gap: "4px", flex: 1, alignItems: "stretch" }}>
          {CUBE_TYPES.map((ct) => (
            <button
              key={ct}
              onClick={() => {
                setCubeType(ct as BlockType);
                setMode("place");
              }}
              style={blockBtnStyle(
                (cubeType === ct && mode === "place") ||
                (mode === "build" && buildCursorBlockType === ct),
                mode === "build" && !freeBuild && buildValidTypes != null && !buildValidTypes.has(ct),
              )}
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
            style={blockBtnStyle(
              (cubeType === "Y" && mode === "place") ||
              (mode === "build" && buildCursorBlockType === "Y"),
              mode === "build" && !freeBuild && buildValidTypes != null && !buildValidTypes.has("Y" as CubeType),
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
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", pointerEvents: mode === "build" ? "none" : "auto" }}>
        <span style={groupLabelStyle}>Pipes</span>
        <div style={{ display: "flex", gap: "4px", flex: 1, alignItems: "stretch" }}>
          {PIPE_VARIANTS.map((v) => (
            <button
              key={v}
              onClick={() => {
                setPipeVariant(v);
                setMode("place");
              }}
              style={blockBtnStyle(
                (pipeVariant === v && mode === "place") ||
                (mode === "build" && buildActivePipeVariant === v),
                mode === "build" && !freeBuild && (buildValidPipeVariants == null || !buildValidPipeVariants.has(v)),
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
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", fontFamily: "monospace", fontSize: "12px", color: "#555", lineHeight: "1.6", minWidth: 90 }}>
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
    const parse = (s: string): number | null => {
      if (s.trim() === "") return null;
      const n = Number(s);
      return Number.isInteger(n) ? n : null;
    };
    const nx = draft.x !== undefined ? parse(draft.x) : pos.x / 3;
    const ny = draft.y !== undefined ? parse(draft.y) : pos.y / 3;
    const nz = draft.z !== undefined ? parse(draft.z) : pos.z / 3;
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
        type="number"
        step={1}
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
// Template picker — lists bundled .dae files generated from tqec.gallery
// ---------------------------------------------------------------------------

function TemplatePicker({ onLoad }: { onLoad: (blocks: Map<string, import("../types").Block>) => void }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && templates === null) {
      try {
        setTemplates(await fetchTemplateManifest());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const pick = async (entry: TemplateEntry) => {
    setLoadingFile(entry.filename);
    try {
      const blocks = await loadTemplateBlocks(entry.filename);
      onLoad(blocks);
      setOpen(false);
    } catch (err) {
      alert(`Failed to load template: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingFile(null);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button onClick={toggle} style={btnStyle(open)} title="Load a bundled template diagram from tqec.gallery">
        Templates ▾
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 4,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            padding: 4,
            minWidth: 220,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {error && <div style={{ padding: 6, color: "#c0392b", fontSize: 12 }}>{error}</div>}
          {!error && templates === null && <div style={{ padding: 6, fontSize: 12, color: "#666" }}>Loading…</div>}
          {templates?.map((t) => (
            <button
              key={t.filename}
              onClick={() => pick(t)}
              disabled={loadingFile !== null}
              title={`${t.description} (${t.filename})`}
              style={{
                ...btnStyle(false),
                textAlign: "left",
                padding: "6px 10px",
                opacity: loadingFile && loadingFile !== t.filename ? 0.5 : 1,
              }}
            >
              {loadingFile === t.filename ? `${t.name}…` : t.name}
            </button>
          ))}
          {templates && (
            <div style={{ padding: "4px 6px 2px", fontSize: 10, color: "#888" }}>
              From <a href="https://github.com/tqec/tqec" target="_blank" rel="noreferrer">tqec</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
