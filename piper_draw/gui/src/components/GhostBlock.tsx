import { useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, createBlockGeometry } from "../types";
import type { BlockType } from "../types";

/** Box edges + both diagonals on every face. */
function createDeleteOutlineGeometry(blockType: BlockType): THREE.BufferGeometry {
  const hx = 0.5, hz = 0.5;
  // TQEC Z → Three.js Y: half-height in Y for YHalfCube
  const hy = blockType === "Y" ? 0.25 : 0.5;
  // 8 corners of the box centered at origin
  const c = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], // front face (z=-hz)
    [-hx, -hy, hz],  [hx, -hy, hz],  [hx, hy, hz],  [-hx, hy, hz],   // back face  (z=+hz)
  ];
  // 12 box edges
  const edges: [number, number][] = [
    [0,1],[1,2],[2,3],[3,0], // front
    [4,5],[5,6],[6,7],[7,4], // back
    [0,4],[1,5],[2,6],[3,7], // connecting
  ];
  // 6 faces, each with 4 corner indices — draw both diagonals
  const faces: [number, number, number, number][] = [
    [0,1,2,3], // front  (z=-h)
    [4,5,6,7], // back   (z=+h)
    [0,1,5,4], // bottom (y=-h)
    [2,3,7,6], // top    (y=+h)
    [0,3,7,4], // left   (x=-h)
    [1,2,6,5], // right  (x=+h)
  ];

  const positions: number[] = [];
  // Box edges
  for (const [a, b] of edges) {
    positions.push(...c[a], ...c[b]);
  }
  // Both diagonals per face
  for (const [a, b, cc, d] of faces) {
    positions.push(...c[a], ...c[cc]); // diagonal 1
    positions.push(...c[b], ...c[d]);  // diagonal 2
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

export function GhostBlock() {
  const hoveredGridPos = useBlockStore((s) => s.hoveredGridPos);
  const mode = useBlockStore((s) => s.mode);
  const cubeType = useBlockStore((s) => s.cubeType);
  const hoveredBlockType = useBlockStore((s) => s.hoveredBlockType);

  // In delete mode, use the hovered block's type; in place mode, use selected type
  const activeType = mode === "delete" && hoveredBlockType ? hoveredBlockType : cubeType;

  const deleteOutline = useMemo(() => createDeleteOutlineGeometry(activeType), [activeType]);
  const ghostGeometry = useMemo(() => createBlockGeometry(activeType), [activeType]);
  const ghostMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    [],
  );

  if (!hoveredGridPos) return null;

  const [x, y, z] = tqecToThree(hoveredGridPos, activeType);
  const isDelete = mode === "delete";

  return (
    <group position={[x, y, z]}>
      {isDelete ? (
        <>
          {/* Transparent red tint — block colors show through */}
          <mesh scale={1.01}>
            <boxGeometry args={[1, activeType === "Y" ? 0.5 : 1, 1]} />
            <meshStandardMaterial
              color="#ff4444"
              transparent
              opacity={0.25}
              depthWrite={false}
            />
          </mesh>
          {/* Red outline with both diagonals */}
          <lineSegments scale={1.02}>
            <primitive object={deleteOutline} attach="geometry" />
            <lineBasicMaterial color="#ff0000" depthWrite={false} />
          </lineSegments>
        </>
      ) : (
        <mesh>
          <primitive object={ghostGeometry} attach="geometry" />
          <primitive object={ghostMaterial} attach="material" />
        </mesh>
      )}
    </group>
  );
}
