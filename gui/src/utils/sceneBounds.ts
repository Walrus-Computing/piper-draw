// ---------------------------------------------------------------------------
// sceneBounds — compute a camera that frames the whole scene, used as the
// embed's opening view when no camera was captured (utils/viewSnapshot.ts).
// Pure: derives block bounds in Three.js coords from block data alone, so the
// fit is deterministic and needs no mounted scene to traverse.
// ---------------------------------------------------------------------------

import type { Block } from "../types";
import { tqecToThree, blockThreeSize } from "../types";
import type { CameraStateV1 } from "./viewSnapshot";

const DEFAULT_FOV = 35;
// Editor's default viewing direction (camera at [14,14,-14] looking at origin).
const DIR_LEN = Math.sqrt(3);
const VIEW_DIR: [number, number, number] = [1 / DIR_LEN, 1 / DIR_LEN, -1 / DIR_LEN];

/**
 * A perspective camera positioned along the editor's default angle at a
 * distance that fits the scene's bounding sphere in view. Falls back to a
 * sensible framing of the origin when the scene is empty.
 */
export function autoFitCamera(blocks: Iterable<Block>, fov = DEFAULT_FOV): CameraStateV1 {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let any = false;
  for (const b of blocks) {
    any = true;
    const [cx, cy, cz] = tqecToThree(b.pos, b.type);
    const [w, h, d] = blockThreeSize(b.type);
    minX = Math.min(minX, cx - w / 2); maxX = Math.max(maxX, cx + w / 2);
    minY = Math.min(minY, cy - h / 2); maxY = Math.max(maxY, cy + h / 2);
    minZ = Math.min(minZ, cz - d / 2); maxZ = Math.max(maxZ, cz + d / 2);
  }

  const center: [number, number, number] = any
    ? [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
    : [0, 0, 0];
  const radius = any
    ? Math.max(0.5, 0.5 * Math.hypot(maxX - minX, maxY - minY, maxZ - minZ))
    : 5;

  const dist = (radius / Math.sin((fov * Math.PI) / 180 / 2)) * 1.15;
  // Far plane must clear the camera distance + the scene's far side, else a
  // huge scene (coords valid up to ±1e6) would clip away entirely. Keep a
  // generous floor for normal-sized scenes.
  const far = Math.max(100000, (dist + radius) * 2);
  return {
    kind: "persp",
    position: [
      center[0] + VIEW_DIR[0] * dist,
      center[1] + VIEW_DIR[1] * dist,
      center[2] + VIEW_DIR[2] * dist,
    ],
    target: center,
    up: [0, 1, 0],
    fov,
    near: 0.1,
    far,
  };
}
