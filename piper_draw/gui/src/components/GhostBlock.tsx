import { useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, createCubeGeometry } from "../types";

/** Box edges + both diagonals on every face. */
function createDeleteOutlineGeometry(): THREE.BufferGeometry {
  const h = 0.5;
  // 8 corners of a unit cube centered at origin
  const c = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h], // front face (z=-h)
    [-h, -h, h],  [h, -h, h],  [h, h, h],  [-h, h, h],   // back face  (z=+h)
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

  const deleteOutline = useMemo(() => createDeleteOutlineGeometry(), []);
  const ghostGeometry = useMemo(() => createCubeGeometry(cubeType), [cubeType]);
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

  const [x, y, z] = tqecToThree(hoveredGridPos);
  const isDelete = mode === "delete";

  return (
    <group position={[x, y, z]}>
      {isDelete ? (
        <>
          {/* Transparent red tint — block colors show through */}
          <mesh scale={1.01}>
            <boxGeometry args={[1, 1, 1]} />
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
