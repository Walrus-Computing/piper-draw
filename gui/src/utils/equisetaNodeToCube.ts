/**
 * Equiseta single-node → piper-draw cube translator.
 *
 * Extracted from `equisetaImport.ts` for size discipline (CLAUDE.md). One
 * node maps to one cube + adjacent port markers + adjacent hadamard pipes.
 * The conventions are exhaustively documented in `equisetaImport.ts` and
 * locked-in in the 2026-05-11 eng review.
 *
 * This module exports both the per-node translator (`nodeToCube`) and the
 * axis utilities (`FACE_AXIS`, `FACE_DIRS`, ...) the edge-to-pipe and
 * orchestrator layers share. Keeping them in one module avoids cyclic
 * imports between the two extracted modules.
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
  type FtqcNode,
} from "./equisetaJsonSchema";

// ---------------------------------------------------------------------------
// Shared axis utilities
// ---------------------------------------------------------------------------

export type Axis = "X" | "Y" | "Z";
export type Basis = "X" | "Z";

export const FACE_AXIS: Record<FaceDirection, Axis> = {
  east: "X",
  west: "X",
  north: "Y",
  south: "Y",
  top: "Z",
  bottom: "Z",
};

export const FACE_OFFSET: Record<FaceDirection, Position3D> = {
  east: { x: +1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  north: { x: 0, y: +1, z: 0 },
  south: { x: 0, y: -1, z: 0 },
  top: { x: 0, y: 0, z: +1 },
  bottom: { x: 0, y: 0, z: -1 },
};

export const PRIMARY_FACE: Record<Axis, FaceDirection> = {
  X: "east",
  Y: "north",
  Z: "top",
};

export const OPPOSITE_FACE: Record<FaceDirection, FaceDirection> = {
  east: "west",
  west: "east",
  north: "south",
  south: "north",
  top: "bottom",
  bottom: "top",
};

export const FACE_DIRS: readonly FaceDirection[] = [
  "east",
  "west",
  "north",
  "south",
  "top",
  "bottom",
];

/** Unit-step offset between two coordinates that differ on exactly one axis. */
export function diffAxis(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): { axis: Axis; step: number } | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const nonZero = [dx, dy, dz].filter((d) => d !== 0);
  if (nonZero.length !== 1) return null;
  if (dx !== 0) return { axis: "X", step: dx };
  if (dy !== 0) return { axis: "Y", step: dy };
  return { axis: "Z", step: dz };
}

/** Convert an Equiseta integer coordinate to a piper-draw cube position (scaled by 3). */
export function coordinateToCubePos(
  coord: readonly [number, number, number],
): Position3D {
  return { x: coord[0] * 3, y: coord[1] * 3, z: coord[2] * 3 };
}

/**
 * Place a pipe block in the slot adjacent to the smaller-coord cube.
 *
 * piper-draw's grid: blocks occupy positions ≡ 0 (mod 3); pipes occupy
 * positions where exactly one coord is ≡ 1 (mod 3) (see `isValidPipePos`
 * in `types/index.ts`). For cubes at (0,0,0) and (3,0,0) on the X axis, the
 * pipe lives at (1, 0, 0) — NOT the midpoint (1.5) which fails the validator.
 */
export function pipeBetween(
  cubeA: Position3D,
  cubeB: Position3D,
  axis: Axis,
): Position3D {
  const minX = Math.min(cubeA.x, cubeB.x);
  const minY = Math.min(cubeA.y, cubeB.y);
  const minZ = Math.min(cubeA.z, cubeB.z);
  return {
    x: axis === "X" ? minX + 1 : cubeA.x,
    y: axis === "Y" ? minY + 1 : cubeA.y,
    z: axis === "Z" ? minZ + 1 : cubeA.z,
  };
}

// ---------------------------------------------------------------------------
// groupId generator
//
// Duplicated from stores/groupSelectors.newGroupId to keep utils/* free of
// stores/* imports per ARCHITECTURE.md.
// ---------------------------------------------------------------------------

const GROUP_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newGroupId(): string {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += GROUP_ID_ALPHABET[Math.floor(Math.random() * GROUP_ID_ALPHABET.length)];
  }
  return s;
}

// ---------------------------------------------------------------------------
// Per-node error variants
//
// Bubble up to ImportError in equisetaImport.ts via the discriminated union.
// ---------------------------------------------------------------------------

export type NodeToCubeError =
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

export interface NodeToCubeSuccess {
  ok: true;
  /** Cube position (or, for all-open: where the port marker lands). */
  pos: Position3D;
  /** Block map containing the cube + any hadamard satellites. Empty for all-open. */
  blocks: Map<string, Block>;
  /** Port markers from `face === "port"` (and the all-open special case). */
  portPositions: Set<string>;
  /** The cube's CUBE_TYPE, or null for the all-open special case. */
  cubeType: CubeType | null;
  /** Number of port markers emitted (size of portPositions for this node). */
  portCount: number;
  /** Number of hadamard pipe satellites emitted into `blocks`. */
  hadamardCount: number;
}

export type NodeToCubeResult = NodeToCubeSuccess | NodeToCubeError;

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

/**
 * Permissive `pickCubeType`. Returns `{ type, fallback: false }` whenever
 * `pickCubeType` would succeed, or `{ type, fallback: true }` for the two
 * unsupported all-one-basis patterns (`ZZZ` → `XZZ`, `XXX` → `ZXX`). Returns
 * `null` for everything else `pickCubeType` rejects (wildcard-only inputs are
 * still gated upstream by the all-`?` check in `nodeToCube`).
 *
 * The fallback table is a 2-entry literal lookup, not an axis-matching
 * algorithm: per /autoplan 2026-05-12 eng phase the only inputs that hit the
 * fallback are `ZZZ`/`XXX` (wildcards are handled at line 354 of `nodeToCube`),
 * so a literal map is simpler, deterministic, and matches `canonicalCubeForPort`'s
 * "first valid CUBE_TYPES entry sharing axes" rule for these two cases.
 *
 * INVARIANT (eng phase): if a third unsupported-pattern input class is ever
 * possible, the assertion in `nodeToCube` fires loudly so the table is revisited.
 */
const FALLBACK_CUBE_TYPE: ReadonlyMap<string, CubeType> = new Map([
  ["ZZZ", "XZZ"],
  ["XXX", "ZXX"],
]);

export function pickCubeTypeWithFallback(
  chars: readonly [string, string, string],
): { type: CubeType; fallback: false } | { type: CubeType; fallback: true; pattern: string } | null {
  const direct = pickCubeType(chars);
  if (direct !== null) return { type: direct, fallback: false };
  // No wildcards (already rejected by pickCubeType) → check fallback table.
  if (chars.includes("?")) return null;
  const flat = chars.join("");
  const fallbackType = FALLBACK_CUBE_TYPE.get(flat);
  if (fallbackType === undefined) return null;
  return { type: fallbackType, fallback: true, pattern: flat };
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

export type BasisHints = Partial<Record<Axis, Basis>>;

/**
 * Resolve all three axis bases for a node. Returns the basis triple, or the
 * first axis-pair mismatch as an error.
 *
 * `hints` supplies graph-level basis info propagated from neighbor cubes (used
 * when a cube sandwiched between same-axis pipes has a wildcard on the hidden
 * axis but a neighbor on a perpendicular axis pins the basis).
 */
function resolveAllAxes(node: FtqcNode, hints: BasisHints = {}):
  | { ok: true; basis: { X: Basis | null; Y: Basis | null; Z: Basis | null } }
  | (NodeToCubeError & { reason: "axis-pair-mismatch" }) {
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
    result[a] = r.basis ?? hints[a] ?? null;
  }
  return { ok: true, basis: result };
}

/**
 * Emit per-face satellites (port markers, hadamard pipes) around a cube
 * centered at `pos`. Mutates `blocks` and `portPositions` in place.
 *
 * `seamFaces` are face directions that already have a pipe placed by the
 * orchestrator (from an `edges[]` entry). Skip satellite emission on those
 * faces — the edge-side pipe takes precedence.
 */
function emitSatellites(
  node: FtqcNode,
  pos: Position3D,
  finalBasis: Readonly<Record<Axis, Basis>>,
  groupId: string,
  seamFaces: ReadonlySet<FaceDirection>,
  blocks: Map<string, Block>,
  portPositions: Set<string>,
): { portCount: number; hadamardCount: number } {
  let portCount = 0;
  let hadamardCount = 0;
  for (const dir of FACE_DIRS) {
    if (seamFaces.has(dir)) continue;
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
    }
  }
  return { portCount, hadamardCount };
}

export function isValidCoordinate(c: readonly number[]): boolean {
  return (
    c.length === 3 &&
    Number.isInteger(c[0]) &&
    Number.isInteger(c[1]) &&
    Number.isInteger(c[2])
  );
}

// ---------------------------------------------------------------------------
// Public per-node API
// ---------------------------------------------------------------------------

/**
 * Translate one Equiseta node into a cube (+ port/hadamard satellites).
 *
 * `groupId` is supplied by the orchestrator so all blocks in a connected
 * component share one id. `seamFaces` lists face directions where the
 * orchestrator will place an edge-derived pipe; this node skips emitting
 * satellites on those faces to avoid colliding with the pipe.
 */
export function nodeToCube(
  node: FtqcNode,
  groupId: string,
  seamFaces: ReadonlySet<FaceDirection> = new Set(),
  basisHints: BasisHints = {},
): NodeToCubeResult {
  if (!isValidCoordinate(node.coordinate)) {
    return { ok: false, reason: "malformed-coordinate" };
  }
  const pos: Position3D = coordinateToCubePos(node.coordinate);

  if (FACE_DIRS.every((d) => node.faces[d] === "open")) {
    return {
      ok: true,
      pos,
      blocks: new Map<string, Block>(),
      portPositions: new Set<string>([posKey(pos)]),
      cubeType: null,
      portCount: 1,
      hadamardCount: 0,
    };
  }

  const bases = resolveAllAxes(node, basisHints);
  if (!bases.ok) return bases;

  const chars: [string, string, string] = [
    bases.basis.X ?? "?",
    bases.basis.Y ?? "?",
    bases.basis.Z ?? "?",
  ];
  if (chars.every((s) => s === "?")) {
    return { ok: false, reason: "no-basis-info", faces: { ...node.faces } };
  }
  const picked = pickCubeTypeWithFallback(chars);
  if (picked === null) {
    return { ok: false, reason: "unsupported-pattern", pattern: chars.join("") };
  }
  const cubeType = picked.type;

  const finalBasis: Record<Axis, Basis> = {
    X: cubeType[0] as Basis,
    Y: cubeType[1] as Basis,
    Z: cubeType[2] as Basis,
  };
  const blocks = new Map<string, Block>();
  const cubeBlock: Block = picked.fallback
    ? {
        pos,
        type: cubeType,
        groupId,
        freeBuildOnly: { reason: "unsupported-pattern", displayPattern: picked.pattern },
      }
    : { pos, type: cubeType, groupId };
  blocks.set(posKey(pos), cubeBlock);
  const portPositions = new Set<string>();
  const counts = emitSatellites(
    node,
    pos,
    finalBasis,
    groupId,
    seamFaces,
    blocks,
    portPositions,
  );

  return {
    ok: true,
    pos,
    blocks,
    portPositions,
    cubeType,
    portCount: counts.portCount,
    hadamardCount: counts.hadamardCount,
  };
}
