import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, blockThreeSize } from "../types";
import { getCachedGeometry, getCachedEdges } from "./BlockInstances";
import type { BlockType } from "../types";

/** Box edges + both diagonals on every face, as a LineSegmentsGeometry for fat lines. */
function createDeleteOutlineGeometry(blockType: BlockType): LineSegmentsGeometry {
  const [sx, sy, sz] = blockThreeSize(blockType);
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const c = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz],  [hx, -hy, hz],  [hx, hy, hz],  [-hx, hy, hz],
  ];
  const edges: [number, number][] = [
    [0,1],[1,2],[2,3],[3,0],
    [4,5],[5,6],[6,7],[7,4],
    [0,4],[1,5],[2,6],[3,7],
  ];
  const faces: [number, number, number, number][] = [
    [0,1,2,3], [4,5,6,7],
    [0,1,5,4], [2,3,7,6],
    [0,3,7,4], [1,2,6,5],
  ];

  const positions: number[] = [];
  for (const [a, b] of edges) {
    positions.push(...c[a], ...c[b]);
  }
  for (const [a, b, cc, d] of faces) {
    positions.push(...c[a], ...c[cc]);
    positions.push(...c[b], ...c[d]);
  }

  const geo = new LineSegmentsGeometry();
  geo.setPositions(positions);
  return geo;
}

export function GhostBlock() {
  const hoveredGridPos = useBlockStore((s) => s.hoveredGridPos);
  const mode = useBlockStore((s) => s.mode);
  const cubeType = useBlockStore((s) => s.cubeType);
  const hoveredBlockType = useBlockStore((s) => s.hoveredBlockType);
  const hoveredInvalid = useBlockStore((s) => s.hoveredInvalid);
  const size = useThree((s) => s.size);

  // In delete mode, use the hovered block's type; in place mode, use selected type
  const activeType = mode === "delete" && hoveredBlockType ? hoveredBlockType : cubeType;

  const deleteOutline = useMemo(() => createDeleteOutlineGeometry(activeType), [activeType]);
  const deleteMaterial = useMemo(
    () => new LineMaterial({
      color: 0xff0000,
      linewidth: 3, // pixels
      depthWrite: false,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    }),
    [],
  );
  // Keep LineMaterial resolution in sync with viewport size
  useEffect(() => {
    deleteMaterial.resolution.set(size.width, size.height);
  }, [deleteMaterial, size.width, size.height]);

  const deleteLineSegments = useMemo(
    () => new LineSegments2(deleteOutline, deleteMaterial),
    [deleteOutline, deleteMaterial],
  );
  const ghostGeometry = getCachedGeometry(activeType);
  const ghostEdges = getCachedEdges(activeType);
  const ghostMaterial = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const invalidMaterial = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  if (!hoveredGridPos) return null;

  const [x, y, z] = tqecToThree(hoveredGridPos, activeType);
  const isDelete = mode === "delete";
  const isInvalid = !isDelete && hoveredInvalid;

  return (
    <group position={[x, y, z]}>
      {isDelete ? (
        <primitive object={deleteLineSegments} scale={1.005} />
      ) : (
        <group scale={isInvalid ? 1.005 : 1}>
          <mesh>
            <primitive object={ghostGeometry} attach="geometry" />
            <primitive object={isInvalid ? invalidMaterial : ghostMaterial} attach="material" />
          </mesh>
          <lineSegments>
            <primitive object={ghostEdges} attach="geometry" />
            <lineBasicMaterial color={isInvalid ? "#ff0000" : "#000000"} transparent opacity={0.4} depthWrite={false} />
          </lineSegments>
        </group>
      )}
    </group>
  );
}
