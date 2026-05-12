/**
 * Equiseta FTQCGraph → piper-draw Block translator.
 *
 * v0.4.0.0 (single-node): converts a 1-node Equiseta JSON into 1 cube + its
 * adjacent port markers and hadamard pipes. Multi-node graphs are rejected.
 *
 * ## Convention table (locked in eng-review 2026-05-11)
 *
 *   EQUISETA face direction → piper-draw axis
 *     east, west             → X-axis
 *     north, south           → Y-axis
 *     top, bottom            → Z-axis
 *
 *   EQUISETA face color → piper-draw basis
 *     red                    → X-basis (matches types/index.ts:132 X_COLOR)
 *     blue                   → Z-basis (matches types/index.ts:133 Z_COLOR)
 *     port                   → no basis; emit port marker at ±1 offset
 *     hadamard               → no basis; emit hadamard pipe at ±1 offset
 *     open, null             → no satellite; basis read from opposing face
 *
 *   piper-draw cube type = basis(east) + basis(north) + basis(top)
 *   Must be one of CUBE_TYPES = [XZZ, ZXZ, ZXX, XXZ, ZZX, XZX]. XXX and
 *   ZZZ are not representable — reject with the unsupported-pattern error.
 *
 * ## Coordinate mapping
 *
 *   piper-draw cubes snap to multiples of 3. For an Equiseta node at
 *   [i, j, k], the cube lands at { x: i*3, y: j*3, z: k*3 }. Satellites
 *   (port markers, hadamard pipes) sit at ±1 from the cube center along
 *   the axis named by the face direction.
 *
 * ## Special case: all_open
 *
 *   An Equiseta node with all 6 faces = "open" has no basis info anywhere.
 *   Rather than rejecting, emit a single port marker at the resolved
 *   coordinate. The marker sits on the grid as an orphan port — piper-draw's
 *   `canonicalCubeForPort` only auto-promotes a port when it has ≥2 attached
 *   pipes, so the user must add neighbors (or paint pipes onto its faces)
 *   for the port to become anything more than a marker. This is the cleanest
 *   v1 representation of a face-pattern that has no piper-draw cube type.
 */

import {
  CUBE_TYPES,
  PIPE_TYPES,
  posKey,
  type Block,
  type CubeType,
  type PipeType,
  type Position3D,
} from "../types";
import {
  type FaceColor,
  type FaceDirection,
  type FtqcGraph,
  type FtqcNode,
} from "./equisetaJsonSchema";

// ---------------------------------------------------------------------------
// Convention constants
// ---------------------------------------------------------------------------

type Axis = "X" | "Y" | "Z";
type Basis = "X" | "Z";

const FACE_AXIS: Record<FaceDirection, Axis> = {
  east: "X",
  west: "X",
  north: "Y",
  south: "Y",
  top: "Z",
  bottom: "Z",
};

const FACE_OFFSET: Record<FaceDirection, Position3D> = {
  east: { x: +1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  north: { x: 0, y: +1, z: 0 },
  south: { x: 0, y: -1, z: 0 },
  top: { x: 0, y: 0, z: +1 },
  bottom: { x: 0, y: 0, z: -1 },
};

const PRIMARY_FACE: Record<Axis, FaceDirection> = {
  X: "east",
  Y: "north",
  Z: "top",
};

const OPPOSITE_FACE: Record<FaceDirection, FaceDirection> = {
  east: "west",
  west: "east",
  north: "south",
  south: "north",
  top: "bottom",
  bottom: "top",
};

const FACE_DIRS: readonly FaceDirection[] = [
  "east",
  "west",
  "north",
  "south",
  "top",
  "bottom",
];

// ---------------------------------------------------------------------------
// groupId generator
//
// Duplicated from stores/groupSelectors.newGroupId to keep utils/* free of
// stores/* imports per ARCHITECTURE.md.
// ---------------------------------------------------------------------------

const GROUP_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function newGroupId(): string {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += GROUP_ID_ALPHABET[Math.floor(Math.random() * GROUP_ID_ALPHABET.length)];
  }
  return s;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ImportSuccess {
  ok: true;
  empty: false;
  blocks: Map<string, Block>;
  portPositions: Set<string>;
  cubeType: CubeType | null;
  portCount: number;
  hadamardCount: number;
  groupId: string;
}

export interface ImportEmpty {
  ok: true;
  empty: true;
}

export type ImportError =
  | { ok: false; reason: "multi-node"; nodes: number; edges: number }
  | { ok: false; reason: "unsupported-pattern"; pattern: string }
  | { ok: false; reason: "no-basis-info"; faces: Record<FaceDirection, FaceColor> }
  | {
      ok: false;
      reason: "axis-pair-mismatch";
      axis: Axis;
      first: FaceColor;
      second: FaceColor;
    }
  | { ok: false; reason: "malformed-coordinate" };

export type ImportResult = ImportSuccess | ImportEmpty | ImportError;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function basisFromColor(color: FaceColor): Basis | null {
  if (color === "red") return "X";
  if (color === "blue") return "Z";
  return null;
}

type AxisResolution =
  | { ok: true; basis: Basis | null }
  | { ok: false; first: FaceColor; second: FaceColor };

function resolveAxisBasis(node: FtqcNode, axis: Axis): AxisResolution {
  const primary = PRIMARY_FACE[axis];
  const opposite = OPPOSITE_FACE[primary];
  const cP = node.faces[primary];
  const cO = node.faces[opposite];
  const bP = basisFromColor(cP);
  const bO = basisFromColor(cO);
  if (bP !== null && bO !== null) {
    if (bP !== bO) return { ok: false, first: cP, second: cO };
    return { ok: true, basis: bP };
  }
  if (bP !== null) return { ok: true, basis: bP };
  if (bO !== null) return { ok: true, basis: bO };
  return { ok: true, basis: null };
}

function pickCubeType(chars: readonly [string, string, string]): CubeType | null {
  // Exact match shortcut.
  if (!chars.includes("?")) {
    const flat = chars.join("");
    return (CUBE_TYPES as readonly string[]).includes(flat) ? (flat as CubeType) : null;
  }
  // Wildcard match — first valid type in CUBE_TYPES order (canonicalization rule).
  const matches = (CUBE_TYPES as readonly string[]).filter((t) =>
    [0, 1, 2].every((i) => chars[i] === "?" || chars[i] === t[i]),
  );
  return matches.length > 0 ? (matches[0] as CubeType) : null;
}

function hadamardPipeVariant(
  axis: Axis,
  cubeBasis: Readonly<Record<Axis, Basis>>,
): PipeType | null {
  const codes: Record<Axis, string> = {
    X: axis === "X" ? "O" : cubeBasis.X,
    Y: axis === "Y" ? "O" : cubeBasis.Y,
    Z: axis === "Z" ? "O" : cubeBasis.Z,
  };
  const flat = `${codes.X}${codes.Y}${codes.Z}H`;
  return (PIPE_TYPES as readonly string[]).includes(flat) ? (flat as PipeType) : null;
}

/**
 * Resolve all three axis bases for a node. Returns the basis triple, or the
 * first axis-pair mismatch as an error. The bases may individually be null
 * when both faces of an axis pair carry non-basis colors (port / hadamard /
 * open / null).
 */
function resolveAllAxes(node: FtqcNode):
  | { ok: true; basis: { X: Basis | null; Y: Basis | null; Z: Basis | null } }
  | (ImportError & { reason: "axis-pair-mismatch" }) {
  const axes: Axis[] = ["X", "Y", "Z"];
  const result = { X: null as Basis | null, Y: null as Basis | null, Z: null as Basis | null };
  for (const a of axes) {
    const r = resolveAxisBasis(node, a);
    if (!r.ok) {
      return {
        ok: false,
        reason: "axis-pair-mismatch",
        axis: a,
        first: r.first,
        second: r.second,
      };
    }
    result[a] = r.basis;
  }
  return { ok: true, basis: result };
}

/**
 * Emit per-face satellites (port markers, hadamard pipes) around a cube
 * centered at `pos`. Mutates `blocks` and `portPositions` in place.
 */
function emitSatellites(
  node: FtqcNode,
  pos: Position3D,
  finalBasis: Readonly<Record<Axis, Basis>>,
  groupId: string,
  blocks: Map<string, Block>,
  portPositions: Set<string>,
): { portCount: number; hadamardCount: number } {
  let portCount = 0;
  let hadamardCount = 0;
  for (const dir of FACE_DIRS) {
    const color = node.faces[dir];
    if (color !== "port" && color !== "hadamard") continue;
    const offset = FACE_OFFSET[dir];
    const satPos: Position3D = {
      x: pos.x + offset.x,
      y: pos.y + offset.y,
      z: pos.z + offset.z,
    };
    if (color === "port") {
      portPositions.add(posKey(satPos));
      portCount++;
    } else {
      // hadamard
      const variant = hadamardPipeVariant(FACE_AXIS[dir], finalBasis);
      if (variant !== null) {
        blocks.set(posKey(satPos), { pos: satPos, type: variant, groupId });
        hadamardCount++;
      }
      // null variant (e.g., XXX basis on a hadamard face) is unreachable
      // here because pickCubeType would have rejected the cube first.
    }
  }
  return { portCount, hadamardCount };
}

function isValidCoordinate(c: readonly number[]): boolean {
  return (
    c.length === 3 &&
    Number.isInteger(c[0]) &&
    Number.isInteger(c[1]) &&
    Number.isInteger(c[2])
  );
}

function allOpenResult(pos: Position3D): ImportSuccess {
  return {
    ok: true,
    empty: false,
    blocks: new Map<string, Block>(),
    portPositions: new Set<string>([posKey(pos)]),
    cubeType: null,
    portCount: 1,
    hadamardCount: 0,
    groupId: newGroupId(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate an Equiseta FTQCGraph into a piper-draw block map + port positions.
 *
 * Pure function. Caller is responsible for dispatching the result to
 * `blockStore.loadBlocks` (replace) or `blockStore.insertBlocks` (append),
 * and for emitting success / failure toasts.
 */
export function equisetaToBlocks(graph: FtqcGraph): ImportResult {
  if (graph.nodes.length === 0 && graph.edges.length === 0) {
    return { ok: true, empty: true }; // D8
  }
  if (graph.nodes.length > 1 || graph.edges.length > 0) {
    return {
      ok: false,
      reason: "multi-node",
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    };
  }

  const node = graph.nodes[0];
  if (!isValidCoordinate(node.coordinate)) {
    return { ok: false, reason: "malformed-coordinate" };
  }
  const pos: Position3D = {
    x: node.coordinate[0] * 3,
    y: node.coordinate[1] * 3,
    z: node.coordinate[2] * 3,
  };

  if (FACE_DIRS.every((d) => node.faces[d] === "open")) {
    return allOpenResult(pos);
  }

  const bases = resolveAllAxes(node);
  if (!bases.ok) return bases;

  const chars: [string, string, string] = [
    bases.basis.X ?? "?",
    bases.basis.Y ?? "?",
    bases.basis.Z ?? "?",
  ];
  if (chars.every((s) => s === "?")) {
    // Every face is port/hadamard/null/mixed-open — no basis info on any axis.
    // The all_open case is handled above; this is the heterogeneous variant.
    return { ok: false, reason: "no-basis-info", faces: { ...node.faces } };
  }
  const cubeType = pickCubeType(chars);
  if (cubeType === null) {
    return { ok: false, reason: "unsupported-pattern", pattern: chars.join("") };
  }

  const finalBasis: Record<Axis, Basis> = {
    X: cubeType[0] as Basis,
    Y: cubeType[1] as Basis,
    Z: cubeType[2] as Basis,
  };
  const groupId = newGroupId();
  const blocks = new Map<string, Block>();
  blocks.set(posKey(pos), { pos, type: cubeType, groupId });
  const portPositions = new Set<string>();
  const counts = emitSatellites(node, pos, finalBasis, groupId, blocks, portPositions);

  return {
    ok: true,
    empty: false,
    blocks,
    portPositions,
    cubeType,
    portCount: counts.portCount,
    hadamardCount: counts.hadamardCount,
    groupId,
  };
}

/**
 * Compose a human-readable success summary string for the import toast.
 * Pure helper exposed for use by the panel. `verb` is the action label
 * ("Imported" / "Inserted"); avoid regex substitution on the returned string.
 */
export function summarizeSuccess(
  result: ImportSuccess,
  filename?: string,
  verb: string = "Imported",
): string {
  if (result.cubeType === null && result.portCount === 1 && result.blocks.size === 0) {
    return filename
      ? `${verb} 1 port marker (all-open) from ${filename}`
      : `${verb} 1 port marker (all-open)`;
  }
  const parts: string[] = [];
  if (result.cubeType !== null) parts.push(`${result.cubeType} cube`);
  if (result.portCount > 0) {
    parts.push(`${result.portCount} ${result.portCount === 1 ? "port" : "ports"}`);
  }
  if (result.hadamardCount > 0) {
    parts.push(
      `${result.hadamardCount} hadamard ${result.hadamardCount === 1 ? "pipe" : "pipes"}`,
    );
  }
  const body = parts.join(" + ");
  return filename ? `${verb} ${body} from ${filename}` : `${verb} ${body}`;
}

/**
 * Compose a human-readable error message for the failure toast.
 */
export function summarizeError(err: ImportError): string {
  switch (err.reason) {
    case "multi-node": {
      const nodeWord = err.nodes === 1 ? "node" : "nodes";
      const edgeWord = err.edges === 1 ? "edge" : "edges";
      return `Multi-node Equiseta import not yet supported (got ${err.nodes} ${nodeWord}, ${err.edges} ${edgeWord})`;
    }
    case "unsupported-pattern":
      return `No piper-draw cube type for face pattern ${err.pattern}. Equiseta accepts this; piper-draw doesn't yet.`;
    case "no-basis-info":
      return "No basis info on any face — every face is port/hadamard/null. Add at least one red or blue face to anchor the cube type.";
    case "axis-pair-mismatch":
      return `Inconsistent face colors on ${err.axis}-axis (got ${err.first} and ${err.second})`;
    case "malformed-coordinate":
      return "Invalid coordinate in nodes[0] — expected [int, int, int]";
  }
}
