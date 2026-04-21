import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlockStore } from "../stores/blockStore";
import { computeFlows, type FlowsResult } from "../utils/flows";
import { getAllPortPositions, type Position3D } from "../types";
import { isInSpanGF2, pauliToSymplectic } from "../utils/stabilizerSpan";
import { useFloatingPanel } from "../hooks/useFloatingPanel";
import { ResizeGrip } from "../hooks/ResizeGrip";
import {
  clampGeometryToSafe,
  readPanelGeometry,
  rectsOverlap,
  type SafeMargins,
} from "../hooks/floatingPanelGeometry";
import { PortsTable } from "./PortsTable";

const PANEL_MIN_WIDTH = 280;
const PANEL_MIN_HEIGHT = 220;
// Bottom inset large enough to clear the orientation gizmo (canvas-anchored
// at ~80px from the corner with an ~80px viewport), the bottom hint bar
// (bottom:20, ~30px tall), and the bottom-left "?" help button (32px + 20px
// inset). 140px is the smallest value that comfortably clears all three.
const PANEL_BOTTOM_SAFE = 140;

type Pauli = "I" | "X" | "Y" | "Z";
const PAULI_CYCLE: Pauli[] = ["I", "X", "Y", "Z"];
const nextPauli = (p: Pauli): Pauli => PAULI_CYCLE[(PAULI_CYCLE.indexOf(p) + 1) % 4];

type Query = {
  id: number;
  cells: Record<string, Pauli>; // label -> Pauli
};

const PAULI_COLOR: Record<string, string> = {
  I: "#bbb",
  X: "#ff7f7f",
  Y: "#63c676",
  Z: "#7396ff",
};

function signature(
  blocks: Map<string, { pos: Position3D; type: string }>,
  portMeta: Map<string, { label: string; io: "in" | "out" }>,
): string {
  const b: string[] = [];
  for (const [k, v] of blocks) b.push(`${k}:${v.type}`);
  b.sort();
  const m: string[] = [];
  for (const [k, v] of portMeta) m.push(`${k}=${v.label}/${v.io}`);
  m.sort();
  return b.join("|") + "#" + m.join("|");
}

function PauliCell({ pauli }: { pauli: string }) {
  const color = PAULI_COLOR[pauli] ?? "#ccc";
  const isI = pauli === "I";
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: 20,
        padding: "1px 6px",
        textAlign: "center",
        fontFamily: "monospace",
        fontWeight: 600,
        fontSize: 12,
        borderRadius: 4,
        background: color,
        color: isI ? "#555" : "#000",
        opacity: isI ? 0.6 : 1,
      }}
    >
      {pauli}
    </span>
  );
}

function EditablePauliCell({
  pauli,
  onChange,
}: {
  pauli: Pauli;
  onChange: (p: Pauli) => void;
}) {
  const color = PAULI_COLOR[pauli] ?? "#ccc";
  const isI = pauli === "I";
  return (
    <button
      type="button"
      onClick={() => onChange(nextPauli(pauli))}
      style={{
        display: "inline-block",
        minWidth: 20,
        padding: "1px 6px",
        textAlign: "center",
        fontFamily: "monospace",
        fontWeight: 600,
        fontSize: 12,
        borderRadius: 4,
        background: color,
        color: isI ? "#555" : "#000",
        opacity: isI ? 0.6 : 1,
        border: "1px solid rgba(0,0,0,0.1)",
        cursor: "pointer",
      }}
    >
      {pauli}
    </button>
  );
}

export function FlowsPanel({
  controlsRef,
  toolbarRef,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlsRef: React.RefObject<any>;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
}) {
  const open = useBlockStore((s) => s.flowsPanelOpen);
  const zxOpen = useBlockStore((s) => s.zxPanelOpen);
  const blocks = useBlockStore((s) => s.blocks);
  const portMeta = useBlockStore((s) => s.portMeta);
  const portPositions = useBlockStore((s) => s.portPositions);
  const setFlowsPanelOpen = useBlockStore((s) => s.setFlowsPanelOpen);
  const ensurePortLabels = useBlockStore((s) => s.ensurePortLabels);
  const setFlowsStore = useBlockStore((s) => s.setFlows);
  const setSelectedFlowIndex = useBlockStore((s) => s.setSelectedFlowIndex);
  const setFlowVizMode = useBlockStore((s) => s.setFlowVizMode);
  const flowVizMode = useBlockStore((s) => s.flowVizMode);
  const selectedFlowIndex = useBlockStore((s) => s.selectedFlowIndex);

  const [result, setResult] = useState<FlowsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [computedSig, setComputedSig] = useState<string | null>(null);
  const [queries, setQueries] = useState<Query[]>([]);
  const [nextQueryId, setNextQueryId] = useState(1);
  const [helpOpen, setHelpOpen] = useState(false);

  const {
    containerStyle,
    dragHandleProps,
    resizeGripProps,
    geometry,
    setGeometry,
  } = useFloatingPanel({
    id: "flows",
    defaultGeometry: {
      x: typeof window !== "undefined" ? window.innerWidth - 350 : 10,
      y: 64,
      width: 340,
      height: typeof window !== "undefined" ? window.innerHeight - 74 : 600,
    },
    minWidth: PANEL_MIN_WIDTH,
    minHeight: PANEL_MIN_HEIGHT,
  });

  // On every open transition, move out of the way of other UI:
  //   1. anti-overlap with the ZX panel (snap to left edge if both clash)
  //   2. clamp to a safe zone that excludes the top toolbar and the bottom
  //      strip occupied by the orientation gizmo / hint bar / help button.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      let next = geometry;
      if (zxOpen) {
        const other = readPanelGeometry("zx");
        if (other && rectsOverlap(next, other)) {
          next = { ...next, x: 10, y: 64 };
        }
      }
      const tbRect = toolbarRef.current?.getBoundingClientRect();
      const safe: SafeMargins = {
        top: tbRect ? Math.ceil(tbRect.bottom) + 8 : 60,
        right: 10,
        bottom: PANEL_BOTTOM_SAFE,
        left: 10,
      };
      next = clampGeometryToSafe(next, safe, PANEL_MIN_WIDTH, PANEL_MIN_HEIGHT);
      if (
        next.x !== geometry.x ||
        next.y !== geometry.y ||
        next.width !== geometry.width ||
        next.height !== geometry.height
      ) {
        setGeometry(next);
      }
    }
    wasOpen.current = open;
  }, [open, zxOpen, geometry, setGeometry, toolbarRef]);

  const portCount = useMemo(
    () => getAllPortPositions(blocks, portPositions).length,
    [blocks, portPositions],
  );

  const currentSig = useMemo(() => signature(blocks, portMeta), [blocks, portMeta]);
  const stale = result !== null && computedSig !== currentSig;

  useEffect(() => {
    if (open) ensurePortLabels();
  }, [open, ensurePortLabels, blocks, portPositions]);

  const handleCompute = useCallback(async () => {
    ensurePortLabels();
    setLoading(true);
    const s = useBlockStore.getState();
    const res = await computeFlows(s.blocks, s.portMeta);
    setResult(res);
    const sig = signature(s.blocks, s.portMeta);
    setComputedSig(sig);
    setQueries([]);
    setLoading(false);
    // Publish to store so the 3D overlay can read surfaces by index.
    if (res.ok) setFlowsStore(res.flows, sig);
    else setFlowsStore([], sig);
  }, [ensurePortLabels, setFlowsStore]);

  // When the diagram changes after a compute, auto-exit flow viz mode so the
  // overlay doesn't display surfaces that no longer match the scene.
  useEffect(() => {
    if (stale && flowVizMode) setFlowVizMode(false);
  }, [stale, flowVizMode, setFlowVizMode]);

  const generatorSpan = useMemo(() => {
    if (!result || !result.ok) return null;
    const labels = [...result.inputs, ...result.outputs];
    const vecs = result.flows.map((flow) => {
      const pauliStr = labels
        .map((l, i) =>
          i < result.inputs.length ? flow.inputs[l] ?? "I" : flow.outputs[l] ?? "I",
        )
        .join("");
      return pauliToSymplectic(pauliStr);
    });
    return { labels, vecs, inputCount: result.inputs.length };
  }, [result]);

  const addQuery = useCallback(() => {
    if (!generatorSpan) return;
    const empty: Record<string, Pauli> = {};
    generatorSpan.labels.forEach((l) => {
      empty[l] = "I";
    });
    setQueries((qs) => [...qs, { id: nextQueryId, cells: empty }]);
    setNextQueryId((n) => n + 1);
  }, [generatorSpan, nextQueryId]);

  const setQueryCell = (id: number, label: string, p: Pauli) => {
    setQueries((qs) =>
      qs.map((q) => (q.id === id ? { ...q, cells: { ...q.cells, [label]: p } } : q)),
    );
  };

  const removeQuery = (id: number) => {
    setQueries((qs) => qs.filter((q) => q.id !== id));
  };

  const isQueryInSpan = (q: Query): boolean => {
    if (!generatorSpan) return false;
    const pauliStr = generatorSpan.labels.map((l) => q.cells[l] ?? "I").join("");
    return isInSpanGF2(generatorSpan.vecs, pauliToSymplectic(pauliStr));
  };

  if (!open) return null;

  return (
    <div
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setFlowsPanelOpen(false);
        }
      }}
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
        outline: "none",
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
          Stabilizer flows (
          <a
            href="https://github.com/tqec/tqec"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#4a9eff", textDecoration: "underline" }}
          >
            tqec
          </a>
          )
        </span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={() => setHelpOpen((v) => !v)}
            aria-pressed={helpOpen}
            aria-label="About stabilizer flows"
            title="About stabilizer flows"
            style={{
              background: "none",
              border: "none",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              color: helpOpen ? "#4a9eff" : "#666",
              padding: "0 4px",
            }}
          >
            ?
          </button>
          <button
            onClick={handleCompute}
            disabled={loading || portCount === 0}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              borderRadius: 4,
              border: "1px solid #4a9eff",
              background: loading ? "#eee" : "#4a9eff",
              color: loading ? "#888" : "#fff",
              cursor: loading || portCount === 0 ? "default" : "pointer",
            }}
          >
            {loading ? "Computing…" : "Compute"}
          </button>
          <button
            onClick={() => setFlowVizMode(!flowVizMode)}
            disabled={!result?.ok || result.flows.length === 0 || stale}
            title={
              flowVizMode
                ? "Hide correlation surfaces in 3D"
                : "Show the selected flow's correlation surfaces in 3D"
            }
            style={{
              padding: "4px 10px",
              fontSize: 12,
              borderRadius: 4,
              border: `1px solid ${flowVizMode ? "#4a9eff" : "#888"}`,
              background: flowVizMode ? "#4a9eff" : "#fff",
              color: flowVizMode ? "#fff" : "#333",
              cursor:
                !result?.ok || result.flows.length === 0 || stale
                  ? "default"
                  : "pointer",
              opacity:
                !result?.ok || result.flows.length === 0 || stale ? 0.5 : 1,
            }}
          >
            View in 3D
          </button>
          <button
            onClick={() => setFlowsPanelOpen(false)}
            aria-label="Close flows panel"
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
        </div>
      </header>

      {helpOpen && (
        <section
          style={{
            padding: "10px 12px",
            background: "#f6f8fa",
            borderBottom: "1px solid #eee",
            color: "#333",
            lineHeight: 1.45,
          }}
        >
          <p style={{ margin: "0 0 8px" }}>
            A <b>stabilizer flow</b> (a.k.a. <i>correlation surface</i>) is a
            pattern of Pauli operators on the diagram's input/output ports
            that the circuit preserves. Flows form an Abelian group under
            element-wise multiplication.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            They can be used to <b>verify Clifford operations</b>: a Clifford
            map is uniquely determined by how it transports input Paulis to
            output Paulis, so matching the expected flows confirms the
            intended operation.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            Within a single <b>connected component</b> of a pipe diagram,
            there are as many flows as that component has open ports. They
            correspond to the <b>Pauli webs</b> of the component's underlying
            ZX graph.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            <b>Reading the table:</b> each row is one basis flow; columns are
            ports; cells show the Pauli (<code>I</code>/<code>X</code>/
            <code>Y</code>/<code>Z</code>) that flow assigns to that port.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            <b>Check membership</b> tests whether a candidate Pauli
            assignment you build by clicking cells lies in the span of the
            computed flows — a linear-algebra check over GF(2), ignoring
            phases.
          </p>
          <p style={{ margin: 0, fontSize: 11, color: "#666" }}>
            More:{" "}
            <a
              href="https://tqec.github.io/tqec/user_guide/terminology.html"
              target="_blank"
              rel="noreferrer"
            >
              TQEC terminology guide
            </a>
            .
          </p>
        </section>
      )}

      <div style={{ padding: "10px 12px", overflowY: "auto", flex: 1 }}>
        <PortsTable controlsRef={controlsRef} />

        <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #eee" }} />

        <section style={{ opacity: stale ? 0.45 : 1 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            Generators{" "}
            {result?.ok && (
              <span style={{ color: "#666", fontWeight: 400 }}>
                ({result.flows.length})
              </span>
            )}
            {stale && (
              <span style={{ color: "#c80", fontWeight: 400, marginLeft: 6 }}>
                stale — recompute
              </span>
            )}
          </div>
          {result === null && (
            <div style={{ color: "#888" }}>Click Compute to find flows.</div>
          )}
          {result && !result.ok && (
            <div style={{ color: "#b00", whiteSpace: "pre-wrap" }}>
              {result.error}
            </div>
          )}
          {result && result.ok && result.flows.length === 0 && (
            <div style={{ color: "#888" }}>
              No flows found (diagram has no correlation surfaces).
            </div>
          )}
          {result && result.ok && result.flows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {result.inputs.map((label) => (
                      <th
                        key={`in-${label}`}
                        style={{
                          textAlign: "center",
                          padding: "4px 6px",
                          fontFamily: "monospace",
                          borderBottom: "1px solid #ddd",
                        }}
                      >
                        {label}
                      </th>
                    ))}
                    <th style={{ padding: "0 4px", borderBottom: "1px solid #ddd" }}>→</th>
                    {result.outputs.map((label) => (
                      <th
                        key={`out-${label}`}
                        style={{
                          textAlign: "center",
                          padding: "4px 6px",
                          fontFamily: "monospace",
                          borderBottom: "1px solid #ddd",
                        }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.flows.map((flow, i) => {
                    const isActive = flowVizMode && selectedFlowIndex === i;
                    return (
                      <tr
                        key={i}
                        onClick={() => {
                          if (!result.ok || stale) return;
                          setSelectedFlowIndex(i);
                          if (!flowVizMode) setFlowVizMode(true);
                        }}
                        style={{
                          cursor: result.ok && !stale ? "pointer" : "default",
                          background: isActive ? "#e0efff" : undefined,
                          outline: isActive ? "2px solid #4a9eff" : undefined,
                        }}
                      >
                        {result.inputs.map((label) => (
                          <td
                            key={`in-${label}`}
                            style={{ padding: "3px 6px", textAlign: "center" }}
                          >
                            <PauliCell pauli={flow.inputs[label] ?? "I"} />
                          </td>
                        ))}
                        <td style={{ padding: "0 4px", color: "#888" }}>→</td>
                        {result.outputs.map((label) => (
                          <td
                            key={`out-${label}`}
                            style={{ padding: "3px 6px", textAlign: "center" }}
                          >
                            <PauliCell pauli={flow.outputs[label] ?? "I"} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {result && result.ok && result.flows.length > 0 && generatorSpan && (
          <>
            <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #eee" }} />
            <section style={{ opacity: stale ? 0.45 : 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  Check membership{" "}
                  <span style={{ color: "#666", fontWeight: 400 }}>
                    ({queries.length}/{result.flows.length})
                  </span>
                </span>
                <button
                  type="button"
                  onClick={addQuery}
                  disabled={stale || queries.length >= result.flows.length}
                  style={{
                    padding: "2px 8px",
                    fontSize: 12,
                    borderRadius: 4,
                    border: "1px solid #4a9eff",
                    background:
                      stale || queries.length >= result.flows.length ? "#eee" : "#fff",
                    color:
                      stale || queries.length >= result.flows.length ? "#aaa" : "#4a9eff",
                    cursor:
                      stale || queries.length >= result.flows.length ? "default" : "pointer",
                  }}
                >
                  + Add query
                </button>
              </div>
              <div
                style={{
                  background: "#fff3cd",
                  color: "#856404",
                  border: "1px solid #ffeeba",
                  borderRadius: 4,
                  padding: "6px 8px",
                  fontSize: 12,
                  marginBottom: 6,
                }}
              >
                ⚠ Membership checks are only reliable for pipe diagrams with a
                single connected component. Results may be incorrect for
                disconnected diagrams.
              </div>
              {queries.length === 0 && (
                <div style={{ color: "#888" }}>
                  Add a query row to check whether a Pauli flow lies in the span.
                </div>
              )}
              {queries.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        {result.inputs.map((label) => (
                          <th
                            key={`qin-${label}`}
                            style={{
                              textAlign: "center",
                              padding: "4px 6px",
                              fontFamily: "monospace",
                              borderBottom: "1px solid #ddd",
                            }}
                          >
                            {label}
                          </th>
                        ))}
                        <th style={{ padding: "0 4px", borderBottom: "1px solid #ddd" }}>
                          →
                        </th>
                        {result.outputs.map((label) => (
                          <th
                            key={`qout-${label}`}
                            style={{
                              textAlign: "center",
                              padding: "4px 6px",
                              fontFamily: "monospace",
                              borderBottom: "1px solid #ddd",
                            }}
                          >
                            {label}
                          </th>
                        ))}
                        <th style={{ borderBottom: "1px solid #ddd" }} />
                        <th style={{ borderBottom: "1px solid #ddd" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {queries.map((q) => {
                        const inSpan = isQueryInSpan(q);
                        return (
                          <tr key={q.id}>
                            {result.inputs.map((label) => (
                              <td
                                key={`qin-${label}`}
                                style={{ padding: "3px 6px", textAlign: "center" }}
                              >
                                <EditablePauliCell
                                  pauli={q.cells[label] ?? "I"}
                                  onChange={(p) => setQueryCell(q.id, label, p)}
                                />
                              </td>
                            ))}
                            <td style={{ padding: "0 4px", color: "#888" }}>→</td>
                            {result.outputs.map((label) => (
                              <td
                                key={`qout-${label}`}
                                style={{ padding: "3px 6px", textAlign: "center" }}
                              >
                                <EditablePauliCell
                                  pauli={q.cells[label] ?? "I"}
                                  onChange={(p) => setQueryCell(q.id, label, p)}
                                />
                              </td>
                            ))}
                            <td style={{ padding: "3px 6px", textAlign: "center" }}>
                              <span
                                title={inSpan ? "in span" : "not in span"}
                                style={{
                                  display: "inline-block",
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  background: inSpan ? "#d1f0d6" : "#fbd4d4",
                                  color: inSpan ? "#1a7f37" : "#b00020",
                                }}
                              >
                                {inSpan ? "✓" : "✗"}
                              </span>
                            </td>
                            <td style={{ padding: "3px 4px" }}>
                              <button
                                type="button"
                                onClick={() => removeQuery(q.id)}
                                aria-label="Remove query"
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "#999",
                                  cursor: "pointer",
                                  fontSize: 14,
                                  lineHeight: 1,
                                  padding: "0 2px",
                                }}
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
      <ResizeGrip {...resizeGripProps} />
    </div>
  );
}
