import * as THREE from "three";
import {
  FOLD_ANGLE,
  colorForCubeFaceThreeAxis,
  faceOrientationEuler,
  foldRotationEuler,
} from "../utils/isoFoldOut";
import type { ThreeAxis } from "../utils/isoFoldOut";
import type { FaceMask } from "../types";

const noRaycast = () => {};
const HALF = 0.5;

const sharedFacePlane = new THREE.PlaneGeometry(1, 1);
const sharedFaceEdges = new THREE.EdgesGeometry(sharedFacePlane);
const foldEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
const foldFaceMaterials = new Map<number, THREE.MeshBasicMaterial>();
function foldFaceMaterial(color: THREE.Color): THREE.MeshBasicMaterial {
  const key = color.getHex();
  let mat = foldFaceMaterials.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    foldFaceMaterials.set(key, mat);
  }
  return mat;
}

function FoldFacePrimitive({ color }: { color: THREE.Color }) {
  const mat = foldFaceMaterial(color);
  return (
    <>
      <mesh raycast={noRaycast}>
        <primitive object={sharedFacePlane} attach="geometry" />
        <primitive object={mat} attach="material" />
      </mesh>
      <lineSegments raycast={noRaycast}>
        <primitive object={sharedFaceEdges} attach="geometry" />
        <primitive object={foldEdgeMaterial} attach="material" />
      </lineSegments>
    </>
  );
}

function FoldFaceMesh({ axis, sign, topAxis, foldAngle, color }: {
  axis: ThreeAxis; sign: 1 | -1; topAxis: ThreeAxis; foldAngle: number; color: THREE.Color;
}) {
  if (axis === topAxis) {
    const pos: [number, number, number] = [0, 0, 0];
    pos[topAxis] = HALF;
    return (
      <group position={pos} rotation={faceOrientationEuler(topAxis, 1)}>
        <FoldFacePrimitive color={color} />
      </group>
    );
  }
  const pivot: [number, number, number] = [0, 0, 0];
  pivot[topAxis] = HALF;
  pivot[axis] = sign * HALF;
  const facePosLocal: [number, number, number] = [0, 0, 0];
  facePosLocal[topAxis] = -HALF;
  return (
    <group position={pivot}>
      <group rotation={foldRotationEuler(axis, sign, topAxis, foldAngle)}>
        <group position={facePosLocal} rotation={faceOrientationEuler(axis, sign)}>
          <FoldFacePrimitive color={color} />
        </group>
      </group>
    </group>
  );
}

function faceMaskBit(axis: ThreeAxis, sign: 1 | -1): FaceMask {
  return 1 << (axis * 2 + (sign === 1 ? 0 : 1));
}

/**
 * Cube fold-out: top face plus 4 side faces tilted outward by FOLD_ANGLE around
 * the edge each shares with the top. Used as the iso-mode ghost preview and as
 * an overlay on placed cubes so the cube's type stays readable in iso views.
 *
 * `includeTop` — render the top face quad. Off for placed-cube overlay (the
 * cube body's own top face already shows in the same color).
 * `hiddenFaces` — skip splayed sides whose face is hidden (neighbor present),
 * so the splayed face doesn't overlap the neighbor.
 */
export function FoldOutCubeFaces({
  blockType,
  topAxis,
  includeTop = true,
  hiddenFaces = 0,
}: {
  blockType: string;
  topAxis: ThreeAxis;
  includeTop?: boolean;
  hiddenFaces?: FaceMask;
}) {
  const sides = ([0, 1, 2] as ThreeAxis[]).filter(a => a !== topAxis);
  return (
    <>
      {includeTop && (
        <FoldFaceMesh
          axis={topAxis}
          sign={1}
          topAxis={topAxis}
          foldAngle={0}
          color={colorForCubeFaceThreeAxis(blockType, topAxis)}
        />
      )}
      {sides.flatMap(a =>
        ([1, -1] as const)
          .filter(s => (hiddenFaces & faceMaskBit(a, s)) === 0)
          .map(s => (
            <FoldFaceMesh
              key={`${a}-${s}`}
              axis={a}
              sign={s}
              topAxis={topAxis}
              foldAngle={FOLD_ANGLE}
              color={colorForCubeFaceThreeAxis(blockType, a)}
            />
          ))
      )}
    </>
  );
}
