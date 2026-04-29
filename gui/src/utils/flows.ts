import type { Block, Position3D, PortMeta } from "../types";

export interface SurfacePiece {
  basis: "X" | "Z";
  // 4 quad corners in Three.js world coords, flattened [x0,y0,z0,...,x3,y3,z3]
  vertices: number[];
}

export interface Flow {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  surfaces: SurfacePiece[];
}

export interface FlowsResult {
  ok: boolean;
  orderedPorts: string[];
  inputs: string[];
  outputs: string[];
  flows: Flow[];
  error: string | null;
}

function posFromKey(key: string): Position3D {
  const [x, y, z] = key.split(",").map(Number);
  return { x, y, z };
}

export async function computeFlows(
  blocks: Map<string, Block>,
  portMeta: Map<string, PortMeta>,
): Promise<FlowsResult> {
  const blocksPayload = Array.from(blocks.values()).map((b) => ({
    pos: [b.pos.x, b.pos.y, b.pos.z],
    type: b.type,
  }));
  const portLabels = Array.from(portMeta.entries()).map(([key, meta]) => {
    const p = posFromKey(key);
    return { pos: [p.x, p.y, p.z], label: meta.label, rank: meta.rank ?? null };
  });
  const portIO: Record<string, string> = {};
  for (const meta of portMeta.values()) portIO[meta.label] = meta.io;

  try {
    const res = await fetch("/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: blocksPayload,
        port_labels: portLabels,
        port_io: portIO,
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        orderedPorts: [],
        inputs: [],
        outputs: [],
        flows: [],
        error: `Server error: ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      ok: boolean;
      ordered_ports: string[];
      inputs: string[];
      outputs: string[];
      flows: Flow[];
      error: string | null;
    };
    return {
      ok: data.ok,
      orderedPorts: data.ordered_ports,
      inputs: data.inputs,
      outputs: data.outputs,
      flows: data.flows,
      error: data.error,
    };
  } catch {
    return {
      ok: false,
      orderedPorts: [],
      inputs: [],
      outputs: [],
      flows: [],
      error: "Flows server unavailable. Start with: npm run dev:backend",
    };
  }
}
