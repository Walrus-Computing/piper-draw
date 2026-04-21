import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlockStore } from "../stores/blockStore";
import {
  ResizeGrip,
  readPanelGeometry,
  rectsOverlap,
  useFloatingPanel,
} from "../hooks/useFloatingPanel";
import { PortsTable } from "./PortsTable";
import {
  computeZX,
  downloadQGraph,
  downloadQasm,
  type ZXCircuit,
  type ZXGate,
  type ZXResult,
  type ZXVertex,
} from "../utils/zx";
import type { Position3D } from "../types";

const Z_COLOR = "#5bc466";
const X_COLOR = "#ff7f7f";
const H_COLOR = "#ffe252";
const BOUNDARY_COLOR = "#ffffff";

const VIEWBOX_SIZE = 320;
const MARGIN = 32;
const SPIDER_RADIUS = 11;

function signature(
  blocks: Map<string, { pos: Position3D; type: string }>,
  portMeta: Map<string, { label: string; io: "in" | "out" }>,
): string {
  const b: string[] = [];
  for (const [k, v] of blocks) b.push(`${k}:${v.type}`);
  b.sort();
  const m: string[] = [];
  for (const [k, v] of portMeta) m.push(`${k}=${v.label}`);
  m.sort();
  return b.join("|") + "#" + m.join("|");
}

type Point2D = { x: number; y: number };

/**
 * Project a tqec 3D position to 2D SVG space.
 *
 * piper-draw's tqec axes: x/y spatial, z temporal. We map
 *   sx = x + 0.35·y   (slight parallax so distinct-y vertices don't overlap)
 *   sy = -z - 0.35·y  (temporal axis upward)
 * — a pseudo-isometric drop that matches the pipe diagram's spatial layout.
 */
function project(pos: [number, number, number]): Point2D {
  const [x, y, z] = pos;
  return { x: x + 0.35 * y, y: -z - 0.35 * y };
}

/**
 * Layout a set of vertices into SVG coordinates, using real positions where
 * available and falling back to a circle layout for positionless vertices
 * (produced by simplify). Returns a map from vertex id to SVG-space point.
 */
function layoutVertices(vertices: ZXVertex[]): Map<number, Point2D> {
  const positioned = vertices.filter((v) => v.pos !== null);
  const orphan = vertices.filter((v) => v.pos === null);

  const raw = new Map<number, Point2D>();
  for (const v of positioned) {
    raw.set(v.id, project(v.pos as [number, number, number]));
  }

  // Scale/translate so positioned vertices fill the viewbox.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of raw.values()) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const hasPositioned = raw.size > 0;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const avail = VIEWBOX_SIZE - 2 * MARGIN;
  const scale = Math.min(avail / spanX, avail / spanY, 60);

  const out = new Map<number, Point2D>();
  for (const [id, p] of raw) {
    out.set(id, {
      x: MARGIN + (p.x - minX) * scale + (avail - spanX * scale) / 2,
      y: MARGIN + (p.y - minY) * scale + (avail - spanY * scale) / 2,
    });
  }

  // Arrange orphans in a circle below / around the positioned cluster.
  if (orphan.length > 0) {
    const cx = VIEWBOX_SIZE / 2;
    const cy = hasPositioned ? VIEWBOX_SIZE - MARGIN : VIEWBOX_SIZE / 2;
    const r = Math.min(VIEWBOX_SIZE / 2 - MARGIN, 20 + 8 * orphan.length);
    orphan.forEach((v, i) => {
      const theta = (2 * Math.PI * i) / orphan.length - Math.PI / 2;
      out.set(v.id, { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
    });
  }

  return out;
}

function VertexShape({ v, at }: { v: ZXVertex; at: Point2D }) {
  const phase = v.phase !== "0" ? v.phase : "";
  if (v.kind === "BOUNDARY") {
    return (
      <g>
        <circle
          cx={at.x}
          cy={at.y}
          r={SPIDER_RADIUS - 2}
          fill={BOUNDARY_COLOR}
          stroke="#333"
          strokeWidth={1.5}
        />
        {v.label && (
          <text
            x={at.x}
            y={at.y + SPIDER_RADIUS + 12}
            textAnchor="middle"
            fontSize={11}
            fontFamily="monospace"
            fill="#222"
          >
            {v.label}
          </text>
        )}
      </g>
    );
  }
  if (v.kind === "H") {
    const s = SPIDER_RADIUS * 1.4;
    return (
      <g>
        <rect
          x={at.x - s / 2}
          y={at.y - s / 2}
          width={s}
          height={s}
          fill={H_COLOR}
          stroke="#333"
          strokeWidth={1.2}
        />
        {phase && (
          <text
            x={at.x}
            y={at.y + 4}
            textAnchor="middle"
            fontSize={10}
            fontFamily="monospace"
            fill="#222"
          >
            {phase}
          </text>
        )}
      </g>
    );
  }
  const color = v.kind === "Z" ? Z_COLOR : X_COLOR;
  return (
    <g>
      <circle
        cx={at.x}
        cy={at.y}
        r={SPIDER_RADIUS}
        fill={color}
        stroke="#333"
        strokeWidth={1.2}
      />
      {phase && (
        <text
          x={at.x}
          y={at.y + 4}
          textAnchor="middle"
          fontSize={10}
          fontFamily="monospace"
          fill="#222"
        >
          {phase}
        </text>
      )}
    </g>
  );
}

function ZXSvg({ result }: { result: ZXResult }) {
  const positions = useMemo(() => layoutVertices(result.vertices), [result.vertices]);
  const byId = useMemo(() => {
    const m = new Map<number, ZXVertex>();
    for (const v of result.vertices) m.set(v.id, v);
    return m;
  }, [result.vertices]);

  if (result.vertices.length === 0) {
    return (
      <div style={{ padding: "24px 12px", color: "#888", textAlign: "center" }}>
        Graph has no vertices.
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
      style={{ width: "100%", height: VIEWBOX_SIZE, display: "block" }}
    >
      {result.edges.map((e, i) => {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#333"
            strokeWidth={1.5}
            strokeDasharray={e.hadamard ? "4 3" : undefined}
          />
        );
      })}
      {result.vertices.map((v) => {
        const at = positions.get(v.id);
        if (!at) return null;
        const key = v.id;
        return <VertexShape key={key} v={byId.get(v.id) ?? v} at={at} />;
      })}
    </svg>
  );
}

export function ZXPanel() {
  const open = useBlockStore((s) => s.zxPanelOpen);
  const flowsOpen = useBlockStore((s) => s.flowsPanelOpen);
  const blocks = useBlockStore((s) => s.blocks);
  const portMeta = useBlockStore((s) => s.portMeta);
  const portPositions = useBlockStore((s) => s.portPositions);
  const setZXPanelOpen = useBlockStore((s) => s.setZXPanelOpen);
  const ensurePortLabels = useBlockStore((s) => s.ensurePortLabels);

  const [result, setResult] = useState<ZXResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [simplify, setSimplify] = useState(false);
  const [extract, setExtract] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const {
    containerStyle,
    dragHandleProps,
    resizeGripProps,
    geometry,
    setGeometry,
  } = useFloatingPanel({
    id: "zx",
    defaultGeometry: {
      x: typeof window !== "undefined" ? window.innerWidth - 372 : 12,
      y: 64,
      width: 360,
      height: typeof window !== "undefined" ? window.innerHeight - 76 : 600,
    },
    minWidth: 280,
    minHeight: 220,
  });

  // When this panel opens while the Flows panel is already open and the two
  // would overlap, move this panel to the left edge so both stay visible.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current && flowsOpen) {
      const other = readPanelGeometry("flows");
      if (other && rectsOverlap(geometry, other)) {
        setGeometry({ x: 12, y: 64 });
      }
    }
    wasOpen.current = open;
  }, [open, flowsOpen, geometry, setGeometry]);

  const sig = useMemo(() => signature(blocks, portMeta), [blocks, portMeta]);

  // Keep the `P1, P2, …` label allocation consistent with the Flows panel so
  // port names stay stable when both panels are used.
  useEffect(() => {
    if (open) ensurePortLabels();
  }, [open, ensurePortLabels, blocks, portPositions]);

  const compute = useCallback(
    async (doSimplify: boolean, doExtract: boolean) => {
      setLoading(true);
      const s = useBlockStore.getState();
      const res = await computeZX(s.blocks, s.portMeta, doSimplify, doExtract);
      setResult(res);
      setLoading(false);
    },
    [],
  );

  // Extracting requires the simplified graph; auto-enable simplify.
  const effectiveSimplify = simplify || extract;

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void compute(effectiveSimplify, extract);
    }, 150);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [open, sig, effectiveSimplify, extract, compute]);

  if (!open) return null;

  const stats =
    result && result.ok
      ? `${result.vertices.length} spider${result.vertices.length === 1 ? "" : "s"}, ${result.edges.length} edge${result.edges.length === 1 ? "" : "s"}`
      : null;

  return (
    <div
      style={{
        ...containerStyle,
        zIndex: 50,
        background: "#fff",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "sans-serif",
        fontSize: 12,
        color: "#222",
        overflow: "hidden",
      }}
    >
      <header
        {...dragHandleProps}
        style={{
          ...dragHandleProps.style,
          padding: "10px 12px",
          borderBottom: "1px solid #eee",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          ZX diagram (
          <a
            href="https://github.com/tqec/tqec"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#4a9eff", textDecoration: "underline" }}
          >
            tqec
          </a>
          {" + "}
          <a
            href="https://github.com/Quantomatic/pyzx"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#4a9eff", textDecoration: "underline" }}
          >
            pyzx
          </a>
          )
        </span>
        <button
          onClick={() => setZXPanelOpen(false)}
          aria-label="Close ZX panel"
          style={{
            background: "none",
            border: "none",
            fontSize: 16,
            cursor: "pointer",
            color: "#666",
            padding: "0 4px",
          }}
        >
          ✕
        </button>
      </header>

      <div style={{ padding: "10px 12px", overflowY: "auto", flex: 1 }}>
        <PortsTable />

        <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #eee" }} />

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              cursor: extract ? "default" : "pointer",
              opacity: extract ? 0.6 : 1,
            }}
            title={extract ? "Forced on by Extract circuit" : undefined}
          >
            <input
              type="checkbox"
              checked={effectiveSimplify}
              disabled={extract}
              onChange={(e) => setSimplify(e.target.checked)}
            />
            Simplify (pyzx full_reduce)
          </label>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={extract}
              onChange={(e) => setExtract(e.target.checked)}
            />
            Extract circuit (pyzx)
          </label>
          <button
            onClick={() =>
              result?.ok && result.qgraph && downloadQGraph(result.qgraph)
            }
            disabled={!result?.ok || !result.qgraph}
            style={{
              padding: "3px 10px",
              fontSize: 12,
              borderRadius: 4,
              border: "1px solid #4a9eff",
              background: !result?.ok ? "#eee" : "#fff",
              color: !result?.ok ? "#aaa" : "#4a9eff",
              cursor: !result?.ok ? "default" : "pointer",
            }}
          >
            Download .qgraph (pyzx)
          </button>
          {stats && (
            <span style={{ color: "#666", marginLeft: "auto" }}>{stats}</span>
          )}
        </div>

        {loading && !result && (
          <div style={{ color: "#888", padding: "24px 0", textAlign: "center" }}>
            Computing ZX graph…
          </div>
        )}

        {result && !result.ok && (
          <div
            style={{
              color: "#b00",
              whiteSpace: "pre-wrap",
              background: "#fbeaea",
              padding: "8px 10px",
              borderRadius: 4,
              border: "1px solid #f4c2c2",
            }}
          >
            {result.error}
          </div>
        )}

        {result && result.ok && (
          <>
            <ZXSvg result={result} />
            <div
              style={{
                display: "flex",
                gap: 12,
                marginTop: 8,
                flexWrap: "wrap",
                color: "#555",
              }}
            >
              <LegendDot color={Z_COLOR} label="Z-spider" />
              <LegendDot color={X_COLOR} label="X-spider" />
              <LegendSquare color={H_COLOR} label="H-box" />
              <LegendDot color={BOUNDARY_COLOR} label="port" outlined />
              <LegendEdge dashed label="Hadamard edge" />
            </div>
            {extract && (
              <CircuitSection
                circuit={result.circuit}
                circuitError={result.circuit_error}
              />
            )}
          </>
        )}
      </div>
      <ResizeGrip {...resizeGripProps} />
    </div>
  );
}

function CircuitSection({
  circuit,
  circuitError,
}: {
  circuit: ZXResult["circuit"];
  circuitError: string | null;
}) {
  if (circuitError) {
    return (
      <div
        style={{
          marginTop: 12,
          color: "#b00",
          whiteSpace: "pre-wrap",
          background: "#fbeaea",
          padding: "8px 10px",
          borderRadius: 4,
          border: "1px solid #f4c2c2",
        }}
      >
        {circuitError}
      </div>
    );
  }
  if (!circuit) {
    return (
      <div style={{ marginTop: 12, color: "#888" }}>Extracting circuit…</div>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span style={{ fontWeight: 600 }}>
          Circuit: {circuit.qubits} qubit{circuit.qubits === 1 ? "" : "s"},{" "}
          {circuit.gate_count} gate{circuit.gate_count === 1 ? "" : "s"}
        </span>
        <button
          onClick={() => downloadQasm(circuit.qasm)}
          style={{
            marginLeft: "auto",
            padding: "3px 10px",
            fontSize: 12,
            borderRadius: 4,
            border: "1px solid #4a9eff",
            background: "#fff",
            color: "#4a9eff",
            cursor: "pointer",
          }}
        >
          Download .qasm (pyzx)
        </button>
      </div>
      <CircuitDiagram circuit={circuit} />
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          background: "#0f1115",
          color: "#d4d4d4",
          borderRadius: 4,
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          overflowX: "auto",
          maxHeight: 200,
          overflowY: "auto",
        }}
      >
        {circuit.qasm}
      </pre>
    </div>
  );
}

// --- Circuit drawing -------------------------------------------------------

const COL_W = 28;
const ROW_H = 28;
const PAD_X = 36; // room for "q[0]" labels on the left
const PAD_Y = 14;
const GATE_BOX = 20;

function gateLabel(g: ZXGate): string {
  // Map pyzx class names to short symbols. Anything unknown shows the raw
  // class name — better visible than silently dropped.
  const base: Record<string, string> = {
    HAD: "H",
    NOT: "X",
    Z: "Z",
    S: "S",
    T: "T",
    ZPhase: "Z",
    XPhase: "X",
    YPhase: "Y",
    ParityPhase: "P",
    SWAP: "×",
    CNOT: "X", // target body
    CZ: "Z",
    CX: "X",
    CCZ: "Z",
    Tof: "X",
    Toffoli: "X",
    InitAncilla: "0",
    PostSelect: "⟨0|",
    Measurement: "M",
  };
  let label = base[g.name] ?? g.name;
  if (g.adjoint) label += "†";
  if (g.phase && g.phase !== "0" && g.phase !== "1" && !["ZPhase", "XPhase", "YPhase"].includes(g.name)) {
    label += `(${g.phase})`;
  }
  return label;
}

function CircuitDiagram({ circuit }: { circuit: ZXCircuit }) {
  if (circuit.qubits === 0 || circuit.gates.length === 0) {
    return (
      <div style={{ marginTop: 8, color: "#888", fontStyle: "italic" }}>
        Empty circuit (identity).
      </div>
    );
  }

  const cols = circuit.gates.length;
  const width = PAD_X + cols * COL_W + 12;
  const height = PAD_Y * 2 + circuit.qubits * ROW_H;

  const yOf = (q: number) => PAD_Y + q * ROW_H + ROW_H / 2;
  const xOf = (col: number) => PAD_X + col * COL_W + COL_W / 2;

  return (
    <div style={{ marginTop: 8, overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{ display: "block", background: "#fafafa", borderRadius: 4 }}
      >
        {/* qubit lines + labels */}
        {Array.from({ length: circuit.qubits }, (_, q) => (
          <g key={`q${q}`}>
            <text
              x={PAD_X - 6}
              y={yOf(q) + 3}
              textAnchor="end"
              fontSize={10}
              fontFamily="monospace"
              fill="#444"
            >
              q[{q}]
            </text>
            <line
              x1={PAD_X}
              y1={yOf(q)}
              x2={width - 6}
              y2={yOf(q)}
              stroke="#bbb"
              strokeWidth={1}
            />
          </g>
        ))}

        {/* gates */}
        {circuit.gates.map((g, i) => (
          <GateGlyph key={i} gate={g} x={xOf(i)} yOf={yOf} />
        ))}
      </svg>
    </div>
  );
}

function GateGlyph({
  gate,
  x,
  yOf,
}: {
  gate: ZXGate;
  x: number;
  yOf: (q: number) => number;
}) {
  if (gate.qubits.length === 0) return null;

  // Vertical connector spanning all involved qubits.
  const ys = gate.qubits.map(yOf);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  const controls = gate.qubits.slice(0, gate.controls);
  const targets = gate.qubits.slice(gate.controls);
  const isCNOT = gate.name === "CNOT" || gate.name === "CX";
  const isCZ = gate.name === "CZ";
  const isSWAP = gate.name === "SWAP";

  return (
    <g>
      {gate.qubits.length > 1 && (
        <line x1={x} y1={yMin} x2={x} y2={yMax} stroke="#333" strokeWidth={1.4} />
      )}
      {controls.map((q) => (
        <circle key={`c${q}`} cx={x} cy={yOf(q)} r={3.5} fill="#333" />
      ))}
      {targets.map((q) => {
        if (isCNOT) {
          return (
            <g key={`t${q}`}>
              <circle
                cx={x}
                cy={yOf(q)}
                r={GATE_BOX / 2 - 2}
                fill="#fff"
                stroke="#333"
                strokeWidth={1.2}
              />
              <line
                x1={x - GATE_BOX / 2 + 4}
                y1={yOf(q)}
                x2={x + GATE_BOX / 2 - 4}
                y2={yOf(q)}
                stroke="#333"
                strokeWidth={1.2}
              />
              <line
                x1={x}
                y1={yOf(q) - GATE_BOX / 2 + 4}
                x2={x}
                y2={yOf(q) + GATE_BOX / 2 - 4}
                stroke="#333"
                strokeWidth={1.2}
              />
            </g>
          );
        }
        if (isCZ) {
          return <circle key={`t${q}`} cx={x} cy={yOf(q)} r={3.5} fill="#333" />;
        }
        if (isSWAP) {
          const r = 5;
          return (
            <g key={`t${q}`} stroke="#333" strokeWidth={1.4}>
              <line x1={x - r} y1={yOf(q) - r} x2={x + r} y2={yOf(q) + r} />
              <line x1={x - r} y1={yOf(q) + r} x2={x + r} y2={yOf(q) - r} />
            </g>
          );
        }
        return <GateBox key={`t${q}`} x={x} y={yOf(q)} gate={gate} />;
      })}
    </g>
  );
}

function GateBox({ x, y, gate }: { x: number; y: number; gate: ZXGate }) {
  const label = gateLabel(gate);
  // Color-code: H yellow, X red, Z/S/T green-ish (pyzx convention).
  const fill = label.startsWith("H")
    ? "#ffe252"
    : label.startsWith("X")
      ? "#ff7f7f"
      : "#5bc466";
  // Wider box if label is long.
  const w = Math.max(GATE_BOX, 8 + 6 * label.length);
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y - GATE_BOX / 2}
        width={w}
        height={GATE_BOX}
        fill={fill}
        stroke="#333"
        strokeWidth={1.2}
        rx={2}
      />
      <text
        x={x}
        y={y + 3.5}
        textAnchor="middle"
        fontSize={10}
        fontFamily="monospace"
        fill="#222"
      >
        {label}
      </text>
    </g>
  );
}

function LegendDot({
  color,
  label,
  outlined,
}: {
  color: string;
  label: string;
  outlined?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          border: outlined ? "1.5px solid #333" : "1px solid #333",
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

function LegendSquare({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          width: 10,
          height: 10,
          background: color,
          border: "1px solid #333",
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

function LegendEdge({ dashed, label }: { dashed?: boolean; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <svg width={18} height={6} style={{ display: "inline-block" }}>
        <line
          x1={0}
          y1={3}
          x2={18}
          y2={3}
          stroke="#333"
          strokeWidth={1.5}
          strokeDasharray={dashed ? "4 3" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}
