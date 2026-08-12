import type { Block, Position3D } from "../types";

/**
 * Snap a hovered grid position to the paste delta actually applied on commit.
 * Deltas are quantized to the 3-unit block period so clipboard entries keep
 * their cube/pipe lattice parity.
 */
export function snapPasteDelta(hover: Position3D): Position3D {
  return {
    x: Math.floor(hover.x / 3) * 3,
    y: Math.floor(hover.y / 3) * 3,
    z: Math.floor(hover.z / 3) * 3,
  };
}

/**
 * Delta used when committing a paste/insert with no hover target: place the
 * incoming set one block period past the scene's +X extent. Shared by
 * `commitPasteReducer`, `insertBlocks`, and the PasteGhost preview so the
 * ghost shows exactly where a hoverless commit would land.
 */
export function fallbackPasteDelta(
  existing: Map<string, Block>,
  incoming: Map<string, Block>,
): Position3D {
  if (existing.size === 0) return { x: 0, y: 0, z: 0 };
  let existingMaxX = -Infinity;
  for (const b of existing.values()) {
    if (b.pos.x > existingMaxX) existingMaxX = b.pos.x;
  }
  let incomingMinX = Infinity;
  for (const b of incoming.values()) {
    if (b.pos.x < incomingMinX) incomingMinX = b.pos.x;
  }
  const raw = existingMaxX + 3 - incomingMinX;
  return { x: Math.ceil(raw / 3) * 3, y: 0, z: 0 };
}
