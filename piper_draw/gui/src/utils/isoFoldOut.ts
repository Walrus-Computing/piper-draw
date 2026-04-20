import * as THREE from "three";
import { X_COLOR, Z_COLOR } from "../types";
import type { IsoAxis } from "../types";

export const FOLD_ANGLE = Math.PI / 6;

export type ThreeAxis = 0 | 1 | 2;

// Three.js axis index → corresponding TQEC axis. Three (X, Y, Z) ↔ TQEC (X, Z, Y).
const TQEC_AXIS_FOR_THREE = [0, 2, 1] as const;

/** Three.js axis facing the camera in each iso view (the cube's "top" face from the user's perspective). */
export function isoTopThreeAxis(axis: IsoAxis): ThreeAxis {
  if (axis === "x") return 0;
  if (axis === "z") return 1;
  return 2;
}

export function colorForCubeFaceThreeAxis(blockType: string, threeAxis: ThreeAxis): THREE.Color {
  const ch = blockType[TQEC_AXIS_FOR_THREE[threeAxis]];
  return ch === "X" ? X_COLOR : Z_COLOR;
}

/** Rotate the unit plane (originally XY with +Z normal) so its normal becomes sign·basis(axis). */
export function faceOrientationEuler(axis: ThreeAxis, sign: 1 | -1): [number, number, number] {
  if (axis === 0) return [0, sign === 1 ? Math.PI / 2 : -Math.PI / 2, 0];
  if (axis === 1) return [sign === 1 ? -Math.PI / 2 : Math.PI / 2, 0, 0];
  return sign === 1 ? [0, 0, 0] : [0, Math.PI, 0];
}

/**
 * Outward fold rotation around the edge a side face shares with the top face.
 * Rotation axis = sideNormal × topNormal (always one of the basis axes), angle = `angle`.
 */
export function foldRotationEuler(
  sideAxis: ThreeAxis,
  sideSign: 1 | -1,
  topAxis: ThreeAxis,
  angle: number,
): [number, number, number] {
  const side = [0, 0, 0]; side[sideAxis] = sideSign;
  const top = [0, 0, 0]; top[topAxis] = 1;
  const cross: [number, number, number] = [
    side[1] * top[2] - side[2] * top[1],
    side[2] * top[0] - side[0] * top[2],
    side[0] * top[1] - side[1] * top[0],
  ];
  return [cross[0] * angle, cross[1] * angle, cross[2] * angle];
}
