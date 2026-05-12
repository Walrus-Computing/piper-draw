import * as THREE from "three";
import { useMemo } from "react";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, yBlockZOffset, isValidPos } from "../types";
import type { Block, Position3D } from "../types";
import { getCachedGeometry, getCachedEdges } from "./blockInstancesShared";
import { GroundShadowAbsolute } from "./GroundShadowAbsolute";

const MAX_PASTE_SHADOWS = 200;

const noRaycast = () => {};

const pasteMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const pasteLineMaterial = new THREE.LineBasicMaterial({
  color: "#000000",
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
});
const invalidMaterial = new THREE.MeshLambertMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const invalidLineMaterial = new THREE.LineBasicMaterial({
  color: "#ff0000",
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
});

function snapDelta(hover: Position3D): Position3D {
  return {
    x: Math.floor(hover.x / 3) * 3,
    y: Math.floor(hover.y / 3) * 3,
    z: Math.floor(hover.z / 3) * 3,
  };
}

/**
 * Translucent preview of the clipboard in "placing paste" mode. The group is
 * translated by the snapped hover delta (same snap commitPaste uses), and each
 * entry is rendered with full faces (no adjacency-based hiding) since we don't
 * compute a merged spatial index for the preview.
 */
export function PasteGhost() {
  const mode = useBlockStore((s) => s.mode);
  const armedTool = useBlockStore((s) => s.armedTool);
  const clipboard = useBlockStore((s) => s.clipboard);
  const hoveredGridPos = useBlockStore((s) => s.hoveredGridPos);
  const existingBlocks = useBlockStore((s) => s.blocks);

  const entries = useMemo(() => {
    if (!clipboard) return null;
    return Array.from(clipboard.values()).slice(0, MAX_PASTE_SHADOWS);
  }, [clipboard]);

  if (mode !== "edit" || armedTool !== "paste" || !hoveredGridPos || !entries) {
    return null;
  }

  const delta = snapDelta(hoveredGridPos);

  return (
    <group>
      {entries.map((b) => (
        <PasteGhostBlock
          key={`${b.pos.x},${b.pos.y},${b.pos.z}`}
          block={b}
          delta={delta}
          existingBlocks={existingBlocks}
        />
      ))}
    </group>
  );
}

function PasteGhostBlock({
  block,
  delta,
  existingBlocks,
}: {
  block: Block;
  delta: Position3D;
  existingBlocks: Map<string, Block>;
}) {
  const worldPos: Position3D = {
    x: block.pos.x + delta.x,
    y: block.pos.y + delta.y,
    z: block.pos.z + delta.z,
  };
  const key = `${worldPos.x},${worldPos.y},${worldPos.z}`;
  const collides = existingBlocks.has(key) || !isValidPos(worldPos, block.type);

  const geometry = getCachedGeometry(block.type, 0);
  const edges = getCachedEdges(block.type, 0);
  const zo = block.type === "Y" ? yBlockZOffset(worldPos, existingBlocks) : 0;
  const [x, y, z] = tqecToThree(worldPos, block.type, zo);
  const meshMat = collides ? invalidMaterial : pasteMaterial;
  const lineMat = collides ? invalidLineMaterial : pasteLineMaterial;
  // Shadow position uses the visually-rendered z (logical + Y-cube lift), so
  // shadow + projection line align with what the user sees.
  const shadowPos = { ...worldPos, z: worldPos.z + zo };

  return (
    <>
      <group position={[x, y, z]}>
        <mesh raycast={noRaycast}>
          <primitive object={geometry} attach="geometry" />
          <primitive object={meshMat} attach="material" />
        </mesh>
        <lineSegments raycast={noRaycast}>
          <primitive object={edges} attach="geometry" />
          <primitive object={lineMat} attach="material" />
        </lineSegments>
      </group>
      <GroundShadowAbsolute pos={shadowPos} blockType={block.type} valid={!collides} />
    </>
  );
}
