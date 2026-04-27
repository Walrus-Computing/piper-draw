import * as THREE from "three";
import { blockTqecSize, type BlockType, type Position3D } from "../types";
import { shadowVisuals, shouldRenderShadow, Y_OFFSET } from "../utils/groundShadow";

// PERF NOTE: Per-instance materials (inline JSX) chosen for simplicity and
// per-elevation opacity. Worst case ~800 materials in flight at MAX_SHADOWS=200
// across 4 call sites — fine at typical scale. If perf becomes a problem at
// extreme selection sizes, swap for InstancedMesh + per-instance opacity
// vertex attribute. See TODOS.md (perf-shadows).

const noRaycast = () => {};

const planeCache = new Map<string, THREE.PlaneGeometry>();
function getPlane(sx: number, sy: number): THREE.PlaneGeometry {
  const key = `${sx}x${sy}`;
  let g = planeCache.get(key);
  if (!g) {
    g = new THREE.PlaneGeometry(sx, sy);
    planeCache.set(key, g);
  }
  return g;
}

const lineGeom = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 1, 0),
]);

/**
 * Ground-projected shadow + vertical anchor line for an elevated block.
 *
 * WORLD-SPACE COMPONENT — the `Absolute` suffix is a contract.
 *
 * This component positions itself in WORLD coordinates derived from `pos`.
 * Do NOT render it inside a positioned `<group>` wrapper — the positions will
 * compound and the shadow will end up at the wrong cell on the ground.
 *
 * Correct (rendered as a sibling of the positioned ghost):
 *   return <>
 *     <group position={[x, y, z]}><mesh>...</mesh></group>
 *     <GroundShadowAbsolute pos={tqecPos} ... />
 *   </>;
 *
 * Wrong (nested — positions compound, shadow ends up offset by [x, y, z]):
 *   return <group position={[x, y, z]}>
 *     <mesh>...</mesh>
 *     <GroundShadowAbsolute pos={tqecPos} ... />   // <-- bug
 *   </group>;
 */
export function GroundShadowAbsolute({
  pos,
  blockType,
  valid,
}: {
  pos: Position3D;
  blockType: BlockType;
  valid: boolean;
}) {
  if (!shouldRenderShadow(pos)) return null;
  const [sx, sy] = blockTqecSize(blockType);
  const v = shadowVisuals(pos, blockType, valid);

  return (
    <group position={[v.cx, 0, v.cz]}>
      <mesh
        position={[0, Y_OFFSET, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        geometry={getPlane(sx, sy)}
        raycast={noRaycast}
      >
        <meshBasicMaterial
          color={v.meshColor}
          transparent
          opacity={v.meshOpacity}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments
        position={[0, Y_OFFSET, 0]}
        scale={[1, v.lineLen, 1]}
        geometry={lineGeom}
        raycast={noRaycast}
      >
        <lineBasicMaterial
          color={v.lineColor}
          transparent
          opacity={v.lineOpacity}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}
