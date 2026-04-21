import type { Block, Position3D, PortMeta } from "../types";

export type ZXVertexKind = "Z" | "X" | "H" | "BOUNDARY";

export interface ZXVertex {
  id: number;
  kind: ZXVertexKind;
  phase: string;
  pos: [number, number, number] | null;
  label: string | null;
}

export interface ZXEdge {
  source: number;
  target: number;
  hadamard: boolean;
}

export interface ZXGate {
  name: string;
  qubits: number[];
  controls: number;
  phase: string | null;
  adjoint: boolean;
}

export interface ZXCircuit {
  qubits: number;
  gate_count: number;
  qasm: string;
  gates: ZXGate[];
}

export interface ZXResult {
  ok: boolean;
  vertices: ZXVertex[];
  edges: ZXEdge[];
  qgraph: string;
  simplified: boolean;
  circuit: ZXCircuit | null;
  circuit_error: string | null;
  error: string | null;
}

function posFromKey(key: string): Position3D {
  const [x, y, z] = key.split(",").map(Number);
  return { x, y, z };
}

export async function computeZX(
  blocks: Map<string, Block>,
  portMeta: Map<string, PortMeta>,
  simplify: boolean,
  extract: boolean = false,
): Promise<ZXResult> {
  const blocksPayload = Array.from(blocks.values()).map((b) => ({
    pos: [b.pos.x, b.pos.y, b.pos.z],
    type: b.type,
  }));
  const portLabels = Array.from(portMeta.entries()).map(([key, meta]) => {
    const p = posFromKey(key);
    return { pos: [p.x, p.y, p.z], label: meta.label };
  });
  const portIO: Record<string, string> = {};
  for (const meta of portMeta.values()) {
    portIO[meta.label] = meta.io;
  }

  try {
    const res = await fetch("/api/zx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: blocksPayload,
        port_labels: portLabels,
        port_io: portIO,
        simplify,
        extract,
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        vertices: [],
        edges: [],
        qgraph: "",
        simplified: simplify,
        circuit: null,
        circuit_error: null,
        error: `Server error: ${res.status}`,
      };
    }
    return (await res.json()) as ZXResult;
  } catch {
    return {
      ok: false,
      vertices: [],
      edges: [],
      qgraph: "",
      simplified: simplify,
      circuit: null,
      circuit_error: null,
      error: "ZX server unavailable. Start with: npm run dev:backend",
    };
  }
}

export function downloadQGraph(qgraph: string, filename = "piper-draw.qgraph"): void {
  downloadBlob(qgraph, "application/json", filename);
}

export function downloadQasm(qasm: string, filename = "piper-draw.qasm"): void {
  downloadBlob(qasm, "text/plain", filename);
}

function downloadBlob(content: string, type: string, filename: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
