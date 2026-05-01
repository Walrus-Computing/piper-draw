import * as THREE from "three";
import { blockThreeSize } from "../types";
import type { BlockType } from "../types";

const cachesByScale = new Map<
  number,
  {
    boxes: Map<BlockType, THREE.BoxGeometry>;
    edges: Map<BlockType, THREE.EdgesGeometry>;
  }
>();

function cacheForScale(scale: number) {
  let entry = cachesByScale.get(scale);
  if (!entry) {
    entry = { boxes: new Map(), edges: new Map() };
    cachesByScale.set(scale, entry);
  }
  return entry;
}

export function getHighlightGeo(blockType: BlockType, scale: number) {
  const { boxes, edges } = cacheForScale(scale);
  let box = boxes.get(blockType);
  if (!box) {
    const [sx, sy, sz] = blockThreeSize(blockType);
    box = new THREE.BoxGeometry(sx * scale, sy * scale, sz * scale);
    boxes.set(blockType, box);
  }
  let edge = edges.get(blockType);
  if (!edge) {
    edge = new THREE.EdgesGeometry(box);
    edges.set(blockType, edge);
  }
  return { box, edges: edge };
}
