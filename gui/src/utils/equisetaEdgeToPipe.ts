/**
 * Equiseta edge → piper-draw pipe translator.
 *
 * An edge is an axis-aligned adjacency between two cubes whose touching faces
 * are both OPEN or both HADAMARD (equiseta's `Face.combine_colors` runs at
 * graph-construction time, so by serialization both seam faces show the same
 * post-XOR color). This module:
 *
 *   - validates each edge (adjacency, no dangling endpoints, no self-loop, no
 *     duplicates, compatible seam faces);
 *   - derives the pipe type from the two cubes' basis triples and the open
 *     axis;
 *   - emits one pipe Block per valid edge.
 *
 * The orchestrator (`equisetaImport.ts`) calls into here once per edge AFTER
 * building the per-coordinate node index, but tells `nodeToCube` ahead of
 * time which faces are on seams so satellite emission yields to the pipe.
 */

import { PIPE_TYPES, type Block, type CubeType, type PipeType, type Position3D } from "../types";
import type { Coordinate, FtqcEdge, FtqcNode } from "./equisetaJsonSchema";
import {
  diffAxis,
  FACE_AXIS,
  FACE_OFFSET,
  FALLBACK_PIPE_TYPE_BY_AXIS,
  pipeBetween,
  type Axis,
} from "./equisetaNodeToCube";
import type { FaceDirection } from "./equisetaJsonSchema";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type EdgeToPipeError =
  | { ok: false; reason: "edge-dangling"; endpoint: Coordinate }
  | { ok: false; reason: "edge-non-adjacent"; edge: FtqcEdge }
  | { ok: false; reason: "edge-self-loop"; coord: Coordinate }
  | { ok: false; reason: "edge-duplicate"; edge: FtqcEdge }
  | {
      ok: false;
      reason: "edge-seam-incompatible";
      edge: FtqcEdge;
      facing: { a: string; b: string };
    }
  | {
      ok: false;
      reason: "edge-no-pipe-type";
      edge: FtqcEdge;
      pattern: string;
    };

export interface EdgeToPipeSuccess {
  ok: true;
  pos: Position3D;
  pipeType: PipeType;
  /**
   * When the natively-derived pipe variant wasn't in `PIPE_TYPES` (e.g. two
   * `XZZ`-fallback cubes producing an `OZZ` seam code), the orchestrator
   * emits the pipe with this payload so the renderer overrides face materials
   * from `displayPattern`. Same INVARIANT as `Block.freeBuildOnly` (renderer
   * face-material branch only).
   */
  freeBuildOnly?: { reason: "unsupported-pattern"; displayPattern: string };
}

export type EdgeToPipeResult = EdgeToPipeSuccess | EdgeToPipeError;

// ---------------------------------------------------------------------------
// Coordinate / axis helpers
// ---------------------------------------------------------------------------

function coordKey(c: Coordinate): string {
  return `${c[0]},${c[1]},${c[2]}`;
}

function edgeKey(e: FtqcEdge): string {
  // Normalize ordering so [a,b] and [b,a] dedupe to the same key.
  const a = coordKey(e[0]);
  const b = coordKey(e[1]);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Which face of cube at `from` points toward `to`? */
function faceTowards(from: Coordinate, to: Coordinate): FaceDirection | null {
  const diff = diffAxis(from, to);
  if (diff === null || Math.abs(diff.step) !== 1) return null;
  switch (diff.axis) {
    case "X":
      return diff.step > 0 ? "east" : "west";
    case "Y":
      return diff.step > 0 ? "north" : "south";
    case "Z":
      return diff.step > 0 ? "top" : "bottom";
  }
}

// ---------------------------------------------------------------------------
// Pipe-type derivation
// ---------------------------------------------------------------------------

/**
 * Build the 3-letter pipe code (e.g., "OZX") given the open axis and the two
 * connected cubes' types.
 *
 * - **Open pipe** (`isHadamard=false`): perpendicular bases must MATCH between
 *   cube A and cube B — the pipe extends the same basis through the seam.
 * - **Hadamard pipe** (`isHadamard=true`): perpendicular bases must FLIP
 *   between cubes — a Hadamard swaps X/Z bases along the pipe axis, so the
 *   four perpendicular faces carry opposite colors on the two cubes. Pipe
 *   code uses cube A's basis (smaller-coord cube; matches the single-cube
 *   `hadamardPipeVariant` convention in `equisetaNodeToCube.ts`).
 *
 * Returns `null` if the cube types don't satisfy the constraint.
 */
function pipeCodeForAxis(
  openAxis: Axis,
  cubeA: CubeType,
  cubeB: CubeType,
  isHadamard: boolean,
): string | null {
  const axes: Axis[] = ["X", "Y", "Z"];
  const idx: Record<Axis, number> = { X: 0, Y: 1, Z: 2 };
  const out = ["", "", ""] as [string, string, string];
  for (const a of axes) {
    if (a === openAxis) {
      out[idx[a]] = "O";
    } else {
      const ca = cubeA[idx[a]];
      const cb = cubeB[idx[a]];
      if (isHadamard) {
        // Hadamard pipes: perpendicular bases must be opposite (Z↔X flip).
        if (ca === cb) return null;
      } else {
        // Open pipes: perpendicular bases must match.
        if (ca !== cb) return null;
      }
      out[idx[a]] = ca;
    }
  }
  return out.join("");
}

/**
 * Resolve the final pipe variant for an edge between two cubes.
 *
 * Strategy:
 *   1. Compute the canonical pipe code from the two cube types + seam kind.
 *   2. Append "H" iff the seam is hadamard.
 *   3. Validate the variant is in PIPE_TYPES.
 */
function resolvePipeType(
  openAxis: Axis,
  cubeA: CubeType,
  cubeB: CubeType,
  isHadamard: boolean,
): PipeType | null {
  const code = pipeCodeForAxis(openAxis, cubeA, cubeB, isHadamard);
  if (code === null) return null;
  const variant = isHadamard ? `${code}H` : code;
  return (PIPE_TYPES as readonly string[]).includes(variant)
    ? (variant as PipeType)
    : null;
}

/**
 * Permissive variant of {@link resolvePipeType}. Returns the resolved pipe type
 * with a `fallback: true` flag when the natively-derived variant isn't in
 * `PIPE_TYPES` (e.g. two `XZZ` cubes from the `ZZZ → XZZ` fallback yield code
 * `OZZ` which isn't a valid TQEC pipe), in which case the caller emits a
 * Block with `freeBuildOnly` carrying the original pattern as `displayPattern`.
 * Returns `null` only when {@link pipeCodeForAxis} fails (real constraint
 * violation — perpendicular basis mismatch between unrelated cubes).
 *
 * Fallback table picks the first `PIPE_TYPES` entry whose `O` matches the
 * open axis: `O..` → `OZX`, `.O.` → `ZOX`, `..O` → `ZXO`. Hadamard variants
 * cannot reach the fallback because the same-cube case requires perpendicular
 * MATCH which contradicts hadamard's required FLIP — so `pipeCodeForAxis`
 * returns `null` for hadamard-on-fallback inputs.
 */
function resolvePipeTypeWithFallback(
  openAxis: Axis,
  cubeA: CubeType,
  cubeB: CubeType,
  isHadamard: boolean,
): { type: PipeType; fallback: false } | { type: PipeType; fallback: true; pattern: string } | null {
  const direct = resolvePipeType(openAxis, cubeA, cubeB, isHadamard);
  if (direct !== null) return { type: direct, fallback: false };
  const code = pipeCodeForAxis(openAxis, cubeA, cubeB, isHadamard);
  if (code === null) return null;
  if (isHadamard) return null; // see comment above
  const fallbackType = FALLBACK_PIPE_TYPE_BY_AXIS.get(openAxis);
  if (fallbackType === undefined) return null;
  return { type: fallbackType, fallback: true, pattern: code };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up which face of each endpoint cube faces the other. Returns null if
 * the edge endpoints are not unit-adjacent on exactly one axis.
 */
export function seamFacesForEdge(
  edge: FtqcEdge,
): { axis: Axis; faceA: FaceDirection; faceB: FaceDirection } | null {
  const fA = faceTowards(edge[0], edge[1]);
  const fB = faceTowards(edge[1], edge[0]);
  if (fA === null || fB === null) return null;
  return { axis: FACE_AXIS[fA], faceA: fA, faceB: fB };
}

/**
 * Validate an edge and emit the corresponding pipe Block.
 *
 * Prerequisites the caller is responsible for:
 *   - `nodeIndex` is keyed by `coordKey(node.coordinate)`;
 *   - `cubeTypes` maps each coordKey to the CubeType returned by nodeToCube;
 *   - `seenEdgeKeys` is the caller's running de-dupe set (mutated here).
 */
export function edgeToPipe(
  edge: FtqcEdge,
  nodeIndex: ReadonlyMap<string, FtqcNode>,
  cubeTypes: ReadonlyMap<string, CubeType>,
  seenEdgeKeys: Set<string>,
): EdgeToPipeResult {
  const [a, b] = edge;
  const keyA = coordKey(a);
  const keyB = coordKey(b);

  // self-loop
  if (keyA === keyB) {
    return { ok: false, reason: "edge-self-loop", coord: a };
  }

  // duplicate (order-invariant)
  const eKey = edgeKey(edge);
  if (seenEdgeKeys.has(eKey)) {
    return { ok: false, reason: "edge-duplicate", edge };
  }
  seenEdgeKeys.add(eKey);

  // dangling endpoint
  const nodeA = nodeIndex.get(keyA);
  if (!nodeA) return { ok: false, reason: "edge-dangling", endpoint: a };
  const nodeB = nodeIndex.get(keyB);
  if (!nodeB) return { ok: false, reason: "edge-dangling", endpoint: b };

  // adjacency
  const seam = seamFacesForEdge(edge);
  if (seam === null) {
    return { ok: false, reason: "edge-non-adjacent", edge };
  }

  // seam-face compatibility
  const colorA = nodeA.faces[seam.faceA];
  const colorB = nodeB.faces[seam.faceB];
  const isOpen = colorA === "open" && colorB === "open";
  const isHadamard = colorA === "hadamard" && colorB === "hadamard";
  if (!isOpen && !isHadamard) {
    return {
      ok: false,
      reason: "edge-seam-incompatible",
      edge,
      facing: { a: colorA, b: colorB },
    };
  }

  // pipe type
  const typeA = cubeTypes.get(keyA);
  const typeB = cubeTypes.get(keyB);
  if (!typeA || !typeB) {
    // Caller failed to register cube types — shouldn't happen if orchestrator
    // calls nodeToCube before edgeToPipe, but treat as dangling for safety.
    return { ok: false, reason: "edge-dangling", endpoint: !typeA ? a : b };
  }
  const picked = resolvePipeTypeWithFallback(seam.axis, typeA, typeB, isHadamard);
  if (picked === null) {
    const code = pipeCodeForAxis(seam.axis, typeA, typeB, isHadamard);
    return {
      ok: false,
      reason: "edge-no-pipe-type",
      edge,
      pattern: (code ?? "?") + (isHadamard ? "H" : ""),
    };
  }

  // Place pipe at the midpoint between the two cubes.
  const posA: Position3D = {
    x: a[0] * 3,
    y: a[1] * 3,
    z: a[2] * 3,
  };
  const posB: Position3D = {
    x: b[0] * 3,
    y: b[1] * 3,
    z: b[2] * 3,
  };
  const pos = pipeBetween(posA, posB, seam.axis);

  if (picked.fallback) {
    return {
      ok: true,
      pos,
      pipeType: picked.type,
      freeBuildOnly: { reason: "unsupported-pattern", displayPattern: picked.pattern },
    };
  }
  return { ok: true, pos, pipeType: picked.type };
}

/** Build a Block from an edgeToPipe success result. */
export function pipeBlockFromResult(
  result: EdgeToPipeSuccess,
  groupId: string,
): Block {
  const base: Block = { pos: result.pos, type: result.pipeType, groupId };
  return result.freeBuildOnly !== undefined
    ? { ...base, freeBuildOnly: result.freeBuildOnly }
    : base;
}

// Re-exports for callers that don't want to depend on equisetaNodeToCube directly.
export { FACE_OFFSET };
