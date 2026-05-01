import { useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import {
  OKABE_ITO_PALETTE,
  GROUP_DASH_PATTERNS,
  paletteIndexFor,
} from "../stores/groupSelectors";
import { tqecToThree, yBlockZOffset, blockThreeSize, posKey } from "../types";
import type { Block, BlockType } from "../types";

/**
 * Persistent group-membership outlines. Renders a coloured dashed cube
 * outline around every block whose `groupId` is set, even when not selected.
 *
 * Color and dash pattern are derived from `hash(groupId) % 8` (Okabe-Ito
 * palette + 8 dash patterns), so identical groupIds always render the same
 * way and >8 groups will recycle hues+patterns. The future sidebar UI is
 * the long-term disambiguator.
 *
 * Rendering: one `lineSegments` mesh per grouped block, drawing a cached
 * `EdgesGeometry` with the appropriate `LineDashedMaterial`. `computeLine
 * Distances()` is called once per (palette-index × block-type) cache slot;
 * the meshes themselves carry no per-instance line-distance work.
 */

// ---------------------------------------------------------------------------
// Cached materials — one LineDashedMaterial per palette index. Created lazily.
// ---------------------------------------------------------------------------
const dashedMaterialCache = new Map<number, THREE.LineDashedMaterial>();

function getDashedMaterial(paletteIndex: number): THREE.LineDashedMaterial {
  let m = dashedMaterialCache.get(paletteIndex);
  if (!m) {
    const { dashSize, gapSize } = GROUP_DASH_PATTERNS[paletteIndex];
    m = new THREE.LineDashedMaterial({
      color: new THREE.Color(OKABE_ITO_PALETTE[paletteIndex]),
      dashSize,
      gapSize,
      // Note: WebGL ignores `linewidth` > 1 for LineSegments on most platforms,
      // so the visual hierarchy between this outline and the pulsing selection
      // outline relies on the dash pattern + color, not stroke width.
    });
    dashedMaterialCache.set(paletteIndex, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Cached edges geometries — keyed by BlockType only. `lineDistance` values are
// pattern-independent (cumulative segment lengths, not dash-aware), and the
// material owns dashSize/gapSize separately, so a single geometry per type is
// shared across all 8 palette entries.
// ---------------------------------------------------------------------------
const edgesCache = new Map<BlockType, THREE.EdgesGeometry>();
const boxCache = new Map<BlockType, THREE.BoxGeometry>();

/**
 * LineSegments-style cumulative line-distance attribute, required by
 * LineDashedMaterial. Three.js's `computeLineDistances` only lives on the
 * LineSegments mesh; we'd lose its `lineDistance` attribute when reusing the
 * geometry across many instances. So we compute it directly on the
 * BufferGeometry, mirroring the Three.js source.
 */
function computeLineDistancesOnGeometry(geo: THREE.BufferGeometry): void {
  const pos = geo.attributes.position;
  const n = pos.count;
  const distances = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    distances[i] = i === 0 ? 0 : distances[i - 1];
    distances[i + 1] = distances[i] + segLen;
  }
  geo.setAttribute("lineDistance", new THREE.BufferAttribute(distances, 1));
}

function getEdgesGeo(blockType: BlockType): THREE.EdgesGeometry {
  let edges = edgesCache.get(blockType);
  if (!edges) {
    let box = boxCache.get(blockType);
    if (!box) {
      const [sx, sy, sz] = blockThreeSize(blockType);
      // 1.05× outward inset so the group outline reads above the cube faces
      // and slightly above the 1.04× pulsing selection highlight, avoiding
      // z-fighting against either layer.
      box = new THREE.BoxGeometry(sx * 1.05, sy * 1.05, sz * 1.05);
      boxCache.set(blockType, box);
    }
    edges = new THREE.EdgesGeometry(box);
    computeLineDistancesOnGeometry(edges);
    edgesCache.set(blockType, edges);
  }
  return edges;
}

const noRaycast = () => {};

function GroupOutline({ block, zo }: { block: Block; zo: number }) {
  const gid = block.groupId!;
  const idx = paletteIndexFor(gid);
  const [tx, ty, tz] = tqecToThree(block.pos, block.type, zo);
  const edges = getEdgesGeo(block.type);
  const material = getDashedMaterial(idx);

  return (
    <lineSegments
      position={[tx, ty, tz]}
      geometry={edges}
      material={material}
      raycast={noRaycast}
    />
  );
}

export function GroupOutlines() {
  const blocks = useBlockStore((s) => s.blocks);
  const isDragging = useBlockStore((s) => s.isDraggingSelection);

  // Compute (block, zo) tuples in the parent so children don't need to
  // subscribe to the full blocks Map just to read y-defect z-offsets.
  // Y-blocks read yBlockZOffset against the same Map; non-Y blocks pass 0.
  const grouped = useMemo(() => {
    const result: Array<{ block: Block; zo: number }> = [];
    for (const b of blocks.values()) {
      if (!b.groupId) continue;
      const zo = b.type === "Y" ? yBlockZOffset(b.pos, blocks) : 0;
      result.push({ block: b, zo });
    }
    return result;
  }, [blocks]);

  if (isDragging) return null;
  if (grouped.length === 0) return null;

  return (
    <>
      {grouped.map(({ block, zo }) => (
        <GroupOutline key={posKey(block.pos)} block={block} zo={zo} />
      ))}
    </>
  );
}
