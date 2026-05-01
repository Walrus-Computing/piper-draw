import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { X_COLOR, Z_COLOR } from "../types";
import { emitSliceQuad, parseFaceKey } from "../utils/corrSurfaceGeom";

/**
 * Renders manual correlation-surface marks (Block.faceCorrSurface) as red (X)
 * or blue (Z) internal centerline cross-sections — the same shape TQEC's
 * /api/flows returns for analyzed scenes. Mirrors FlowSurfaceOverlay's
 * palette so manual and TQEC-computed surfaces look identical.
 *
 * Returns null unless `corrSurfaceVizMode` is on. Marks are deduped per
 * (block, slice-axis, strip) so clicking +Y and -Y of the same pipe don't
 * render two overlapping quads — both clicks address the same Y-axis slice.
 */
export function CorrSurfaceOverlay() {
  const corrSurfaceVizMode = useBlockStore((s) => s.corrSurfaceVizMode);
  const blocks = useBlockStore((s) => s.blocks);

  const geometries = useMemo(() => {
    if (!corrSurfaceVizMode) return null;
    const xPositions: number[] = [];
    const zPositions: number[] = [];
    for (const block of blocks.values()) {
      const marks = block.faceCorrSurface;
      if (!marks) continue;
      // Dedupe by (slice-axis, strip): both +Y and -Y faces of the same pipe
      // point at the same internal slice. The first mark in iteration order wins.
      const seen = new Set<string>();
      for (const [key, basis] of Object.entries(marks)) {
        const parsed = parseFaceKey(key);
        if (!parsed) continue;
        const sliceAxis = parsed.faceIdx >> 1;
        const dedupeKey = `${sliceAxis}:${parsed.strip ?? ""}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const target = basis === "X" ? xPositions : zPositions;
        emitSliceQuad(target, block, parsed.faceIdx, parsed.strip);
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
