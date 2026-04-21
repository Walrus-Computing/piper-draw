import * as THREE from "three";
import { useLocateStore } from "../stores/locateStore";
import { useBlockStore } from "../stores/blockStore";
import { usePulseScale } from "../hooks/usePulseScale";
import { tqecToThree, blockThreeSize, yBlockZOffset } from "../types";
import type { BlockType } from "../types";

const PULSE_COLOR = 0xffa500;

const fillMaterial = new THREE.MeshBasicMaterial({
  color: PULSE_COLOR,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const outlineMaterial = new THREE.LineBasicMaterial({
  color: PULSE_COLOR,
  linewidth: 2,
});

const boxCache = new Map<BlockType, THREE.BoxGeometry>();
const edgesCache = new Map<BlockType, THREE.EdgesGeometry>();

function getPulseGeo(blockType: BlockType) {
  let box = boxCache.get(blockType);
  if (!box) {
    const [sx, sy, sz] = blockThreeSize(blockType);
    box = new THREE.BoxGeometry(sx * 1.15, sy * 1.15, sz * 1.15);
    boxCache.set(blockType, box);
  }
  let edges = edgesCache.get(blockType);
  if (!edges) {
    edges = new THREE.EdgesGeometry(box);
    edgesCache.set(blockType, edges);
  }
  return { box, edges };
}

const noRaycast = () => {};

function PulsingLocateBlock({
  position,
  blockType,
}: {
  position: [number, number, number];
  blockType: BlockType;
}) {
  const groupRef = usePulseScale();
  const { box, edges } = getPulseGeo(blockType);
  return (
    <group ref={groupRef} position={position}>
      <mesh geometry={box} material={fillMaterial} raycast={noRaycast} />
      <lineSegments geometry={edges} material={outlineMaterial} raycast={noRaycast} />
    </group>
  );
}

function parseKey(key: string): { x: number; y: number; z: number } | null {
  const parts = key.split(",").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return { x: parts[0], y: parts[1], z: parts[2] };
}

export function LocatePulseHighlight() {
  const pulseKey = useLocateStore((s) => s.pulseKey);
  const blocks = useBlockStore((s) => s.blocks);

  if (!pulseKey) return null;
  const block = blocks.get(pulseKey);
  if (block) {
    const zo = block.type === "Y" ? yBlockZOffset(block.pos, blocks) : 0;
    const [tx, ty, tz] = tqecToThree(block.pos, block.type, zo);
    return <PulsingLocateBlock position={[tx, ty, tz]} blockType={block.type} />;
  }

  const pos = parseKey(pulseKey);
  if (!pos) return null;
  const [tx, ty, tz] = tqecToThree(pos, "XZZ");
  return <PulsingLocateBlock position={[tx, ty, tz]} blockType="XZZ" />;
}
