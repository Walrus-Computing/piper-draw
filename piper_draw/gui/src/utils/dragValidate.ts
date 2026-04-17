import type { Block, BlockType, CubeType, Position3D } from "../types";
import {
  blockTqecSize,
  hasCubeColorConflict,
  hasPipeColorConflict,
  hasYCubePipeAxisConflict,
  isPipeType,
  isValidPos,
  posKey,
} from "../types";

export interface MoveValidateState {
  blocks: Map<string, Block>;
  selectedKeys: Set<string>;
  freeBuild: boolean;
}

function aabbOverlap(aPos: Position3D, aType: BlockType, b: Block): boolean {
  const as = blockTqecSize(aType);
  const bs = blockTqecSize(b.type);
  return (
    aPos.x < b.pos.x + bs[0] && aPos.x + as[0] > b.pos.x &&
    aPos.y < b.pos.y + bs[1] && aPos.y + as[1] > b.pos.y &&
    aPos.z < b.pos.z + bs[2] && aPos.z + as[2] > b.pos.z
  );
}

/**
 * Returns true iff `moveSelection(delta)` would succeed without rollback.
 * Mirrors the validation inside `moveSelection` so the live ghost can colour
 * itself correctly during the drag. O(N · S) where N = total blocks, S = selection.
 */
export function isMoveValid(state: MoveValidateState, delta: Position3D): boolean {
  if (state.selectedKeys.size === 0) return false;
  if (delta.x === 0 && delta.y === 0 && delta.z === 0) return false;

  // Build the post-move block list and a reduced blocks map (selection removed)
  const newBlocks: Block[] = [];
  const reduced = new Map(state.blocks);
  for (const oldKey of state.selectedKeys) {
    const old = state.blocks.get(oldKey);
    if (!old) continue;
    const newPos: Position3D = { x: old.pos.x + delta.x, y: old.pos.y + delta.y, z: old.pos.z + delta.z };
    if (!isValidPos(newPos, old.type)) return false;
    newBlocks.push({ pos: newPos, type: old.type });
    reduced.delete(oldKey);
  }
  if (newBlocks.length === 0) return false;

  // Overlap with non-selected blocks. Shift is a bijection on the lattice, so
  // intra-selection collisions at new positions are impossible.
  for (const nb of newBlocks) {
    for (const other of reduced.values()) {
      if (aabbOverlap(nb.pos, nb.type, other)) return false;
    }
  }

  // Color conflicts against the reduced world
  if (!state.freeBuild) {
    for (const nb of newBlocks) {
      const t = nb.type;
      if (isPipeType(t) && hasPipeColorConflict(t, nb.pos, reduced)) return false;
      if (!isPipeType(t) && t !== "Y" && hasCubeColorConflict(t as CubeType, nb.pos, reduced)) return false;
      if (hasYCubePipeAxisConflict(t, nb.pos, reduced)) return false;
    }
  }

  // Defensive: new positions must all be distinct (bijection, so this holds,
  // but assert anyway to catch logic errors early)
  const seen = new Set<string>();
  for (const nb of newBlocks) {
    const k = posKey(nb.pos);
    if (seen.has(k)) return false;
    seen.add(k);
  }

  return true;
}
