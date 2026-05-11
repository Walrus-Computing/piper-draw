/**
 * EquisetaJsonPanel — floating panel that displays loaded Equiseta JSON.
 *
 * Stays mounted (display: none) when closed so loaded JSON survives
 * close+reopen. Two view modes (JSON tree, faces grid) toggleable from the
 * header. Drop target is the entire panel body; size + extension validation
 * happens in equisetaJsonLoad.getDroppedJsonText. Concurrent loads are
 * serialised by a monotonic token managed in equisetaJsonStore.
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │ Equiseta JSON              [JSON|Grid]   [× close]│ <- drag handle
 *   ├──────────────────────────────────────────────────┤
 *   │ 2 nodes · 1 edge · 3 colors (red, blue, open)    │ <- stats header
 *   ├──────────────────────────────────────────────────┤
 *   │ <pretty-printed tree | per-node face grid cards> │ <- body
 *   │                                                  │
 *   │ (drop target: entire body)                       │
 *   └──────────────────────────────────────────────────┘
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useBlockStore } from "../stores/blockStore";
import {
  useEquisetaJsonStore,
  type ViewMode,
} from "../stores/equisetaJsonStore";
import { useFloatingPanel } from "../hooks/useFloatingPanel";
import { ResizeGrip } from "../hooks/ResizeGrip";
import { getDroppedJsonText } from "../utils/equisetaJsonLoad";
import { loadEquisetaText } from "../utils/equisetaJsonController";
import {
  type FaceColor,
  type FaceDirection,
  type FtqcGraph,
  type FtqcNode,
  RIDGE_IDS,
} from "../utils/equisetaJsonSchema";

// ---------------------------------------------------------------------------
// Display constants
// ---------------------------------------------------------------------------

const FACE_COLOR_CSS: Record<FaceColor, React.CSSProperties> = {
  red: { background: "#d05050" },
  blue: { background: "#5070d0" },
  open: { background: "#f4f4f4", border: "1.5px dotted #999" },
  hadamard: { background: "#e0d040" },
  port: { background: "#c060c0" },
  null: { background: "transparent", color: "#aaa" },
};

const FACE_GRID_LAYOUT: ReadonlyArray<readonly FaceDirection[]> = [
  ["top", "north", "east"],
  ["bottom", "south", "west"],
];

const HEADER_HEIGHT = 36;

// ---------------------------------------------------------------------------
// Stats helper
// ---------------------------------------------------------------------------

interface Stats {
  nodeCount: number;
  edgeCount: number;
  colors: string[];
}

function computeStats(graph: FtqcGraph): Stats {
  const colorSet = new Set<string>();
  for (const n of graph.nodes) for (const c of Object.values(n.faces)) colorSet.add(c);
  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    colors: [...colorSet].sort(),
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatsHeader({ stats }: { stats: Stats }) {
  return (
    <div
      data-testid="stats-header"
      style={{
        padding: "6px 10px",
        fontSize: 12,
        color: "#444",
        borderBottom: "1px solid #eee",
        background: "#fafafa",
      }}
    >
      {stats.nodeCount} {stats.nodeCount === 1 ? "node" : "nodes"} ·{" "}
      {stats.edgeCount} {stats.edgeCount === 1 ? "edge" : "edges"}
      {stats.colors.length > 0 && (
        <>
          {" "}
          ·{" "}
          {stats.colors.length} {stats.colors.length === 1 ? "color" : "colors"}{" "}
          ({stats.colors.join(", ")})
        </>
      )}
    </div>
  );
}

function SegmentedToggle({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  const buttonStyle = (active: boolean): React.CSSProperties => ({
    padding: "2px 10px",
    border: "1px solid #ccc",
    background: active ? "#e8f0fe" : "#fff",
    borderColor: active ? "#4a9eff" : "#ccc",
    color: active ? "#1a4f9e" : "#333",
    cursor: "pointer",
    fontSize: 12,
    height: 22,
  });
  return (
    <div role="group" aria-label="View mode" style={{ display: "inline-flex", marginRight: 8 }}>
      <button
        style={{ ...buttonStyle(viewMode === "json"), borderRadius: "3px 0 0 3px" }}
        onClick={() => onChange("json")}
      >
        JSON
      </button>
      <button
        style={{ ...buttonStyle(viewMode === "grid"), borderRadius: "0 3px 3px 0", borderLeft: "none" }}
        onClick={() => onChange("grid")}
      >
        Grid
      </button>
    </div>
  );
}

function NodeCard({ node, index }: { node: FtqcNode; index: number }) {
  const ridgeStats = useMemo(() => {
    let trueN = 0;
    let falseN = 0;
    let nullN = 0;
    for (const id of RIDGE_IDS) {
      const v = node.ridges[id];
      if (v === true) trueN++;
      else if (v === false) falseN++;
      else nullN++;
    }
    return { trueN, falseN, nullN };
  }, [node.ridges]);

  return (
    <div
      data-testid={`node-card-${index}`}
      style={{
        border: "1px solid #ddd",
        borderRadius: 4,
        padding: 8,
        marginBottom: 8,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 12, fontFamily: "monospace", marginBottom: 6 }}>
        ({node.coordinate[0]}, {node.coordinate[1]}, {node.coordinate[2]})
      </div>
      <div style={{ display: "grid", gridTemplateRows: "auto auto", rowGap: 4 }}>
        {FACE_GRID_LAYOUT.map((row, rowIdx) => (
          <div key={rowIdx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
            {row.map((dir) => {
              const color = node.faces[dir];
              const css = FACE_COLOR_CSS[color];
              return (
                <div key={dir} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div
                    style={{
                      ...css,
                      height: 28,
                      borderRadius: 3,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 16,
                    }}
                  >
                    {color === "null" ? "—" : ""}
                  </div>
                  <div style={{ fontSize: 10, color: "#666", textAlign: "center" }}>
                    {dir} <span style={{ color: "#999" }}>({color})</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: "#666", marginTop: 6 }}>
        ridges: {ridgeStats.trueN + ridgeStats.falseN} defects
        ({ridgeStats.trueN} true, {ridgeStats.falseN} false, {ridgeStats.nullN} null)
      </div>
    </div>
  );
}

function GridView({ graph }: { graph: FtqcGraph }) {
  return (
    <div data-testid="grid-view" style={{ padding: 10 }}>
      {graph.nodes.length === 0 ? (
        <div style={{ fontSize: 12, color: "#999", padding: "16px 0" }}>(no nodes)</div>
      ) : (
        graph.nodes.map((node, i) => <NodeCard key={i} node={node} index={i} />)
      )}
      {graph.edges.length > 0 && (
        <div style={{ fontSize: 11, fontFamily: "monospace", marginTop: 8, color: "#444" }}>
          <div style={{ fontWeight: "bold", marginBottom: 4 }}>Edges</div>
          {graph.edges.map((e, i) => (
            <div key={i}>
              [{e[0].join(",")}] ↔ [{e[1].join(",")}]
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JsonView({ graph }: { graph: FtqcGraph }) {
  const text = useMemo(() => JSON.stringify(graph, null, 2), [graph]);
  return (
    <pre
      data-testid="json-view"
      style={{
        margin: 0,
        padding: 10,
        fontSize: 11,
        fontFamily: "monospace",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </pre>
  );
}

function EmptyState() {
  return (
    <div
      data-testid="empty-state"
      style={{
        padding: "32px 16px",
        textAlign: "center",
        color: "#888",
        fontSize: 13,
      }}
    >
      Drop a JSON file here or click "Open JSON…" in the Toolbar's Equiseta menu.
    </div>
  );
}

function LoadingState({ label }: { label: string | null }) {
  return (
    <div
      data-testid="loading-state"
      style={{
        padding: "32px 16px",
        textAlign: "center",
        color: "#666",
        fontSize: 13,
      }}
    >
      <span style={{ display: "inline-block", marginRight: 8 }}>
        <span
          style={{
            display: "inline-block",
            width: 14,
            height: 14,
            border: "2px solid #ccc",
            borderTopColor: "#4a9eff",
            borderRadius: "50%",
            animation: "equiseta-spin 0.8s linear infinite",
            verticalAlign: "middle",
          }}
        />
      </span>
      Loading{label ? ` ${label}` : "…"}
    </div>
  );
}

function InlineError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      data-testid="inline-error"
      style={{
        background: "#fdecea",
        color: "#a02a1a",
        padding: "8px 10px",
        fontSize: 12,
        borderBottom: "1px solid #f3c0b8",
        display: "flex",
        gap: 8,
      }}
    >
      <span style={{ flex: 1, wordBreak: "break-word" }}>{message}</span>
      <button
        onClick={onDismiss}
        title="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: "#a02a1a",
          cursor: "pointer",
          fontSize: 14,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header sub-component
// ---------------------------------------------------------------------------

function PanelHeader({
  loaded,
  viewMode,
  onChangeViewMode,
  onClose,
  dragHandleProps,
}: {
  loaded: { sourceLabel: string } | null;
  viewMode: ViewMode;
  onChangeViewMode: (m: ViewMode) => void;
  onClose: () => void;
  dragHandleProps: React.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <div
      {...dragHandleProps}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 8px",
        height: HEADER_HEIGHT,
        borderBottom: "1px solid #ddd",
        background: "#f5f5f7",
        cursor: "move",
        userSelect: "none",
      }}
    >
      <strong style={{ fontSize: 13, flex: 1 }}>
        Equiseta JSON
        {loaded ? (
          <span style={{ fontWeight: "normal", color: "#666" }}> · {loaded.sourceLabel}</span>
        ) : null}
      </strong>
      <SegmentedToggle viewMode={viewMode} onChange={onChangeViewMode} />
      <button
        onClick={onClose}
        title="Close panel"
        aria-label="Close panel"
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
          color: "#666",
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Body sub-component
// ---------------------------------------------------------------------------

function PanelBody({
  loaded,
  loading,
  loadingLabel,
  error,
  viewMode,
  stats,
  onClearError,
}: {
  loaded: { graph: FtqcGraph } | null;
  loading: boolean;
  loadingLabel: string | null;
  error: string | null;
  viewMode: ViewMode;
  stats: Stats | null;
  onClearError: () => void;
}) {
  return (
    <div
      style={{
        height: `calc(100% - ${HEADER_HEIGHT}px)`,
        overflowY: "auto",
        background: "#fff",
      }}
    >
      {error && <InlineError message={error} onDismiss={onClearError} />}
      {loaded && stats && <StatsHeader stats={stats} />}
      {loading && !loaded && <LoadingState label={loadingLabel} />}
      {loaded && (viewMode === "json" ? <JsonView graph={loaded.graph} /> : <GridView graph={loaded.graph} />)}
      {!loaded && !loading && !error && <EmptyState />}
      {loading && loaded && (
        <div style={{ padding: "4px 10px", fontSize: 11, color: "#888" }}>
          Loading {loadingLabel ?? "…"}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drag handlers hook
// ---------------------------------------------------------------------------

function useEquisetaDragHandlers() {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current++;
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current--;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current = 0;
    setIsDragOver(false);
    const result = await getDroppedJsonText(e.nativeEvent);
    const store = useEquisetaJsonStore.getState();
    if (!result.ok) {
      if (result.reason === "no-file") return;
      const token = store.beginLoad("(dropped file)");
      if (result.reason === "wrong-ext") {
        store.finishLoadErr(token, `Expected .json, got .${result.ext}`);
      } else if (result.reason === "oversized") {
        store.finishLoadErr(token, `File too large (${result.size} bytes; max ${result.maxBytes})`);
      } else if (result.reason === "read-error") {
        store.finishLoadErr(token, `Read error: ${result.message}`);
      }
      return;
    }
    await loadEquisetaText(result.text, result.filename);
  }, []);

  return { isDragOver, onDragEnter, onDragLeave, onDragOver, onDrop };
}

// ---------------------------------------------------------------------------
// Default geometry hook (clamps to viewport at mount per Hardening row #9)
// ---------------------------------------------------------------------------

function useDefaultGeometry() {
  // Clamp to viewport but enforce a min-size floor: prevents zero/negative
  // dimensions when the page is opened on a sub-300px viewport (which would
  // also poison localStorage with a bad geometry per useFloatingPanel:39).
  return useMemo(
    () => ({
      x: 16,
      y: 64,
      width: typeof window !== "undefined"
        ? Math.max(280, Math.min(360, window.innerWidth - 32))
        : 360,
      height: typeof window !== "undefined"
        ? Math.max(220, Math.min(600, window.innerHeight - 100))
        : 600,
    }),
    [],
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const SPINNER_KEYFRAMES = `
@keyframes equiseta-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

export function EquisetaJsonPanel() {
  const isOpen = useBlockStore((s) => s.equisetaPanelOpen);
  const setOpen = useBlockStore((s) => s.setEquisetaPanelOpen);

  const loaded = useEquisetaJsonStore((s) => s.loaded);
  const loading = useEquisetaJsonStore((s) => s.loading);
  const loadingLabel = useEquisetaJsonStore((s) => s.loadingLabel);
  const error = useEquisetaJsonStore((s) => s.error);
  const viewMode = useEquisetaJsonStore((s) => s.viewMode);
  const setViewMode = useEquisetaJsonStore((s) => s.setViewMode);
  const clearError = useEquisetaJsonStore((s) => s.clearError);

  const drag = useEquisetaDragHandlers();
  const defaultGeometry = useDefaultGeometry();

  const { containerStyle, dragHandleProps, resizeGripProps } = useFloatingPanel({
    id: "equiseta-json",
    defaultGeometry,
    minWidth: 280,
    minHeight: 220,
  });

  const stats = useMemo(() => (loaded ? computeStats(loaded.graph) : null), [loaded]);

  return (
    <div
      data-testid="equiseta-json-panel"
      style={{
        ...containerStyle,
        display: isOpen ? "block" : "none",
        background: "#fff",
        border: drag.isDragOver ? "2px dashed #4a9eff" : "1px solid #ccc",
        borderRadius: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        overflow: "hidden",
        zIndex: 50,
      }}
      onDragEnter={drag.onDragEnter}
      onDragLeave={drag.onDragLeave}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
    >
      <style>{SPINNER_KEYFRAMES}</style>
      <PanelHeader
        loaded={loaded}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        onClose={() => setOpen(false)}
        dragHandleProps={dragHandleProps}
      />
      <PanelBody
        loaded={loaded}
        loading={loading}
        loadingLabel={loadingLabel}
        error={error}
        viewMode={viewMode}
        stats={stats}
        onClearError={clearError}
      />
      <ResizeGrip {...resizeGripProps} />
    </div>
  );
}
