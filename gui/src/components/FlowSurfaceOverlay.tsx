import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";

const X_COLOR = new THREE.Color("#ff7f7f");
const Z_COLOR = new THREE.Color("#7396ff");

const noRaycast = () => {};

/**
 * Renders the selected correlation surface's pieces as colored quads in 3D.
 * Surface vertices arrive from the backend already in Three.js world coords
 * (see `_quad_vertices_three` in server.py). Returns null unless flow viz
 * mode is on and a flow is selected.
 */
export function FlowSurfaceOverlay() {
  const flowVizMode = useBlockStore((s) => s.flowVizMode);
  const flows = useBlockStore((s) => s.flows);
  const selectedFlowIndex = useBlockStore((s) => s.selectedFlowIndex);

  const flow =
    flowVizMode && selectedFlowIndex !== null && selectedFlowIndex >= 0
      ? flows[selectedFlowIndex] ?? null
      : null;

  // One BufferGeometry per basis (X, Z), aggregating every quad of that basis
  // into a single mesh. Two triangles per quad: 0-1-2 and 0-2-3.
  const geometries = useMemo(() => {
    if (!flow) return null;
    const perBasis: Record<"X" | "Z", { positions: number[]; indices: number[] }> = {
      X: { positions: [], indices: [] },
      Z: { positions: [], indices: [] },
    };
    for (const piece of flow.surfaces) {
      const b = piece.basis === "X" ? "X" : "Z";
      const bucket = perBasis[b];
      const baseVert = bucket.positions.length / 3;
      bucket.positions.push(...piece.vertices);
      bucket.indices.push(
        baseVert, baseVert + 1, baseVert + 2,
        baseVert, baseVert + 2, baseVert + 3,
      );
    }
    const build = (data: { positions: number[]; indices: number[] }) => {
      if (data.positions.length === 0) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
      g.setIndex(data.indices);
      g.computeVertexNormals();
      return g;
    };
    return { X: build(perBasis.X), Z: build(perBasis.Z) };
  }, [flow]);

  // Dispose the geometries when they are replaced (new flow selected) or the
  // overlay unmounts. Skipping this would leak GPU buffers on every selection.
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
        <mesh geometry={geometries.X} raycast={noRaycast}>
          <meshBasicMaterial color={X_COLOR} side={THREE.DoubleSide} />
        </mesh>
      )}
      {geometries.Z && (
        <mesh geometry={geometries.Z} raycast={noRaycast}>
          <meshBasicMaterial color={Z_COLOR} side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  );
}
