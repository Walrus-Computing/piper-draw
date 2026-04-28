import * as THREE from "three";
import type {
  Block,
  BlockType,
  CubeType,
  FBPreset,
  FreeBuildPipeSpec,
  PipeVariant,
  Position3D,
  SpatialIndex,
} from "../types";
import {
  getAdjacentPos,
  hasBlockOverlap,
  hasCubeColorConflict,
  hasPipeColorConflict,
  hasYCubePipeAxisConflict,
  isFreeBuildPipeSpec,
  isPipeType,
  isValidPipePos,
  isValidPos,
  pipeAxisFromPos,
  posKey,
  resolvePipeType,
  VARIANT_AXIS_MAP,
} from "../types";
import type { ArmedTool } from "../stores/blockStore";

// FB-aware face-resolution helpers. Pure: no React, no zustand.

export function resolvePipeTypeFromFace(
  srcPos: Position3D,
  srcType: BlockType,
  normal: THREE.Vector3,
  variant: PipeVariant,
): BlockType | null {
  for (const candidateType of VARIANT_AXIS_MAP[variant]) {
    const probe = getAdjacentPos(srcPos, srcType, normal, candidateType);
    if (!isValidPipePos(probe)) continue;
    const resolved = resolvePipeType(variant, probe);
    if (resolved) return resolved;
  }
  return null;
}

export function resolveFBSpecFromFace(
  srcPos: Position3D,
  srcType: BlockType,
  normal: THREE.Vector3,
  preset: FBPreset,
): { adj: Position3D; spec: FreeBuildPipeSpec } | null {
  for (const ax of [0, 1, 2] as const) {
    const candidate: FreeBuildPipeSpec = { ...preset.spec, openAxis: ax };
    const adj = getAdjacentPos(srcPos, srcType, normal, candidate);
    if (!isValidPipePos(adj)) continue;
    const tqecAxis = pipeAxisFromPos(adj);
    if (tqecAxis === null) continue;
    return { adj, spec: { ...preset.spec, openAxis: tqecAxis } };
  }
  return null;
}

// Snapshot the handlers project from the store before calling the decision
// functions. Keeping the surface explicit means the logic is unit-testable
// without instantiating a real store, and it documents exactly which fields
// drive place-mode behaviour.
export type PlaceModeState = {
  armedTool: ArmedTool;
  cubeType: CubeType | "Y";
  pipeVariant: PipeVariant | null;
  fbPreset: FBPreset | null;
  freeBuild: boolean;
  blocks: Map<string, Block>;
  spatialIndex: SpatialIndex;
};

export type HoverIntent =
  | {
      kind: "ghost";
      pos: Position3D;
      type: BlockType;
      invalid: boolean;
      reason?: string;
      replace: boolean;
    }
  | { kind: "clear" };

export type ClickAction =
  | { kind: "place-at"; pos: Position3D }
  | { kind: "noop" };

type Verdict =
  | { kind: "ok"; replace: boolean }
  | { kind: "invalid"; reason?: string; replace: boolean }
  | { kind: "hidden" };

function classifyTarget(
  state: PlaceModeState,
  pos: Position3D,
  type: BlockType,
  existingKey: string | undefined,
): Verdict {
  const existing = existingKey ? state.blocks.get(existingKey) : undefined;
  const replace = !!(existing && existing.type !== type);
  if (hasBlockOverlap(pos, type, state.blocks, state.spatialIndex, existingKey)) {
    return { kind: "invalid", replace };
  }
  if (existing && existing.type === type) {
    return { kind: "hidden" };
  }
  if (!state.freeBuild) {
    if (isPipeType(type) && hasPipeColorConflict(type, pos, state.blocks)) {
      return { kind: "invalid", reason: "Pipe colors don't match the adjacent cube", replace };
    }
    if (
      !isPipeType(type) &&
      !isFreeBuildPipeSpec(type) &&
      type !== "Y" &&
      hasCubeColorConflict(type as CubeType, pos, state.blocks)
    ) {
      return { kind: "invalid", reason: "Cube colors don't match the adjacent pipe", replace };
    }
    if (hasYCubePipeAxisConflict(type, pos, state.blocks)) {
      return {
        kind: "invalid",
        reason: "Y cube cannot be next to an X-open or Y-open pipe",
        replace,
      };
    }
  }
  return { kind: "ok", replace };
}

function resolveFaceDestination(
  state: PlaceModeState,
  hovered: Block,
  normal: THREE.Vector3,
): { dst: BlockType; adj: Position3D } | null {
  if (state.fbPreset) {
    const r = resolveFBSpecFromFace(hovered.pos, hovered.type, normal, state.fbPreset);
    if (!r) return null;
    return { dst: r.spec, adj: r.adj };
  }
  if (state.pipeVariant) {
    const resolved = resolvePipeTypeFromFace(hovered.pos, hovered.type, normal, state.pipeVariant);
    if (!resolved) return null;
    const adj = getAdjacentPos(hovered.pos, hovered.type, normal, resolved);
    return { dst: resolved, adj };
  }
  // Cube tool: place adjacent cube of the chosen cubeType.
  const dst: BlockType = state.cubeType;
  const adj = getAdjacentPos(hovered.pos, hovered.type, normal, dst);
  return { dst, adj };
}

export function decidePlaceModeHover(
  state: PlaceModeState,
  hovered: Block,
  faceNormal: THREE.Vector3 | null,
): HoverIntent {
  // Cube-replace runs only when the cube tool is armed. The gate makes
  // FB-armed and TQEC-pipe-armed paths fall through to face-based placement
  // regardless of cubeType's value.
  if (state.armedTool === "cube") {
    const replaceType = state.cubeType;
    if (isValidPos(hovered.pos, replaceType) && replaceType !== hovered.type) {
      const verdict = classifyTarget(state, hovered.pos, replaceType, posKey(hovered.pos));
      if (verdict.kind === "ok") {
        return {
          kind: "ghost",
          pos: hovered.pos,
          type: replaceType,
          invalid: false,
          replace: verdict.replace,
        };
      }
      if (verdict.kind === "invalid") {
        return {
          kind: "ghost",
          pos: hovered.pos,
          type: replaceType,
          invalid: true,
          reason: verdict.reason,
          replace: verdict.replace,
        };
      }
      // hidden falls through to face-based placement.
    }
  }

  if (!faceNormal) return { kind: "clear" };
  const resolved = resolveFaceDestination(state, hovered, faceNormal);
  if (!resolved) return { kind: "clear" };
  const { dst, adj } = resolved;
  if (!isValidPos(adj, dst)) return { kind: "clear" };
  const adjKey = posKey(adj);
  const existingKey = state.blocks.has(adjKey) ? adjKey : undefined;
  const verdict = classifyTarget(state, adj, dst, existingKey);
  if (verdict.kind === "hidden") return { kind: "clear" };
  return {
    kind: "ghost",
    pos: adj,
    type: dst,
    invalid: verdict.kind === "invalid",
    reason: verdict.kind === "invalid" ? verdict.reason : undefined,
    replace: verdict.replace,
  };
}

export function decidePlaceModeClick(
  state: PlaceModeState,
  clicked: Block,
  faceNormal: THREE.Vector3 | null,
): ClickAction {
  if (state.armedTool === "cube") {
    const replaceType = state.cubeType;
    if (isValidPos(clicked.pos, replaceType) && replaceType !== clicked.type) {
      return { kind: "place-at", pos: clicked.pos };
    }
  }

  if (!faceNormal) return { kind: "noop" };
  const resolved = resolveFaceDestination(state, clicked, faceNormal);
  if (!resolved) return { kind: "noop" };
  return { kind: "place-at", pos: resolved.adj };
}
