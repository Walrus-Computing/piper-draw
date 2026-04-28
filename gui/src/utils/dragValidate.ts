import type { Block, BlocksLookup, BlockType, CubeType, Position3D } from "../types";
import {
  blockTqecSize,
  hasCubeColorConflict,
  hasPipeColorConflict,
  hasYCubePipeAxisConflict,
  isFreeBuildPipeSpec,
  isPipeType,
  isValidPos,
  posKey,
} from "../types";

export interface MoveValidateState {
  blocks: Map<string, Block>;
  selectedKeys: Set<string>;
  freeBuild: boolean;
}

/** Serialize every unit lattice cell that `block` occupies. Cubes span 3 cells
 *  along each of the 3 axes (so 27 cells) but pipes span only 1 cell along
 *  their open axis — `blockTqecSize` returns 3 anyway because cubes/pipes
 *  share their anchor at a multiple of 3. For collision-avoidance the exact
 *  AABB in integer units is sufficient. Reuses a single scratch object. */
function forEachCell(pos: Position3D, type: BlockType, cb: (key: string) => void): void {
  const [sx, sy, sz] = blockTqecSize(type);
  for (let dx = 0; dx < sx; dx++) {
    for (let dy = 0; dy < sy; dy++) {
      for (let dz = 0; dz < sz; dz++) {
        cb(`${pos.x + dx},${pos.y + dy},${pos.z + dz}`);
      }
    }
  }
}

/**
 * Returns true iff `moveSelection(delta)` would succeed without rollback.
 * Mirrors the validation inside `moveSelection` so the live ghost can colour
 * itself correctly during the drag.
 *
 * Perf: runs on every rAF-coalesced pointer frame during a drag. Avoids
 * cloning `state.blocks`. Builds a Set of occupied unit cells once per call
 * (O(N · cellsPerBlock)) and a wrapper `BlocksLookup` that hides selected
 * keys from the color-conflict helpers (zero allocations per neighbor query).
 */
export function isMoveValid(state: MoveValidateState, delta: Position3D): boolean {
  if (state.selectedKeys.size === 0) return false;
  if (delta.x === 0 && delta.y === 0 && delta.z === 0) return false;

  const { blocks, selectedKeys, freeBuild } = state;

  // Build the post-move block list + parity check.
  const newBlocks: Block[] = [];
  for (const oldKey of selectedKeys) {
    const old = blocks.get(oldKey);
    if (!old) continue;
    const newPos: Position3D = { x: old.pos.x + delta.x, y: old.pos.y + delta.y, z: old.pos.z + delta.z };
    if (!isValidPos(newPos, old.type)) return false;
    newBlocks.push({ pos: newPos, type: old.type });
  }
  if (newBlocks.length === 0) return false;

  // Occupied-cells set for all non-selected blocks. One pass over the world.
  const occupied = new Set<string>();
  for (const [key, block] of blocks) {
    if (selectedKeys.has(key)) continue;
    forEachCell(block.pos, block.type, (k) => occupied.add(k));
  }

  // Overlap check: O(S · cellsPerBlock). Bijection → no intra-selection overlap.
  for (const nb of newBlocks) {
    let collided = false;
    forEachCell(nb.pos, nb.type, (k) => {
      if (occupied.has(k)) collided = true;
    });
    if (collided) return false;
  }

  // Color conflicts. Use a lookup wrapper that hides selected keys from
  // neighbor lookups (old selected positions must be invisible to the checks).
  if (!freeBuild) {
    const lookup: BlocksLookup = {
      get(key) {
        if (selectedKeys.has(key)) return undefined;
        return blocks.get(key);
      },
    };
    for (const nb of newBlocks) {
      const t = nb.type;
      if (isPipeType(t) && hasPipeColorConflict(t, nb.pos, lookup)) return false;
      if (!isPipeType(t) && !isFreeBuildPipeSpec(t) && t !== "Y" && hasCubeColorConflict(t as CubeType, nb.pos, lookup)) return false;
      if (hasYCubePipeAxisConflict(t, nb.pos, lookup)) return false;
    }
  }

  // Defensive: new positions must all be distinct (bijection guarantees this,
  // but assert anyway to catch logic errors early).
  const seen = new Set<string>();
  for (const nb of newBlocks) {
    const k = posKey(nb.pos);
    if (seen.has(k)) return false;
    seen.add(k);
  }

  return true;
}
