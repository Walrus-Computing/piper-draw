import type { Block, Position3D, PortMeta } from "../types";
import { isFreeBuildBlock } from "../types";

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
  // Quipper-style .qc; "" if pyzx couldn't emit it for this gate set.
  qc: string;
  // Google qsim input format; "" if any gate isn't representable in qsim.
  qsim: string;
  gates: ZXGate[];
  // Semantic-equality check of the extracted+optimized circuit against the
  // pre-simplification ZX graph. `null` means skipped (too many qubits, or
  // the check errored — see `verification_error`).
  verified: boolean | null;
  verification_error: string | null;
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
  // Defense-in-depth: drop free-build (non-TQEC) blocks before sending to
  // the backend. ZX requires a TQEC scene; FB pieces don't have a ZX semantic.
  const blocksPayload = Array.from(blocks.values())
    .filter((b) => !isFreeBuildBlock(b))
    .map((b) => ({
      pos: [b.pos.x, b.pos.y, b.pos.z],
      type: b.type as string,
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

export interface ZXExportPayload {
  qasm: string;
  qc: string;
  qsim: string;
  qgraph: string;
}

type ZXExportFormat = "qasm" | "qc" | "qsim" | "qgraph";

type FileSystemFileHandleLike = {
  createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
  name?: string;
};

/**
 * Open a native save dialog offering all ZX export formats. The user picks
 * filename, location, and format (via the dialog's file-type dropdown); we
 * write the matching payload based on the chosen file's extension.
 *
 * Falls back to `a.download` with a default `.qasm` filename on browsers
 * without the File System Access API (Firefox, Safari).
 */
export async function exportZX(
  payload: ZXExportPayload,
  defaultBase = "piper-draw",
): Promise<void> {
  const w = window as Window & {
    showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandleLike>;
  };
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: `${defaultBase}.qasm`,
        types: [
          { description: "OpenQASM 2.0", accept: { "text/plain": [".qasm"] } },
          { description: "Quipper .qc", accept: { "text/plain": [".qc"] } },
          { description: "Google qsim input", accept: { "text/plain": [".qsim"] } },
          { description: "pyzx graph JSON", accept: { "application/json": [".qgraph"] } },
        ],
      });
      const fmt = formatFromName(handle.name ?? `${defaultBase}.qasm`);
      const { text, mime } = contentFor(fmt, payload);
      const writable = await handle.createWritable();
      await writable.write(new Blob([text], { type: mime }));
      await writable.close();
      return;
    } catch (err: unknown) {
      // User cancelled the dialog — no-op. Anything else: fall through to
      // the legacy download path so the user still gets a file.
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  // Legacy fallback: download .qasm with the default name.
  const { text, mime } = contentFor("qasm", payload);
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${defaultBase}.qasm`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatFromName(name: string): ZXExportFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith(".qc")) return "qc";
  if (lower.endsWith(".qsim")) return "qsim";
  if (lower.endsWith(".qgraph")) return "qgraph";
  return "qasm";
}

function contentFor(fmt: ZXExportFormat, p: ZXExportPayload): { text: string; mime: string } {
  switch (fmt) {
    case "qc":
      return { text: p.qc, mime: "text/plain" };
    case "qsim":
      return { text: p.qsim, mime: "text/plain" };
    case "qgraph":
      return { text: p.qgraph, mime: "application/json" };
    case "qasm":
      return { text: p.qasm, mime: "text/plain" };
  }
}
