/**
 * Equiseta FTQCGraph → piper-draw Block translator (orchestrator).
 *
 * Multi-cube (v0.5): each node maps to one cube via `nodeToCube`, each edge
 * maps to one pipe via `edgeToPipe`. The orchestrator pre-walks edges to
 * tell `nodeToCube` which faces are seams (so satellite emission yields to
 * the orchestrator's pipes), then unions every produced block into a single
 * Map keyed by position.
 *
 * Public API (`equisetaToBlocks`) is unchanged for single-cube inputs; for
 * multi-cube inputs `cubeType` is null and the new `cubeCount` / `pipeCount`
 * fields surface aggregates.
 *
 * Conventions and the single-cube → cube translation are documented in
 * `equisetaNodeToCube.ts`. Edge validation rules and pipe-type derivation
 * are documented in `equisetaEdgeToPipe.ts`.
 */

import type { Block, CubeType } from "../types";
import { type FaceColor, type FaceDirection, type FtqcGraph, type FtqcNode } from "./equisetaJsonSchema";
import {
  newGroupId,
  nodeToCube,
  type Axis,
  type NodeToCubeError,
} from "./equisetaNodeToCube";
import { edgeToPipe, seamFacesForEdge, type EdgeToPipeError } from "./equisetaEdgeToPipe";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ImportSuccess {
  ok: true;
  empty: false;
  blocks: Map<string, Block>;
  portPositions: Set<string>;
  /** Single-cube imports retain the cube type; multi-cube imports set this to null. */
  cubeType: CubeType | null;
  /** Number of cube blocks in the result. */
  cubeCount: number;
  /** Number of edge-derived pipe blocks. */
  pipeCount: number;
  /** Port markers (sum across all nodes). */
  portCount: number;
  /** Hadamard pipe satellites emitted from face=hadamard markers (non-seam faces). */
  hadamardCount: number;
  /**
   * Primary groupId — for single-component imports, the shared id of every
   * block. For multi-component (e.g., disconnected_pair) imports, the first
   * component's id. Kept for backwards compat with the single-cube API.
   */
  groupId: string;
}

export interface ImportEmpty {
  ok: true;
  empty: true;
}

export type ImportError = NodeToCubeError | EdgeToPipeError;

export type ImportResult = ImportSuccess | ImportEmpty | ImportError;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function coordKey(c: readonly [number, number, number]): string {
  return `${c[0]},${c[1]},${c[2]}`;
}

/**
 * Pre-walk edges → which face directions are seams per node coordinate?
 * Edges that fail adjacency are skipped here; `edgeToPipe` will surface the
 * real error in the second pass.
 */
function buildSeamsByNode(graph: FtqcGraph): Map<string, Set<FaceDirection>> {
  const seamsByNode = new Map<string, Set<FaceDirection>>();
  for (const edge of graph.edges) {
    const seam = seamFacesForEdge(edge);
    if (seam === null) continue;
    const ka = coordKey(edge[0]);
    const kb = coordKey(edge[1]);
    if (!seamsByNode.has(ka)) seamsByNode.set(ka, new Set());
    seamsByNode.get(ka)!.add(seam.faceA);
    if (!seamsByNode.has(kb)) seamsByNode.set(kb, new Set());
    seamsByNode.get(kb)!.add(seam.faceB);
  }
  return seamsByNode;
}

function buildNodeIndex(graph: FtqcGraph): Map<string, FtqcNode> {
  const out = new Map<string, FtqcNode>();
  for (const node of graph.nodes) out.set(coordKey(node.coordinate), node);
  return out;
}

/**
 * Returns a `groupIdFor(coordKey)` function that maps every node in a
 * connected component to the same fresh groupId, and new groupIds across
 * components. Union-find under the hood.
 */
function buildGroupAssigner(
  graph: FtqcGraph,
  nodeIndex: ReadonlyMap<string, FtqcNode>,
): (nodeKey: string) => string {
  const parent = new Map<string, string>();
  for (const k of nodeIndex.keys()) parent.set(k, k);
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    let cur = k;
    while (parent.get(cur)! !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const edge of graph.edges) {
    const ka = coordKey(edge[0]);
    const kb = coordKey(edge[1]);
    if (nodeIndex.has(ka) && nodeIndex.has(kb)) union(ka, kb);
  }
  const componentGroupId = new Map<string, string>();
  return (nodeKey: string): string => {
    const root = find(nodeKey);
    let g = componentGroupId.get(root);
    if (g === undefined) {
      g = newGroupId();
      componentGroupId.set(root, g);
    }
    return g;
  };
}

interface NodePassAccumulator {
  blocks: Map<string, Block>;
  ports: Set<string>;
  cubeTypes: Map<string, CubeType>;
  cubeCount: number;
  portCount: number;
  hadamardCount: number;
  firstCubeType: CubeType | null;
  firstGroupId: string | null;
}

function runNodePass(
  graph: FtqcGraph,
  seamsByNode: ReadonlyMap<string, Set<FaceDirection>>,
  groupIdFor: (key: string) => string,
): NodePassAccumulator | NodeToCubeError {
  const acc: NodePassAccumulator = {
    blocks: new Map(),
    ports: new Set(),
    cubeTypes: new Map(),
    cubeCount: 0,
    portCount: 0,
    hadamardCount: 0,
    firstCubeType: null,
    firstGroupId: null,
  };
  for (const node of graph.nodes) {
    const key = coordKey(node.coordinate);
    const gid = groupIdFor(key);
    if (acc.firstGroupId === null) acc.firstGroupId = gid;
    const seamFaces = seamsByNode.get(key) ?? new Set<FaceDirection>();
    const r = nodeToCube(node, gid, seamFaces);
    if (!r.ok) return r;
    for (const [k, v] of r.blocks) acc.blocks.set(k, v);
    for (const p of r.portPositions) acc.ports.add(p);
    if (r.cubeType !== null) {
      acc.cubeCount++;
      acc.cubeTypes.set(key, r.cubeType);
      if (acc.firstCubeType === null) acc.firstCubeType = r.cubeType;
    }
    acc.portCount += r.portCount;
    acc.hadamardCount += r.hadamardCount;
  }
  return acc;
}

/**
 * Translate an Equiseta FTQCGraph into a piper-draw block map + port positions.
 *
 * Pure function. Caller is responsible for dispatching the result to
 * `blockStore.loadBlocks` (replace) or `blockStore.insertBlocks` (append),
 * and for emitting success / failure toasts.
 */
export function equisetaToBlocks(graph: FtqcGraph): ImportResult {
  if (graph.nodes.length === 0 && graph.edges.length === 0) {
    return { ok: true, empty: true };
  }

  const seamsByNode = buildSeamsByNode(graph);
  const nodeIndex = buildNodeIndex(graph);
  const groupIdFor = buildGroupAssigner(graph, nodeIndex);

  const nodePass = runNodePass(graph, seamsByNode, groupIdFor);
  if ("ok" in nodePass && nodePass.ok === false) return nodePass;
  const acc = nodePass as NodePassAccumulator;

  const seenEdgeKeys = new Set<string>();
  let pipeCount = 0;
  for (const edge of graph.edges) {
    const ka = coordKey(edge[0]);
    const gid = groupIdFor(nodeIndex.has(ka) ? ka : coordKey(edge[1]));
    const r = edgeToPipe(edge, nodeIndex, acc.cubeTypes, seenEdgeKeys);
    if (!r.ok) return r;
    const posK = `${r.pos.x},${r.pos.y},${r.pos.z}`;
    acc.blocks.set(posK, { pos: r.pos, type: r.pipeType, groupId: gid });
    pipeCount++;
  }

  return {
    ok: true,
    empty: false,
    blocks: acc.blocks,
    portPositions: acc.ports,
    cubeType: acc.cubeCount === 1 ? acc.firstCubeType : null,
    cubeCount: acc.cubeCount,
    pipeCount,
    portCount: acc.portCount,
    hadamardCount: acc.hadamardCount,
    groupId: acc.firstGroupId ?? newGroupId(),
  };
}

/**
 * Compose a human-readable success summary string for the import toast.
 */
export function summarizeSuccess(
  result: ImportSuccess,
  filename?: string,
  verb: string = "Imported",
): string {
  if (
    result.cubeType === null &&
    result.cubeCount === 0 &&
    result.portCount === 1 &&
    result.blocks.size === 0
  ) {
    return filename
      ? `${verb} 1 port marker (all-open) from ${filename}`
      : `${verb} 1 port marker (all-open)`;
  }
  const parts: string[] = [];
  if (result.cubeCount === 1 && result.cubeType !== null) {
    parts.push(`${result.cubeType} cube`);
  } else if (result.cubeCount > 1) {
    parts.push(`${result.cubeCount} cubes`);
  }
  if (result.pipeCount > 0) {
    parts.push(`${result.pipeCount} ${result.pipeCount === 1 ? "pipe" : "pipes"}`);
  }
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

function fmtCoord(c: readonly [number, number, number]): string {
  return `[${c[0]},${c[1]},${c[2]}]`;
}

/**
 * Compose a human-readable error message for the failure toast.
 */
export function summarizeError(err: ImportError): string {
  switch (err.reason) {
    case "unsupported-pattern":
      return `No piper-draw cube type for face pattern ${err.pattern}. Equiseta accepts this; piper-draw doesn't yet.`;
    case "no-basis-info":
      return "No basis info on any face — every face is port/hadamard/null. Add at least one red or blue face to anchor the cube type.";
    case "axis-pair-mismatch":
      return `Inconsistent face colors on ${err.axis}-axis (got ${err.first} and ${err.second})`;
    case "malformed-coordinate":
      return "Invalid coordinate in nodes[0] — expected [int, int, int]";
    case "edge-dangling":
      return `Edge endpoint ${fmtCoord(err.endpoint)} not in nodes[]`;
    case "edge-non-adjacent":
      return `Edge ${fmtCoord(err.edge[0])} ↔ ${fmtCoord(err.edge[1])} is not a unit step on exactly one axis`;
    case "edge-self-loop":
      return `Self-loop edge at ${fmtCoord(err.coord)}`;
    case "edge-duplicate":
      return `Duplicate edge ${fmtCoord(err.edge[0])} ↔ ${fmtCoord(err.edge[1])}`;
    case "edge-seam-incompatible":
      return `Edge seam faces don't combine: cube at ${fmtCoord(err.edge[0])} shows ${err.facing.a}, cube at ${fmtCoord(err.edge[1])} shows ${err.facing.b}. Both must be open or both hadamard.`;
    case "edge-no-pipe-type":
      return `No piper-draw pipe type for ${fmtCoord(err.edge[0])} ↔ ${fmtCoord(err.edge[1])} (pattern ${err.pattern}). Equiseta accepts this; piper-draw doesn't yet.`;
  }
}

// Re-exports for downstream modules that imported types from here.
export type { Axis, FaceColor, FaceDirection };
