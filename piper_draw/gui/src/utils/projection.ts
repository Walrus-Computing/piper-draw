import * as THREE from "three";
import type { Block } from "../types";
import { tqecToThree, yBlockZOffset } from "../types";

const _vec3 = new THREE.Vector3();

/**
 * Returns the position keys of all blocks whose projected screen-space center
 * falls inside the given rectangle (in canvas-relative pixels).
 */
export function getBlockKeysInScreenRect(
  blocks: Map<string, Block>,
  camera: THREE.Camera,
  canvasWidth: number,
  canvasHeight: number,
  rect: { x1: number; y1: number; x2: number; y2: number },
): string[] {
  const minX = Math.min(rect.x1, rect.x2);
  const maxX = Math.max(rect.x1, rect.x2);
  const minY = Math.min(rect.y1, rect.y2);
  const maxY = Math.max(rect.y1, rect.y2);

  const result: string[] = [];
  for (const [key, block] of blocks) {
    const zo = block.type === "Y" ? yBlockZOffset(block.pos, blocks) : 0;
    const [tx, ty, tz] = tqecToThree(block.pos, block.type, zo);
    _vec3.set(tx, ty, tz);
    _vec3.project(camera);
    // Skip blocks behind camera
    if (_vec3.z > 1) continue;
    // Convert NDC (-1..1) to canvas pixels
    const sx = ((_vec3.x + 1) / 2) * canvasWidth;
    const sy = ((1 - _vec3.y) / 2) * canvasHeight;
    if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
      result.push(key);
    }
  }
  return result;
}
