import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, yBlockZOffset, getHiddenFaceMaskForPos } from "../types";
import { getCachedGeometry, getCachedEdges, getCachedFullBox } from "./BlockInstances";

const noRaycast = () => {};

// Shared materials — allocated once, never re-created
const ghostMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const portGhostMaterial = new THREE.MeshBasicMaterial({
  color: 0xdddddd,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const portGhostBox = new THREE.BoxGeometry(1, 1, 1);
const portGhostEdges = new THREE.EdgesGeometry(portGhostBox);
const invalidMaterial = new THREE.MeshLambertMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const deleteMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const validLineMaterial = new THREE.LineBasicMaterial({
  color: "#000000",
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
});
const invalidLineMaterial = new THREE.LineBasicMaterial({
  color: "#ff0000",
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
});
const replaceMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const replaceLineMaterial = new THREE.LineBasicMaterial({
  color: "#000000",
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
});

/**
 * Inner component — only mounts when hoveredGridPos is non-null.
 * Subscribes to blocks/spatialIndex for hidden-face computation.
 */
function GhostBlockInner() {
  const hoveredGridPos = useBlockStore((s) => s.hoveredGridPos)!;
  const mode = useBlockStore((s) => s.mode);
  const cubeType = useBlockStore((s) => s.cubeType);
  const hoveredBlockType = useBlockStore((s) => s.hoveredBlockType);
  const hoveredInvalid = useBlockStore((s) => s.hoveredInvalid);
  const hoveredReplace = useBlockStore((s) => s.hoveredReplace);
  const blocks = useBlockStore((s) => s.blocks);
  const spatialIndex = useBlockStore((s) => s.spatialIndex);
  const placePort = useBlockStore((s) => s.placePort);

  // Port placement preview: render a port-style white ghost at the snapped
  // cube position. No type-dependent coloring, no hidden-face mask.
  if (placePort && mode === "place") {
    const [x, y, z] = tqecToThree(hoveredGridPos, "XZZ");
    return (
      <group position={[x, y, z]}>
        <mesh raycast={noRaycast}>
          <primitive object={portGhostBox} attach="geometry" />
          <primitive object={portGhostMaterial} attach="material" />
        </mesh>
        <lineSegments raycast={noRaycast}>
          <primitive object={portGhostEdges} attach="geometry" />
          <primitive object={validLineMaterial} attach="material" />
        </lineSegments>
      </group>
    );
  }

  const activeType = hoveredBlockType ?? cubeType;

  const previewHiddenFaces = getHiddenFaceMaskForPos(hoveredGridPos, activeType, blocks, spatialIndex);
  const ghostGeometry = getCachedGeometry(activeType, previewHiddenFaces);
  const ghostEdges = getCachedEdges(activeType, previewHiddenFaces);

  const zo = activeType === "Y" ? yBlockZOffset(hoveredGridPos, blocks) : 0;
  const [x, y, z] = tqecToThree(hoveredGridPos, activeType, zo);
  const isDelete = mode === "delete";
  const isInvalid = !isDelete && hoveredInvalid;
  const isReplace = !isDelete && hoveredReplace;

  let meshMat = isInvalid ? invalidMaterial : ghostMaterial;
  let lineMat = isInvalid ? invalidLineMaterial : validLineMaterial;
  let scale = isInvalid ? 1.005 : 1;
  if (isReplace && !isInvalid) {
    meshMat = replaceMaterial;
    lineMat = replaceLineMaterial;
    scale = 1.01;
  }

  return (
    <group position={[x, y, z]}>
      {isDelete ? (
        <mesh scale={1.01} raycast={noRaycast}>
          <primitive object={getCachedFullBox(activeType)} attach="geometry" />
          <primitive object={deleteMaterial} attach="material" />
        </mesh>
      ) : (
        <group scale={scale}>
          <mesh>
            <primitive object={ghostGeometry} attach="geometry" />
            <primitive object={meshMat} attach="material" />
          </mesh>
          <lineSegments>
            <primitive object={ghostEdges} attach="geometry" />
            <primitive object={lineMat} attach="material" />
          </lineSegments>
        </group>
      )}
    </group>
  );
}

/**
 * Outer component — only subscribes to hoveredGridPos.
 * When null, renders nothing and avoids subscribing to blocks/spatialIndex.
 */
export function GhostBlock() {
  const hasHover = useBlockStore((s) => s.hoveredGridPos !== null);
  const mode = useBlockStore((s) => s.mode);
  if (!hasHover || mode === "select" || mode === "build") return null;
  return <GhostBlockInner />;
}
