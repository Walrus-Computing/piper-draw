import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { X_COLOR, Z_COLOR } from "../types";
import { emitSliceQuad, parseSliceKey } from "../utils/corrSurfaceGeom";

/**
 * Renders manual correlation-surface marks (Block.corrSurfaceMarks) as red
 * (X) or blue (Z) internal centerline cross-sections — the same shape TQEC's
 * /api/flows returns for analyzed scenes. Mirrors FlowSurfaceOverlay's
 * palette so manual and TQEC-computed surfaces look identical.
 *
 * Returns null unless `corrSurfaceVizMode` is on. Per-axis storage means each
 * key in `corrSurfaceMarks` uniquely identifies one slice — no render-time
 * dedupe needed (the click handler normalizes face index → axis at write
 * time).
 */
export function CorrSurfaceOverlay() {
  const corrSurfaceVizMode = useBlockStore((s) => s.corrSurfaceVizMode);
  const blocks = useBlockStore((s) => s.blocks);

  const geometries = useMemo(() => {
    if (!corrSurfaceVizMode) return null;
    const xPositions: number[] = [];
    const zPositions: number[] = [];
    for (const block of blocks.values()) {
      const marks = block.corrSurfaceMarks;
      if (!marks) continue;
      for (const [key, basis] of Object.entries(marks)) {
        const parsed = parseSliceKey(key);
        if (!parsed) continue;
        const target = basis === "X" ? xPositions : zPositions;
        emitSliceQuad(target, block, parsed.axis, parsed.strip);
      }
    }
    const build = (positions: number[]): THREE.BufferGeometry | null => {
      if (positions.length === 0) return null;
      const vertCount = positions.length / 3;
      const indices: number[] = [];
      for (let v = 0; v < vertCount; v += 4) {
        indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex(indices);
      g.computeVertexNormals();
      return g;
    };
    return { X: build(xPositions), Z: build(zPositions) };
  }, [corrSurfaceVizMode, blocks]);

  // Dispose the geometries when they are replaced or the overlay unmounts.
  useEffect(() => {
    return () => {
      geometries?.X?.dispose();
      geometries?.Z?.dispose();
    };
  }, [geometries]);

  if (!geometries) return null;

  return (
    <>
      {geometries.X && (
        <mesh geometry={geometries.X}>
          <meshBasicMaterial color={X_COLOR} side={THREE.DoubleSide} />
        </mesh>
      )}
      {geometries.Z && (
        <mesh geometry={geometries.Z}>
          <meshBasicMaterial color={Z_COLOR} side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  );
}
